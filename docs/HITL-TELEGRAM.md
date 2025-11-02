# HITL Telegram Integration

## Overview

The Human-in-the-Loop (HITL) system now supports Telegram notifications, allowing approval requests to be sent directly to the user's Telegram chat where they initiated the workflow.

## How It Works

1. **User initiates workflow via Telegram** → n8n chat workflow captures `telegramChatId`
2. **Workflow creates a workflow run** → passes `telegramChatId` in the `input` JSONB field
3. **HITL approval needed** → `HITLService` extracts `telegramChatId` from workflow run
4. **Notification sent to Telegram** → User receives message in their original chat
5. **User responds** → Can be handled via n8n workflow or HITL API

## Setup

### 1. Environment Variable

Add your Telegram bot token to your environment:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

To get a bot token:
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the token provided

### 2. Workflow Integration

When creating a workflow run, include `telegramChatId` in the input:

```typescript
await workflowRunRepo.createWorkflowRun({
  projectId: 'aismr',
  sessionId: sessionId,
  input: {
    telegramChatId: chatId, // e.g., "6559268788"
    // ... other input data
  },
});
```

### 3. n8n Workflow (Already Configured)

The existing chat workflow (`workflows/chat.workflow.json`) already extracts and passes `telegramChatId`:

```javascript
// In "Normalize Chat Event" node
const telegramMessage = safeNodeData('Telegram Message Trigger')?.message ?? null;
let chatId = input.chatId ?? telegramMessage?.chat?.id ?? null;
```

## Notification Behavior

When `requestApproval()` is called:

1. **If `telegramChatId` is present** → Sends Telegram notification (default)
2. **If `telegramChatId` is missing** → Falls back to Slack (legacy behavior)
3. **Can be overridden** → Pass `notifyChannels: ['slack']` to force Slack

### Example Notification

```
🔔 *idea_generation Approval Needed*

Project: aismr

Review the content and reply to approve or reject.
```

## Handling User Responses

### Option A: n8n Workflow (Recommended)

Add a node in your n8n workflow to detect approval/rejection keywords:

```javascript
// In workflow
if (messageText.toLowerCase().includes('approve')) {
  // Call HITL approval API
  await fetch('https://your-api/api/hitl/approval/:id/approve', {
    method: 'POST',
    body: JSON.stringify({
      reviewedBy: userId,
      selectedItem: selectedContent,
      feedback: 'Approved via Telegram',
    }),
  });
}
```

### Option B: Direct API Integration

Users can also approve/reject via the existing HITL API endpoints:

- `POST /api/hitl/approval/:id/approve`
- `POST /api/hitl/approval/:id/reject`

## Testing

### 1. Set Environment Variable

```bash
export TELEGRAM_BOT_TOKEN=your_token
```

### 2. Start Server

```bash
npm run dev
```

### 3. Trigger HITL Flow

Send a message via Telegram that triggers a workflow requiring approval.

### 4. Verify Notification

Check that:
- You receive a Telegram message in your chat
- The message includes the stage name and project
- The message format is correct

## Migration Notes

### From Slack to Telegram

If you're migrating from Slack:

1. **Keep both tokens** for gradual rollout:
   ```bash
   SLACK_WEBHOOK_URL=https://hooks.slack.com/...
   TELEGRAM_BOT_TOKEN=your_token
   ```

2. **Workflow runs with `telegramChatId`** → Use Telegram
3. **Workflow runs without `telegramChatId`** → Fall back to Slack

### Future: Inline Keyboard Buttons

Future enhancement could use Telegram's inline keyboard for one-tap approval:

```javascript
{
  text: message,
  reply_markup: {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve:${approvalId}` },
      { text: '❌ Reject', callback_data: `reject:${approvalId}` }
    ]]
  }
}
```

This would require adding a Telegram webhook handler to process button callbacks.

## Troubleshooting

### No notification received

1. **Check bot token**: `echo $TELEGRAM_BOT_TOKEN`
2. **Check logs**: Look for "TELEGRAM_BOT_TOKEN not configured"
3. **Verify chatId**: Check workflow run `input` field contains `telegramChatId`

### Wrong chat receives notification

- Ensure `telegramChatId` matches the user's chat ID
- Check n8n workflow is extracting the correct `chat.id`

### Bot not responding

- Ensure you've started a conversation with the bot first
- Bot needs to have sent at least one message or been added to the chat

## Security Considerations

- **Bot token is sensitive**: Never commit to version control
- **Chat ID validation**: Consider validating that `chatId` belongs to an authorized user
- **Rate limiting**: Telegram API has rate limits (30 messages/second per chat)

## API Reference

### NotificationService

```typescript
interface NotifyParams {
  channels: string[];          // ['telegram', 'slack', 'email']
  message: string;             // Notification message
  link: string;                // Link to approval UI (optional)
  data?: unknown;              // Additional context
  telegramChatId?: string;     // Required for Telegram channel
}

// Usage
await notificationService.notify({
  channels: ['telegram'],
  message: 'Approval needed',
  link: '/hitl/review/123',
  telegramChatId: '6559268788',
});
```

### HITLService

```typescript
interface RequestApprovalParams {
  workflowRunId: string;
  stage: WorkflowStage;
  content: unknown;
  notifyChannels?: string[];   // Optional, defaults to ['telegram'] if chatId present
}

// The service automatically extracts telegramChatId from workflow run input
```

