# Changelog

All notable changes to this project will be documented in this file.

> This project is forked from [samzong/clawdbot-plugin-feishu](https://github.com/samzong/clawdbot-plugin-feishu). Thanks to the original author for the foundation.

## [0.1.4] - 2025-01-30

### Added

- **Full message type support for receiving**: Now parses all Feishu message types
  - `image` → `[图片: image_key]`
  - `file` → `[文件: filename (file_key)]`
  - `audio` → `[语音消息: file_key]`
  - `media` → `[媒体: filename]`
  - `sticker` → `[表情包: file_key]`
  - `interactive` → `[卡片: title]` or `[交互卡片]`
  - `share_chat` → `[分享群聊: chat_id]`
  - `share_user` → `[分享用户: user_id]`
  - `post` → Extracts text content or `[富文本: title]`
  - `location` → `[位置: name]`
  - `video_chat` → `[视频会议]`
  - `system` → `[系统消息]`
  - Unknown types → `[type消息]`

### Fixed

- **sendMedia error logging**: Now logs errors when media upload fails instead of silently falling back to URL text

## [0.1.3] - 2025-01-30

### Fixed

- **Batch Processing Debounce**: Fixed rapid message triggering issue
  - Increased debounce from 500ms to 2000ms - wait for user to finish typing before responding
  - Added max wait timer (10s) - ensures response even if messages keep coming
  - Previously, each @mention would trigger a separate response; now batches all messages properly
  - Added detailed logging for debugging batch processor behavior

## [0.1.2] - 2025-01-30

### Fixed

- **WebSocket Auto-Reconnect**: Gateway now automatically reconnects when connection drops
  - Exponential backoff: 1s → 2s → 4s → ... → 60s (max)
  - Up to 20 retry attempts before giving up
  - Detailed logging for connection state changes
  - Previously, network fluctuations would silently drop the connection, causing missed messages

### Changed

- **Mention Format**: Now uses Feishu native format throughout
  - Inbound: Non-bot mentions preserved as `<at user_id="ou_xxx">Name</at>` (was `@[Name](ou_xxx)`)
  - Outbound: Agent should use `<at user_id="ou_xxx">Name</at>` directly
  - Legacy `@[Name](open_id)` format still supported for backward compatibility
  - This fixes issues with usernames containing special characters like brackets (e.g., `Vacuum[吸尘器]`)

## [0.1.1] - 2025-01-30

### Fixed

- **Mention Format Conversion**: `@[Name](open_id)` now correctly converts to Feishu native `<at user_id="...">` tags when sending messages
  - Previously the format was preserved in code but not applied during `sendTextMessage()` and `editMessage()`
  - Agent responses with mentions like `@[张三](ou_xxx)` now render as clickable @mentions in Feishu

## [0.1.0] - 2025-01-29

### Added

- **Batch Message Processing**: Human-like message handling for group chats
  - Bot now buffers messages and responds once with full context (like a human reading catch-up messages)
  - `@mention` serves as a trigger mechanism, not a special message type
  - Extensible trigger system (`src/core/triggers/`) for future trigger types (keywords, scheduled, etc.)
- **Startup Window Mode**: 10-second initial buffer to collect all pending messages after reconnect
- **Realtime Mode**: 500ms debounce after trigger for immediate responses
- **Idle Flush**: Automatic flush after 1 second of inactivity
- **DM Bypass**: Direct messages skip batching for immediate response
- **Mention Format Preservation**: Non-bot mentions are preserved with open_id for Agent to @ users
  - Inbound: `@张三` → `@[张三](ou_xxx)` in message content + `mentions[]` array in `ParsedMessage`
  - Outbound: `@[张三](ou_xxx)` → `<at user_id="ou_xxx">张三</at>` via `formatMentionsForFeishu()`
  - Bot mentions are stripped completely (no noise for the Agent)
- **History Messages API**: `listMessages()` for fetching chat history with pagination

### Architecture

```
src/core/
├── triggers/
│   ├── index.ts           # Trigger interface (extensible)
│   └── mention.ts         # MentionTrigger implementation
├── batch-processor.ts     # Core batching logic
├── handler.ts             # Message routing
└── gateway.ts             # Lifecycle management
```

## [0.0.9] - 2025-01-29

### Fixed

- **Message History Order**: `feishu_list_messages` now returns newest messages first
  - Added `sort_type: "ByCreateTimeDesc"` parameter to Feishu API call
  - Previously returned oldest messages, making recent context unavailable

## [0.0.8] - 2025-01-28

### Fixed

- Return correct tool result format for Clawdbot compatibility
- Add better error handling and logging for `listMessages`

## [0.0.7] - 2025-01-28

### Fixed

- Add `@sinclair/typebox` to dependencies

## [0.0.6] - 2025-01-28

### Fixed

- Use correct Clawdbot tool interface with `execute` method

## [0.0.5] - 2025-01-28

### Changed

- Rename package from `@samzong/feishu` to `@xzq_xu/feishu`
- Credit original repository in documentation

## [0.0.4] - 2025-01-28

### Fixed

- Simplify bot identity prompt for clearer agent understanding
- Use correct API endpoint for bot info
- Probe bot info in `startAccount` before gateway starts

## [0.0.3] - 2025-01-27

### Added

- Initial fork from [samzong/clawdbot-plugin-feishu](https://github.com/samzong/clawdbot-plugin-feishu)
- Basic Feishu/Lark channel support for Clawdbot
- WebSocket-based event handling
- Message send/receive capabilities
- Access policy engine (DM and group policies)
