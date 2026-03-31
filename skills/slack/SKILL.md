---
name: slack
description: Use when you need to control Slack from OpenClaw via the slack tool, including rich analytics blocks, canvases, reactions, and message/pin operations in Slack channels or DMs.
metadata: { "openclaw": { "emoji": "💬", "requires": { "config": ["channels.slack"] } } }
---

# Slack Actions

## Overview

Use `slack` to react, manage pins, send/edit/delete messages, fetch member info, build rich analytics replies, and create Slack canvases. The tool uses the configured Slack bot token unless a Slack user token override is explicitly enabled for the relevant operation.

## Inputs to collect

- `channelId` and `messageId` (Slack message timestamp, e.g. `1712023032.1234`).
- For reactions, an `emoji` (Unicode or `:name:`).
- For message sends, a `to` target (`channel:<id>` or `user:<id>`) and `content`/rich helper payloads.
- For canvases, a `title` and report `content`, plus `canvasId` for edits.

Message context lines include `slack message id` and `channel` fields you can reuse directly.

## Action groups

| Action group | Default  | Notes                              |
| ------------ | -------- | ---------------------------------- |
| reactions    | enabled  | React + list reactions             |
| messages     | enabled  | Read/send/edit/delete              |
| pins         | enabled  | Pin/unpin/list                     |
| memberInfo   | enabled  | Member info                        |
| emojiList    | enabled  | Custom emoji list                  |
| canvases     | disabled | Explicit opt-in for canvas actions |

Enable canvases before using `createCanvas` / `editCanvas`:

```yaml
channels:
  slack:
    actions:
      canvases: true
```

## Core actions

### React to a message

```json
{
  "action": "react",
  "channelId": "C123",
  "messageId": "1712023032.1234",
  "emoji": "✅"
}
```

### List reactions

```json
{
  "action": "reactions",
  "channelId": "C123",
  "messageId": "1712023032.1234"
}
```

### Send a plain message

```json
{
  "action": "sendMessage",
  "to": "channel:C123",
  "content": "Hello from OpenClaw"
}
```

### Edit a message

```json
{
  "action": "editMessage",
  "channelId": "C123",
  "messageId": "1712023032.1234",
  "content": "Updated text"
}
```

### Delete a message

```json
{
  "action": "deleteMessage",
  "channelId": "C123",
  "messageId": "1712023032.1234"
}
```

### Read recent messages

```json
{
  "action": "readMessages",
  "channelId": "C123",
  "limit": 20
}
```

### Pin / unpin / list pins

```json
{ "action": "pinMessage", "channelId": "C123", "messageId": "1712023032.1234" }
```

```json
{ "action": "unpinMessage", "channelId": "C123", "messageId": "1712023032.1234" }
```

```json
{ "action": "listPins", "channelId": "C123" }
```

### Member info

```json
{
  "action": "memberInfo",
  "userId": "U123"
}
```

### Emoji list

```json
{
  "action": "emojiList"
}
```

## Rich analytics replies

`sendMessage` and `editMessage` support helper payloads that render Slack blocks for analytics answers:

- `kpis`: KPI tiles rendered via section fields
- `table`: table-style data rendered as monospace section blocks
- `chart`: chart image rendered via a public QuickChart URL

Example:

```json
{
  "action": "sendMessage",
  "to": "channel:C123",
  "content": "Marketplace weekly snapshot",
  "kpis": [
    { "label": "DAU", "value": "4,321", "delta": "+12% WoW", "trend": "up" },
    { "label": "Placements", "value": 18 }
  ],
  "table": {
    "title": "Top specialties",
    "rows": [
      { "specialty": "ICU", "placements": 7 },
      { "specialty": "ER", "placements": 5 }
    ]
  },
  "chart": {
    "title": "Offers by week",
    "altText": "Line chart of weekly offers",
    "config": {
      "type": "line",
      "data": {
        "labels": ["W1", "W2"],
        "datasets": [{ "label": "Offers", "data": [10, 14] }]
      }
    }
  }
}
```

Rules:

- Rich helpers can be combined with `content`.
- Rich helpers **cannot** be combined with raw `blocks` in the same call.
- `chart` uses a public third-party URL. Do not use it for sensitive or regulated data.

## Canvases

Use canvases for long-form reports that would be awkward in a normal Slack message.

### Create a canvas

```json
{
  "action": "createCanvas",
  "title": "Weekly marketplace report",
  "content": "# Weekly marketplace report\n\n## Summary\n- Placements up 12%\n- PQLs flat"
}
```

### Edit a canvas

```json
{
  "action": "editCanvas",
  "canvasId": "F123",
  "change": {
    "operation": "insert_at_end",
    "document_content": {
      "type": "markdown",
      "markdown": "\n\n## Appendix\n- Added after initial create"
    }
  }
}
```

Guardrails:

- Prefer putting the initial report body directly into `createCanvas.content`.
- `editCanvas` supports exactly one change object per call.
- If Slack returns a missing-scope error, add the needed canvas scope(s), reinstall the app, and retry.

## Streaming note

OpenClaw already supports native Slack text streaming (`chat.startStream` / `chat.appendStream` / `chat.stopStream`) when Slack streaming is enabled in config. Rich block replies still work; they simply finalize through the existing preview/edit delivery path instead of native text streaming.

## Ideas to try

- React with ✅ to mark completed tasks.
- Pin key decisions or weekly status updates.
- Use KPI/table/chart helpers for analytics summaries in threads.
- Use canvases for long reports, then send the canvas link back into the thread if needed.
