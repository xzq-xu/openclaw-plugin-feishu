/**
 * Package entry point.
 * Exports all public APIs for the Feishu channel plugin.
 */

// Plugin (default export)
export { default } from "./plugin/index.js";

// Channel plugin
export { feishuChannel } from "./plugin/channel.js";

// Runtime management
export { initializeRuntime, getRuntime } from "./plugin/index.js";

// API operations
export {
  sendTextMessage,
  sendCardMessage,
  editMessage,
  updateCard,
  getMessage,
  listMessages,
  normalizeTarget,
  isValidId,
} from "./api/messages.js";

export {
  uploadImage,
  uploadFile,
  sendMedia,
  sendImage,
  sendFile,
  detectFileType,
} from "./api/media.js";

export { addReaction, removeReaction, listReactions, Emoji } from "./api/reactions.js";

export { listUsers, listGroups } from "./api/directory.js";

export { probeConnection, getApiClient, clearClientCache } from "./api/client.js";

// Core utilities
export { startGateway, stopGateway, getBotOpenId, getBotName } from "./core/gateway.js";

export {
  parseMessageEvent,
  isBotMentioned,
  stripMentions,
  extractMentions,
  formatMentionsForFeishu,
} from "./core/parser.js";

export {
  checkDmPolicy,
  checkGroupPolicy,
  shouldRequireMention,
  matchAllowlist,
} from "./core/policy.js";

export {
  validateMessage,
  sendReply,
  sendChunkedReply,
  addTypingIndicator,
  removeTypingIndicator,
} from "./core/dispatcher.js";

// Configuration
export {
  ConfigSchema,
  resolveCredentials,
  type Config,
  type GroupConfig,
  type Credentials,
} from "./config/schema.js";

// Types
export type {
  // Events
  MessageReceivedEvent,
  BotAddedEvent,
  BotRemovedEvent,
  MessageSender,
  MessagePayload,
  MessageMention,
  EventHandlers,
  // Messages
  SendTextParams,
  SendCardParams,
  EditMessageParams,
  SendResult,
  MessageInfo,
  ParsedMessage,
  ReceiveIdType,
  ChatType,
  ListMessagesParams,
  ListMessagesResult,
  HistoryMessage,
  MentionInfo,
  // Media
  UploadImageParams,
  UploadFileParams,
  SendMediaParams,
  ImageUploadResult,
  FileUploadResult,
  FileType,
  SendImageParams,
  SendFileParams,
  // Reactions
  Reaction,
  AddReactionParams,
  RemoveReactionParams,
  // Directory
  DirectoryUser,
  DirectoryGroup,
  ListDirectoryParams,
  // Probe
  ProbeResult,
} from "./types/index.js";

// Tools
export { createFeishuTools, createListMessagesTool } from "./plugin/tools.js";
