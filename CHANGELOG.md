# Changelog

All notable changes to this project will be documented in this file.

> Inspired by [samzong/moltbot-channel-feishu](https://github.com/samzong/moltbot-channel-feishu).

## [0.3.0] - 2026-02-05

### Added

- **Interactive Card Tool (`feishu_card`)**: AI can now send rich interactive cards
  - Structured content with headers, dividers, and multi-column layouts
  - Supports Feishu markdown (bold, italic, links, mentions)
  - Configurable header colors (blue, green, red, etc.)
  - Registered as an Agent Tool for seamless AI integration
- **Multi-Account Support**: Configure multiple Feishu apps in a single OpenClaw instance
  - New `accounts` configuration section for per-account settings
  - Each account can have independent credentials, policies, and settings
  - Accounts inherit from base config with per-account overrides
  - New functions: `listAccountIds()`, `getDefaultAccountId()`, `resolveAccount()`, `normalizeAccountId()`
- **Token Source Tracking**: Track where credentials come from (`config`, `file`, `env`, `none`)
- **Response Prefix**: New `responsePrefix` config option for prefixing all bot messages
- **App Secret File**: Support `appSecretFile` for reading secrets from file
- **Per-Sender Tool Policy (`toolsBySender`)**: Configure tool permissions per user within groups
  - Priority: `toolsBySender[senderId]` > `tools` > wildcard `toolsBySender["*"]`
  - Supports matching by senderId or senderName

### Changed

- **Enhanced `normalizeTarget`**: Now supports more prefixes (`feishu:`, `lark:`, `group:`, `dm:`)
  - Compatible with framework's `normalizeFeishuTarget` behavior

### Fixed

- **Auto-Reply NO_RESPONSE Detection**: Now supports both `[NO_RESPONSE]` and `NO_RESPONSE` formats
  - AI sometimes outputs without brackets, causing unintended message delivery
  - Detection now handles both exact match and contains check for both formats

## [0.2.4] - 2026-01-31

### Fixed

- **Message Duplicate Prevention**: Fixed critical bug where Feishu re-pushed messages after WebSocket reconnection
  - Root cause: Event handlers took >3 seconds (waiting for Agent), triggering Feishu's retry mechanism
  - Solution: Immediate ACK + async processing via per-chat message queue
- **Per-Chat Message Queue**: Messages in the same chat are processed serially to prevent race conditions
  - Different chats can process in parallel for better performance
  - Queue size logged for debugging
- **Message Watermark**: Track latest `create_time` per chat to filter stale messages on reconnect
- **Message Age Filter**: Skip messages older than 5 minutes as fallback protection

### Changed

- **Async Event Handling**: Event handlers now return immediately (<3s) to ACK, processing happens in background
- **MessagePayload Type**: Added `create_time` and `update_time` fields to match actual Feishu API response

## [0.2.1] - 2026-01-31

### Added

- **Auto-Reply Mode**: Bot can autonomously decide whether to respond in group chats
  - Dual-condition trigger: minimum message count AND minimum time window
  - Debounce mechanism: waits for chat to settle before evaluating
  - Agent decision: outputs `[NO_RESPONSE]` to silently skip responding
  - Configurable via `autoReply.enabled`, `minMessages`, `minTimeMs`, `debounceMs`
  - @mentions always trigger response regardless of auto-reply settings

### Fixed

- **Auto-Reply Time Condition**: When message count is met but time isn't, now correctly waits for remaining time instead of stopping

## [0.2.0] - 2026-01-31

### Added

- **Media Download Support**: Full support for receiving images, files, and audio from Feishu
  - Images: PNG, JPEG, GIF, WebP - downloaded and passed to OpenClaw for multi-modal processing
  - Files: PDF, DOC, TXT, etc. - downloaded with original filename preserved
  - Audio: Opus/Ogg voice messages - downloaded for agent processing
- **Configurable Media Directory**: New `mediaDir` config option
  - Default: System temp directory (`/tmp/openclaw-feishu-media/`)
  - Supports `~` expansion for home directory paths
- **Rich Text (Post) Message Parsing**: Proper handling of Feishu rich text messages
  - Extracts text, images, links, mentions from post content
  - First image in post is downloaded for multi-modal processing

### Changed

- **Rebranded to OpenClaw**: Updated package name and all references from Clawdbot to OpenClaw
  - Package: `@xzq-xu/feishu`
  - Removed legacy `clawdbot.plugin.json` and `moltbot.plugin.json`
- **Streaming Card Title**: Now optional - remove `title` from config for cleaner message preview

### Fixed

- **Message Resource API**: Use correct `im.messageResource.get` API for user-sent media
  - Previous `im.image.get` only worked for bot-uploaded images
- **Content Type Detection**: Improved MIME type detection from magic bytes
  - Added support for Ogg/Opus audio detection
  - Better file extension mapping

## [0.1.8] - 2025-01-30

### Changed

- **Simplified media handling**: Removed custom `![name](file://path)` format from reply-dispatcher
  - Media sending now only handled through Clawdbot's standard `outbound.sendMedia` interface
  - This aligns with Clawdbot's architecture - channel adapts to framework, not vice versa
  - Cleaner codebase, less confusion for Agent

### Fixed

- **File path resolution** (from v0.1.7): Searches multiple directories for relative paths
  - Searches: cwd, home, ~/.clawdbot, /workspaces
  - Better error messages

## [0.1.7] - 2025-01-30

### Fixed

- **File path resolution**: Now searches multiple directories for relative paths

## [0.1.6] - 2025-01-30

### Changed

- **File sending format**: Added `![name](file:///path)` format (now removed in v0.1.8)

## [0.1.5] - 2025-01-30

### Added

- **Auto-detect media files in replies** (now removed in v0.1.8)

### Fixed

- **Mention formatting in replies**: Agent replies now properly convert mentions to Feishu native format

## [0.1.4] - 2025-01-30

### Added

- **Full message type support for receiving**: Now parses all Feishu message types
  - image, file, audio, media, sticker, interactive, share_chat, share_user, post, location, video_chat, system

### Fixed

- **sendMedia error logging**: Now logs errors when media upload fails

## [0.1.3] - 2025-01-30

### Fixed

- **Batch Processing Debounce**: Increased debounce from 500ms to 2000ms, added max wait timer (10s)

## [0.1.2] - 2025-01-30

### Fixed

- **WebSocket Auto-Reconnect**: Exponential backoff reconnection (1s-60s, 20 attempts)

### Changed

- **Mention Format**: Uses Feishu native format throughout

## [0.1.1] - 2025-01-30

### Fixed

- **Mention Format Conversion**: `@[Name](open_id)` converts to Feishu native `<at>` tags

## [0.1.0] - 2025-01-29

### Added

- **Batch Message Processing**: Human-like message handling for group chats
- **History Messages API**: `listMessages()` for fetching chat history

## [0.0.3 - 0.0.9] - 2025-01-27 to 2025-01-29

- Initial fork and various fixes
