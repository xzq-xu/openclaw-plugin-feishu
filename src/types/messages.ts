/**
 * Message-related types for API operations.
 */

/** Target ID type for message sending */
export type ReceiveIdType = "open_id" | "user_id" | "union_id" | "chat_id";

/** Domain selection */
export type FeishuDomain = "feishu" | "lark";

/** Connection mode (websocket only) */
export type ConnectionMode = "websocket";

/** DM access policy */
export type DmPolicy = "open" | "pairing" | "allowlist";

/** Group access policy */
export type GroupPolicy = "open" | "allowlist" | "disabled";

/** Chat type */
export type ChatType = "p2p" | "group";

/** Parameters for sending a text message */
export interface SendTextParams {
  to: string;
  text: string;
  replyToMessageId?: string;
}

/** Parameters for sending an interactive card */
export interface SendCardParams {
  to: string;
  card: Record<string, unknown>;
  replyToMessageId?: string;
}

/** Parameters for editing a message */
export interface EditMessageParams {
  messageId: string;
  text: string;
}

/** Result of sending a message */
export interface SendResult {
  messageId: string;
  chatId: string;
}

/** Retrieved message information */
export interface MessageInfo {
  messageId: string;
  chatId: string;
  senderId?: string;
  senderOpenId?: string;
  content: string;
  contentType: string;
  createTime?: number;
}

/** Message from history with additional metadata */
export interface HistoryMessage extends MessageInfo {
  /** Whether the message has been deleted */
  deleted?: boolean;
  /** Whether the message has been edited */
  updated?: boolean;
}

/** Parameters for listing messages in a chat */
export interface ListMessagesParams {
  /** Chat ID to list messages from */
  chatId: string;
  /** Number of messages per page (default: 20, max: 50) */
  pageSize?: number;
  /** Pagination cursor from previous request */
  pageToken?: string;
  /** Start time filter (Unix timestamp in milliseconds) */
  startTime?: number;
  /** End time filter (Unix timestamp in milliseconds) */
  endTime?: number;
}

/** Result of listing messages */
export interface ListMessagesResult {
  /** List of messages */
  messages: HistoryMessage[];
  /** Cursor for next page (undefined if no more pages) */
  pageToken?: string;
  /** Whether there are more messages to fetch */
  hasMore: boolean;
}

/** Preserved mention information for non-bot users */
export interface MentionInfo {
  /** Display name of the mentioned user */
  name: string;
  /** Open ID of the mentioned user */
  openId: string;
}

/** Parsed message context for internal processing */
export interface ParsedMessage {
  chatId: string;
  messageId: string;
  senderId: string;
  senderOpenId: string;
  senderName?: string;
  chatType: ChatType;
  mentionedBot: boolean;
  rootId?: string;
  parentId?: string;
  content: string;
  contentType: string;
  /** Non-bot mentions preserved from the message */
  mentions?: MentionInfo[];
}

/** Parameters for uploading an image */
export interface UploadImageParams {
  image: Buffer | string;
  imageType?: "message" | "avatar";
}

/** Result of image upload */
export interface ImageUploadResult {
  imageKey: string;
}

/** File type for upload */
export type FileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

/** Parameters for uploading a file */
export interface UploadFileParams {
  file: Buffer | string;
  fileName: string;
  fileType: FileType;
  duration?: number;
}

/** Result of file upload */
export interface FileUploadResult {
  fileKey: string;
}

/** Parameters for sending media */
export interface SendMediaParams {
  to: string;
  mediaUrl?: string;
  mediaBuffer?: Buffer;
  fileName?: string;
  replyToMessageId?: string;
}

/** Parameters for sending an already-uploaded image */
export interface SendImageParams {
  to: string;
  imageKey: string;
  replyToMessageId?: string;
}

/** Parameters for sending an already-uploaded file */
export interface SendFileParams {
  to: string;
  fileKey: string;
  replyToMessageId?: string;
}

/** Reaction information */
export interface Reaction {
  reactionId: string;
  emojiType: string;
  operatorType: "app" | "user";
  operatorId: string;
}

/** Parameters for adding a reaction */
export interface AddReactionParams {
  messageId: string;
  emojiType: string;
}

/** Parameters for removing a reaction */
export interface RemoveReactionParams {
  messageId: string;
  reactionId: string;
}

/** User from directory */
export interface DirectoryUser {
  kind: "user";
  id: string;
  name?: string;
}

/** Group from directory */
export interface DirectoryGroup {
  kind: "group";
  id: string;
  name?: string;
}

/** Parameters for directory listing */
export interface ListDirectoryParams {
  query?: string;
  limit?: number;
}

/** Probe result for connection testing */
export interface ProbeResult {
  ok: boolean;
  error?: string;
  appId?: string;
  botName?: string;
  botOpenId?: string;
}
