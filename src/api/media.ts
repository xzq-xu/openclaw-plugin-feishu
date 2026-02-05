/**
 * Media upload and sending operations.
 */

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Config } from "../config/schema.js";
import type {
  UploadImageParams, UploadFileParams, DownloadImageParams, DownloadFileParams,
  SendMediaParams, SendResult, ImageUploadResult, FileUploadResult, FileType,
  SendImageParams, SendFileParams,
} from "../types/index.js";
import { getApiClient } from "./client.js";
import { normalizeTarget, resolveReceiveIdType } from "./messages.js";

// SDK image optimization (HEIC conversion, smart compression)
type LoadWebMediaFn = (url: string, maxBytes?: number) => Promise<{ buffer: Buffer; contentType: string; fileName?: string }>;
let sdkLoadWebMedia: LoadWebMediaFn | null = null;

export function initImageOptimization(): void {
  import("openclaw/plugin-sdk")
    .then((sdk) => {
      const fn = (sdk as Record<string, unknown>)["loadWebMedia"];
      if (typeof fn === "function") sdkLoadWebMedia = fn as LoadWebMediaFn;
    })
    .catch(() => {});
}
initImageOptimization();

export function isImageOptimizationAvailable(): boolean {
  return sdkLoadWebMedia !== null;
}

/** Detect file type from extension */
export function detectFileType(fileName: string): FileType {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".opus":
    case ".ogg":
      return "opus";
    case ".mp4":
    case ".mov":
    case ".avi":
      return "mp4";
    case ".pdf":
      return "pdf";
    case ".doc":
    case ".docx":
      return "doc";
    case ".xls":
    case ".xlsx":
      return "xls";
    case ".ppt":
    case ".pptx":
      return "ppt";
    default:
      return "stream";
  }
}

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".tiff"];

function isImageExtension(fileName: string): boolean {
  return IMAGE_EXTS.includes(path.extname(fileName).toLowerCase());
}

function isLocalPath(urlOrPath: string): boolean {
  if (urlOrPath.startsWith("/") || urlOrPath.startsWith("~") || urlOrPath.startsWith("./")) return true;
  if (/^[a-zA-Z]:/.test(urlOrPath)) return true;
  if (urlOrPath.startsWith("file://")) return true;
  try {
    return new URL(urlOrPath).protocol === "file:";
  } catch {
    return urlOrPath.includes("/") || urlOrPath.includes("\\");
  }
}

function resolveFilePath(inputPath: string): string | null {
  let cleanPath = inputPath.replace(/^file:\/\//, "");
  if (cleanPath.startsWith("~")) cleanPath = cleanPath.replace("~", process.env["HOME"] ?? "");

  const home = process.env["HOME"] ?? "";
  const searchPaths = [
    path.resolve("/tmp", cleanPath),
    path.resolve("/workspaces", cleanPath),
    path.resolve(process.cwd(), cleanPath),
    path.resolve(home, "workspaces", cleanPath),
    path.resolve(home, cleanPath),
    path.resolve(home, ".openclaw", cleanPath),
  ];
  if (path.isAbsolute(cleanPath)) searchPaths.unshift(cleanPath);

  for (const p of searchPaths) if (fs.existsSync(p)) return p;
  return null;
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function normalizeBinaryResponse(response: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(response)) return response;
  if (response instanceof Readable) return readStreamToBuffer(response);
  if (response instanceof ArrayBuffer) return Buffer.from(response);
  if (ArrayBuffer.isView(response)) return Buffer.from(response.buffer, response.byteOffset, response.byteLength);
  if (typeof response === "object" && response !== null) {
    const obj = response as { code?: number; msg?: string; data?: unknown };
    if (obj.code !== undefined && obj.code !== 0) throw new Error(`Download failed: ${obj.msg ?? `code ${obj.code}`}`);
    if (obj.data !== undefined) return normalizeBinaryResponse(obj.data);
  }
  throw new Error("Download failed: unsupported response type");
}

interface ApiResponse { code?: number; msg?: string; image_key?: string; file_key?: string; data?: { image_key?: string; file_key?: string; message_id?: string } }

/** Upload an image to Feishu */
export async function uploadImage(config: Config, params: UploadImageParams): Promise<ImageUploadResult> {
  const client = getApiClient(config);
  const imageStream = typeof params.image === "string" ? fs.createReadStream(params.image) : Readable.from(params.image);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = (await client.im.image.create({ data: { image_type: params.imageType ?? "message", image: imageStream as any } })) as ApiResponse;
  if (response.code !== undefined && response.code !== 0) throw new Error(`Image upload failed: ${response.msg ?? `code ${response.code}`}`);
  const imageKey = response.image_key ?? response.data?.image_key;
  if (!imageKey) throw new Error("Image upload failed: no image_key returned");
  return { imageKey };
}

/** Upload a file to Feishu (max 30MB) */
export async function uploadFile(config: Config, params: UploadFileParams): Promise<FileUploadResult> {
  const client = getApiClient(config);
  const fileStream = typeof params.file === "string" ? fs.createReadStream(params.file) : Readable.from(params.file);
  const response = (await client.im.file.create({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { file_type: params.fileType, file_name: params.fileName, file: fileStream as any, ...(params.duration !== undefined ? { duration: params.duration } : {}) },
  })) as ApiResponse;
  if (response.code !== undefined && response.code !== 0) throw new Error(`File upload failed: ${response.msg ?? `code ${response.code}`}`);
  const fileKey = response.file_key ?? response.data?.file_key;
  if (!fileKey) throw new Error("File upload failed: no file_key returned");
  return { fileKey };
}

/** Download an image by image_key (only works for bot's own uploads) */
export async function downloadImage(config: Config, params: DownloadImageParams): Promise<Buffer> {
  const client = getApiClient(config);
  return normalizeBinaryResponse(await client.request({ method: "GET", url: `/open-apis/im/v1/images/${encodeURIComponent(params.imageKey)}`, responseType: "arraybuffer" } as Record<string, unknown>));
}

/** Download a message resource (image, file, video) from a user's message */
export async function downloadMessageResource(config: Config, params: { messageId: string; fileKey: string; type: "image" | "file" | "video" }): Promise<Buffer> {
  const client = getApiClient(config);
  const response = await client.im.messageResource.get({ params: { type: params.type }, path: { message_id: params.messageId, file_key: params.fileKey } });
  if (response && typeof response.getReadableStream === "function") return readStreamToBuffer(response.getReadableStream());
  throw new Error("Download failed: unexpected response format");
}

/** Download a file by file_key */
export async function downloadFile(config: Config, params: DownloadFileParams): Promise<Buffer> {
  const client = getApiClient(config);
  return normalizeBinaryResponse(await client.request({ method: "GET", url: `/open-apis/im/v1/files/${encodeURIComponent(params.fileKey)}`, responseType: "arraybuffer" } as Record<string, unknown>));
}

async function sendMediaMessage(
  config: Config,
  to: string,
  content: string,
  msgType: "image" | "file",
  replyToMessageId?: string
): Promise<SendResult> {
  const client = getApiClient(config);
  const receiveId = normalizeTarget(to);
  if (!receiveId) throw new Error(`Invalid target: ${to}`);

  const response = replyToMessageId
    ? (await client.im.message.reply({ path: { message_id: replyToMessageId }, data: { content, msg_type: msgType } })) as ApiResponse
    : (await client.im.message.create({ params: { receive_id_type: resolveReceiveIdType(receiveId) }, data: { receive_id: receiveId, content, msg_type: msgType } })) as ApiResponse;

  if (response.code !== 0) throw new Error(`${msgType} send failed: ${response.msg ?? `code ${response.code}`}`);
  return { messageId: response.data?.message_id ?? "unknown", chatId: receiveId };
}

/** Send an image message using an image_key */
export async function sendImage(config: Config, params: SendImageParams): Promise<SendResult> {
  return sendMediaMessage(config, params.to, JSON.stringify({ image_key: params.imageKey }), "image", params.replyToMessageId);
}

/** Send a file message using a file_key */
export async function sendFile(config: Config, params: SendFileParams): Promise<SendResult> {
  return sendMediaMessage(config, params.to, JSON.stringify({ file_key: params.fileKey }), "file", params.replyToMessageId);
}

async function fetchUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch media from URL: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function getNameFromUrl(url: string, fallback = "file"): string {
  return path.basename(new URL(url).pathname) || fallback;
}

/** Upload and send media (image or file) from URL, local path, or buffer */
export async function sendMedia(config: Config, params: SendMediaParams): Promise<SendResult> {
  if (params.imageKey) return sendImage(config, { to: params.to, imageKey: params.imageKey, replyToMessageId: params.replyToMessageId });
  if (params.fileKey) return sendFile(config, { to: params.to, fileKey: params.fileKey, replyToMessageId: params.replyToMessageId });

  let buffer: Buffer;
  let name: string;

  if (params.mediaBuffer) {
    buffer = params.mediaBuffer;
    name = params.fileName ?? "file";
  } else if (params.mediaUrl) {
    if (isLocalPath(params.mediaUrl)) {
      const resolvedPath = resolveFilePath(params.mediaUrl);
      if (!resolvedPath) throw new Error(`Local file not found: ${params.mediaUrl}`);
      buffer = fs.readFileSync(resolvedPath);
      name = params.fileName ?? path.basename(resolvedPath);
    } else {
      // Remote URL - try SDK optimization for images (HEIC conversion, smart compression)
      const maxBytes = config.mediaMaxMb ? config.mediaMaxMb * 1024 * 1024 : 20 * 1024 * 1024;
      if (sdkLoadWebMedia && isImageExtension(params.fileName ?? params.mediaUrl)) {
        try {
          const result = await sdkLoadWebMedia(params.mediaUrl, maxBytes);
          buffer = result.buffer;
          name = params.fileName ?? result.fileName ?? getNameFromUrl(params.mediaUrl, "image.jpg");
        } catch {
          buffer = await fetchUrl(params.mediaUrl);
          name = params.fileName ?? getNameFromUrl(params.mediaUrl);
        }
      } else {
        buffer = await fetchUrl(params.mediaUrl);
        name = params.fileName ?? getNameFromUrl(params.mediaUrl);
      }
    }
  } else {
    throw new Error("Either mediaUrl or mediaBuffer must be provided");
  }

  if (isImageExtension(name)) {
    const { imageKey } = await uploadImage(config, { image: buffer });
    return sendImage(config, { to: params.to, imageKey, replyToMessageId: params.replyToMessageId });
  }
  const { fileKey } = await uploadFile(config, { file: buffer, fileName: name, fileType: detectFileType(name) });
  return sendFile(config, { to: params.to, fileKey, replyToMessageId: params.replyToMessageId });
}
