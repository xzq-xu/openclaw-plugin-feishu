/**
 * Media upload and sending operations.
 */

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Config } from "../config/schema.js";
import type {
  UploadImageParams,
  UploadFileParams,
  SendMediaParams,
  SendResult,
  ImageUploadResult,
  FileUploadResult,
  FileType,
  SendImageParams,
  SendFileParams,
} from "../types/index.js";
import { getApiClient } from "./client.js";
import { normalizeTarget, resolveReceiveIdType } from "./messages.js";

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Detect file type from extension for upload.
 */
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

/**
 * Check if extension indicates an image.
 */
function isImageExtension(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".ico", ".tiff"].includes(ext);
}

/**
 * Check if a string is a local file path (not a URL).
 */
function isLocalPath(urlOrPath: string): boolean {
  if (urlOrPath.startsWith("/") || urlOrPath.startsWith("~") || urlOrPath.startsWith("./")) {
    return true;
  }
  if (/^[a-zA-Z]:/.test(urlOrPath)) {
    return true; // Windows drive letter
  }
  // Check for file:// protocol
  if (urlOrPath.startsWith("file://")) {
    return true;
  }
  try {
    const url = new URL(urlOrPath);
    return url.protocol === "file:";
  } catch {
    // Not a valid URL - could be a relative path like "folder/file.png"
    // Check if it looks like a path (contains / or \ or ends with known extension)
    if (urlOrPath.includes("/") || urlOrPath.includes("\\")) {
      return true;
    }
    return false;
  }
}

/**
 * Resolve file path, trying multiple possible locations.
 * Priority: /tmp/ and /workspaces first, then other paths.
 * Returns the resolved absolute path or null if not found.
 */
function resolveFilePath(inputPath: string): string | null {
  // Remove file:// prefix if present
  let cleanPath = inputPath;
  if (cleanPath.startsWith("file://")) {
    cleanPath = cleanPath.slice(7);
  }

  // Expand ~ to home directory
  if (cleanPath.startsWith("~")) {
    cleanPath = cleanPath.replace("~", process.env["HOME"] ?? "");
  }

  // For relative paths, try multiple base directories in priority order
  const searchPaths = [
    // Priority 1: /tmp/ directory (Agent sandbox, generated files)
    path.resolve("/tmp", cleanPath),
    // Priority 2: /workspaces (Codespaces, devcontainers)
    path.resolve("/workspaces", cleanPath),
    // Priority 3: Current working directory
    path.resolve(process.cwd(), cleanPath),
    // Priority 4: Home directory workspaces
    path.resolve(process.env["HOME"] ?? "", "workspaces", cleanPath),
    // Priority 5: Home directory
    path.resolve(process.env["HOME"] ?? "", cleanPath),
    // Priority 6: Clawdbot extensions directory
    path.resolve(process.env["HOME"] ?? "", ".clawdbot", cleanPath),
  ];

  // If input is absolute path, prepend it to search list
  if (path.isAbsolute(cleanPath)) {
    searchPaths.unshift(cleanPath);
  }

  for (const searchPath of searchPaths) {
    if (fs.existsSync(searchPath)) {
      return searchPath;
    }
  }

  return null;
}

// ============================================================================
// Upload Operations
// ============================================================================

interface UploadImageResponse {
  code?: number;
  msg?: string;
  image_key?: string;
  data?: { image_key?: string };
}

/**
 * Upload an image to Feishu.
 * Supports JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO.
 *
 * @throws Error if upload fails
 */
export async function uploadImage(
  config: Config,
  params: UploadImageParams
): Promise<ImageUploadResult> {
  const client = getApiClient(config);
  const imageType = params.imageType ?? "message";

  // Create readable stream from input
  const imageStream =
    typeof params.image === "string"
      ? fs.createReadStream(params.image)
      : Readable.from(params.image);

  const response = (await client.im.image.create({
    data: {
      image_type: imageType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      image: imageStream as any,
    },
  })) as UploadImageResponse;

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(`Image upload failed: ${response.msg ?? `code ${response.code}`}`);
  }

  const imageKey = response.image_key ?? response.data?.image_key;
  if (!imageKey) {
    throw new Error("Image upload failed: no image_key returned");
  }

  return { imageKey };
}

interface UploadFileResponse {
  code?: number;
  msg?: string;
  file_key?: string;
  data?: { file_key?: string };
}

/**
 * Upload a file to Feishu.
 * Max file size: 30MB.
 *
 * @throws Error if upload fails
 */
export async function uploadFile(
  config: Config,
  params: UploadFileParams
): Promise<FileUploadResult> {
  const client = getApiClient(config);

  // Create readable stream from input
  const fileStream =
    typeof params.file === "string" ? fs.createReadStream(params.file) : Readable.from(params.file);

  const response = (await client.im.file.create({
    data: {
      file_type: params.fileType,
      file_name: params.fileName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      file: fileStream as any,
      ...(params.duration !== undefined ? { duration: params.duration } : {}),
    },
  })) as UploadFileResponse;

  if (response.code !== undefined && response.code !== 0) {
    throw new Error(`File upload failed: ${response.msg ?? `code ${response.code}`}`);
  }

  const fileKey = response.file_key ?? response.data?.file_key;
  if (!fileKey) {
    throw new Error("File upload failed: no file_key returned");
  }

  return { fileKey };
}

// ============================================================================
// Media Sending
// ============================================================================

interface SendMediaResponse {
  code?: number;
  msg?: string;
  data?: { message_id?: string };
}

/**
 * Send an image message using an image_key.
 *
 * @throws Error if target is invalid or send fails
 */
export async function sendImage(config: Config, params: SendImageParams): Promise<SendResult> {
  const client = getApiClient(config);
  const receiveId = normalizeTarget(params.to);

  if (!receiveId) {
    throw new Error(`Invalid target: ${params.to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify({ image_key: params.imageKey });

  if (params.replyToMessageId) {
    const response = (await client.im.message.reply({
      path: { message_id: params.replyToMessageId },
      data: { content, msg_type: "image" },
    })) as SendMediaResponse;

    if (response.code !== 0) {
      throw new Error(`Image reply failed: ${response.msg ?? `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = (await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: { receive_id: receiveId, content, msg_type: "image" },
  })) as SendMediaResponse;

  if (response.code !== 0) {
    throw new Error(`Image send failed: ${response.msg ?? `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Send a file message using a file_key.
 *
 * @throws Error if target is invalid or send fails
 */
export async function sendFile(config: Config, params: SendFileParams): Promise<SendResult> {
  const client = getApiClient(config);
  const receiveId = normalizeTarget(params.to);

  if (!receiveId) {
    throw new Error(`Invalid target: ${params.to}`);
  }

  const receiveIdType = resolveReceiveIdType(receiveId);
  const content = JSON.stringify({ file_key: params.fileKey });

  if (params.replyToMessageId) {
    const response = (await client.im.message.reply({
      path: { message_id: params.replyToMessageId },
      data: { content, msg_type: "file" },
    })) as SendMediaResponse;

    if (response.code !== 0) {
      throw new Error(`File reply failed: ${response.msg ?? `code ${response.code}`}`);
    }

    return {
      messageId: response.data?.message_id ?? "unknown",
      chatId: receiveId,
    };
  }

  const response = (await client.im.message.create({
    params: { receive_id_type: receiveIdType },
    data: { receive_id: receiveId, content, msg_type: "file" },
  })) as SendMediaResponse;

  if (response.code !== 0) {
    throw new Error(`File send failed: ${response.msg ?? `code ${response.code}`}`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId: receiveId,
  };
}

/**
 * Upload and send media (image or file) from URL, local path, or buffer.
 *
 * @throws Error if no media source provided or upload/send fails
 */
export async function sendMedia(config: Config, params: SendMediaParams): Promise<SendResult> {
  let buffer: Buffer;
  let name: string;

  if (params.mediaBuffer) {
    buffer = params.mediaBuffer;
    name = params.fileName ?? "file";
  } else if (params.mediaUrl) {
    if (isLocalPath(params.mediaUrl)) {
      // Local file path - try to resolve it
      const resolvedPath = resolveFilePath(params.mediaUrl);

      if (!resolvedPath) {
        throw new Error(
          `Local file not found: ${params.mediaUrl} (searched in cwd, home, /workspaces)`
        );
      }

      buffer = fs.readFileSync(resolvedPath);
      name = params.fileName ?? path.basename(resolvedPath);
    } else {
      // Remote URL
      const response = await fetch(params.mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch media from URL: ${response.status}`);
      }
      buffer = Buffer.from(await response.arrayBuffer());
      name = params.fileName ?? (path.basename(new URL(params.mediaUrl).pathname) || "file");
    }
  } else {
    throw new Error("Either mediaUrl or mediaBuffer must be provided");
  }

  // Determine if it's an image and upload accordingly
  if (isImageExtension(name)) {
    const { imageKey } = await uploadImage(config, { image: buffer });
    return sendImage(config, {
      to: params.to,
      imageKey,
      replyToMessageId: params.replyToMessageId,
    });
  } else {
    const fileType = detectFileType(name);
    const { fileKey } = await uploadFile(config, {
      file: buffer,
      fileName: name,
      fileType,
    });
    return sendFile(config, { to: params.to, fileKey, replyToMessageId: params.replyToMessageId });
  }
}
