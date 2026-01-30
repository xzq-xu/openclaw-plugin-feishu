# openclaw-plugin-feishu

**Turn Feishu into your AI super-gateway.** A production-grade Feishu/Lark channel plugin for [OpenClaw](https://openclaw.ai) — the brilliant AI agent framework.

> Forked from [samzong/clawdbot-plugin-feishu](https://github.com/samzong/clawdbot-plugin-feishu). Thanks to the original author for the foundation.

## Features

- **Human-like Message Processing** — Bot reads all accumulated messages before responding, just like a human catching up on a conversation
- **Intelligent Batching** — Groups messages by chat, flushes on trigger (like @mention) with full context
- **Mention Preservation** — Non-bot @mentions are preserved as `@[Name](open_id)` so Agent can @ users back
- **Extensible Triggers** — `@mention` is just one trigger type; architecture supports keywords, schedules, etc.
- **History Messages API** — Fetch chat history with pagination for context gathering
- **Flexible Access Control** — DM policies (open/pairing/allowlist) and group policies (open/allowlist/disabled)
- **Dual Domain Support** — Works with both Feishu (China) and Lark (International)

## Install

```bash
# npm
openclaw plugins install @xzq-xu/feishu

# GitHub (for testing)
openclaw plugins install github:xzq-xu/openclaw-plugin-feishu
```

## Configure

Edit `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "domain": "feishu",
      "dmPolicy": "pairing",
      "groupPolicy": "open"
    }
  }
}
```

Or use environment variables (takes precedence if config values are empty):

```bash
export FEISHU_APP_ID="cli_xxx"
export FEISHU_APP_SECRET="xxx"
```

### Configuration Options

| Field            | Type                                      | Default       | Description                                            |
| ---------------- | ----------------------------------------- | ------------- | ------------------------------------------------------ |
| `enabled`        | boolean                                   | `false`       | Enable/disable the channel                             |
| `appId`          | string                                    | -             | Feishu App ID                                          |
| `appSecret`      | string                                    | -             | Feishu App Secret                                      |
| `domain`         | `"feishu"` \| `"lark"`                    | `"feishu"`    | API domain (China / International)                     |
| `dmPolicy`       | `"open"` \| `"pairing"` \| `"allowlist"`  | `"pairing"`   | DM access policy                                       |
| `allowFrom`      | string[]                                  | `[]`          | User IDs allowed for DM (when `dmPolicy: "allowlist"`) |
| `groupPolicy`    | `"open"` \| `"allowlist"` \| `"disabled"` | `"allowlist"` | Group chat access policy                               |
| `groupAllowFrom` | string[]                                  | `[]`          | Group IDs allowed (when `groupPolicy: "allowlist"`)    |
| `requireMention` | boolean                                   | `true`        | Require @mention in groups                             |

### Media Options

| Field      | Type   | Default                      | Description                                |
| ---------- | ------ | ---------------------------- | ------------------------------------------ |
| `mediaDir` | string | System temp dir (`/tmp/...`) | Directory to save downloaded media files   |
| `mediaMaxMb` | number | -                          | Maximum media file size in MB              |

The plugin downloads images, files, and audio from Feishu messages. By default, files are saved to the system temp directory (e.g., `/tmp/openclaw-feishu-media/`). You can customize this:

```json
{
  "channels": {
    "feishu": {
      "mediaDir": "~/.openclaw/media/feishu"
    }
  }
}
```

Supported media types:
- **Images**: PNG, JPEG, GIF, WebP
- **Files**: PDF, DOC, TXT, etc.
- **Audio**: Opus/Ogg (Feishu voice messages)

### Streaming Message Options

| Field                            | Type    | Default | Description                                      |
| -------------------------------- | ------- | ------- | ------------------------------------------------ |
| `blockStreamingCoalesce.enabled` | boolean | `false` | Enable streaming message coalescing              |
| `blockStreamingCoalesce.minDelayMs` | number | -    | Minimum delay before sending coalesced message   |
| `blockStreamingCoalesce.maxDelayMs` | number | -    | Maximum delay before forcing message send        |
| `streamingCard.enabled`          | boolean | `false` | Enable streaming card (shows "typing" indicator) |
| `streamingCard.title`            | string  | -       | Title shown on the streaming card                |
| `textChunkLimit`                 | number  | `4000`  | Max characters per message chunk                 |

Example with streaming enabled:

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "blockStreamingCoalesce": {
        "enabled": true,
        "minDelayMs": 500,
        "maxDelayMs": 2000
      },
      "streamingCard": {
        "enabled": true,
        "title": "正在思考..."
      }
    }
  }
}
```

## How It Works

### Human-like Batch Processing

Unlike typical bots that respond to each message immediately, this plugin processes messages like a human would:

1. **Startup Window (10s)**: When the bot connects, it buffers all incoming messages
2. **Trigger Detection**: `@mention` (or other triggers) signals the bot should respond
3. **Context Gathering**: Bot reads ALL buffered messages, not just the trigger
4. **Single Response**: Bot responds once with full conversation context

```
Example: Bot was offline, 5 messages arrive:

  User A: "Let's discuss the project timeline"
  User B: "@bot what do you think?"        ← trigger
  User A: "Budget is around $100k"
  User C: "@bot please summarize"          ← trigger
  User A: "Deadline is next Monday"

OLD behavior: Bot responds twice (to each @mention), missing context
NEW behavior: Bot sees all 5 messages, understands full context, responds ONCE
```

### Mention Handling

Non-bot mentions are preserved with their `open_id`, enabling the Agent to @ users in responses:

```
Inbound message:  "Hi @张三 what do you think?"
Parsed content:   "Hi @[张三](ou_xxx) what do you think?"
ParsedMessage.mentions: [{ name: "张三", openId: "ou_xxx" }]

Agent response:   "I agree with @[张三](ou_xxx)'s point..."
Sent to Feishu:   "I agree with <at user_id="ou_xxx">张三</at>'s point..."
```

Bot mentions (`@bot`) are stripped completely to reduce noise.

### Extensible Trigger System

The `@mention` is just the default trigger. The architecture supports:

- **Keyword triggers**: Respond when specific words appear
- **Scheduled triggers**: Periodic check-ins
- **Custom triggers**: Implement the `Trigger` interface

```typescript
// src/core/triggers/index.ts
export interface Trigger {
  name: string;
  check(ctx: TriggerContext): boolean;
}
```

## Feishu App Setup

1. Go to [Feishu Open Platform](https://open.feishu.cn)
2. Create a self-built app
3. Enable permissions: `im:message`, `im:chat`, `contact:user.base:readonly`
4. Events → Use **Long Connection** mode
5. Subscribe to event: `im.message.receive_v1`
6. Get App ID and App Secret from **Credentials** page
7. Publish the app

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

[MIT](LICENSE)
