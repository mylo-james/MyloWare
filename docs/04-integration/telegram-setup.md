# Telegram Setup

**Audience:** Operators setting up Telegram integration  
**Outcome:** Telegram bot connected to MyloWare

---

## Overview

Telegram provides the user interface for MyloWare. Users send messages to the bot, which triggers the universal workflow.

---

## Prerequisites

- Telegram account
- MyloWare running locally or in production
- n8n instance accessible

---

## Steps

### 1. Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow prompts to name your bot
4. Save the bot token (looks like `123456:ABC-DEF...`)

### 2. Configure Environment

Add to `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_USER_ID=your-telegram-user-id
```

To find your user ID:
1. Message [@userinfobot](https://t.me/userinfobot)
2. Copy the ID number

### 3. Configure n8n Webhook

In n8n, configure the Telegram trigger node:

**Bot Token:** Use credential or env var  
**Webhook URL:** Provided by n8n after activation  
**Updates:** All message types

### 4. Set Telegram Webhook

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"https://n8n.yourdomain.com/webhook/telegram\"
  }"
```

### 5. Test Connection

Send a message to your bot:

```
Make an AISMR video about candles
```

You should receive a response from Casey.

---

## Validation

✅ Bot responds to messages  
✅ Messages trigger universal workflow  
✅ Casey creates trace and hands off to Iggy  
✅ You receive notifications at key checkpoints

---

## HITL (Human-in-the-Loop)

The workflow includes Telegram "Send and Wait" nodes for approvals:

### Iggy Approval
After generating ideas, Iggy sends:
```
Here are 12 AISMR modifiers:
1. Void Candle
2. Liquid Candle
...

Approve these ideas?
[✅ Approve] [❌ Reject]
```

### Alex Approval
After editing, Alex sends:
```
Final compilation ready (110s):
[Video preview]

Approve for publishing?
[✅ Publish] [❌ Revise]
```

---

## Commands

Configure bot commands via @BotFather:

```
/start - Start conversation
/help - Show help
/status - Check current trace status
/cancel - Cancel current production run
```

---

## Security

### Restrict Access

Add user ID check in n8n:

```javascript
// In Edit Fields node
if ($json.userId !== '{{ $env.TELEGRAM_USER_ID }}') {
  throw new Error('Unauthorized user');
}
```

### Rate Limiting

Add rate limit node before workflow:

```javascript
// Check message frequency
const key = `telegram:${$json.userId}`;
const count = await redis.incr(key);
await redis.expire(key, 60); // 1 minute window

if (count > 10) {
  throw new Error('Rate limit exceeded');
}
```

---

## Notifications

### Completion Notification

When Quinn calls `handoff_to_agent({ toAgent: 'complete' })`, the tool automatically sends:

```
🎉 Your AISMR candles video is live!

Watch: https://tiktok.com/@mylo_aismr/video/...

✨ 12 surreal variations
⏱️ 110 seconds total
🚀 Published with optimized caption

Want to create another?
```

### Error Notification

When any agent calls `handoff_to_agent({ toAgent: 'error' })`:

```
❌ Production run failed

Error: Content policy violation on Electric Candle

The trace has been marked as failed. You can start a new run anytime.
```

---

## Advanced Configuration

### Custom Commands

Add custom command handlers in n8n:

```javascript
// In Switch node
switch ($json.message) {
  case '/status':
    // Query trace status
    return 'status';
  case '/cancel':
    // Cancel active trace
    return 'cancel';
  default:
    return 'default';
}
```

### Rich Media

Send videos/images in notifications:

```javascript
// In Telegram node
{
  "chatId": "{{ $json.userId }}",
  "type": "video",
  "file": "{{ $json.videoUrl }}",
  "caption": "Your video is ready!"
}
```

---

## Validation

✅ Bot receives and responds to messages  
✅ Workflow creates traces correctly  
✅ HITL approval nodes work  
✅ Completion notifications sent  
✅ Error notifications sent

---

## Next Steps

- [n8n Universal Workflow](n8n-universal-workflow.md) - Workflow details
- [MCP Integration](mcp-integration.md) - MCP protocol
- [Observability](../05-operations/observability.md) - Monitor executions

---

## Troubleshooting

**Bot not responding?**
- Check webhook is set: `curl https://api.telegram.org/bot${TOKEN}/getWebhookInfo`
- Verify n8n workflow is active
- Check n8n logs for errors

**Messages not triggering workflow?**
- Verify Telegram trigger node is enabled
- Check webhook URL matches Telegram webhook
- Test webhook directly: `curl -X POST [webhook-url]`

**Notifications not sent?**
- Check `TELEGRAM_BOT_TOKEN` is set
- Verify user ID matches
- Check Telegram API limits

See [Troubleshooting Guide](../05-operations/troubleshooting.md) for more help.

