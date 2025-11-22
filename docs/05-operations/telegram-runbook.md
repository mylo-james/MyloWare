# Telegram Runbook

**Owner:** Platform / Integrations  \
**Last reviewed:** 2025-11-21

## Overview
Telegram is the only public chat surface we expose for Brendan. The API receives bot
webhooks at `/v1/telegram/webhook`, deduplicates update IDs for 60 seconds, and forwards
messages to `/v1/chat/brendan`. HITL notifications reuse the same chat thread so human
approvers never have to leave Telegram.

## Prerequisites
- `TELEGRAM_BOT_TOKEN` set in the API environment (Fly secret or `.env`).
- External base URL reachable by Telegram (e.g., `https://myloware-api-staging.fly.dev`).
- `TELEGRAM_WEBHOOK_URL` configured in Telegram (`https://api.telegram.org/bot$TOKEN/setWebhook`).
- API running with `ENABLE_LANGCHAIN_PERSONAS=true` if you need the personas to execute.

## Enabling the Bot
1. Export the bot token locally or load it from 1Password.
2. Point the webhook at the API:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://myloware-api-staging.fly.dev/v1/telegram/webhook"
   ```
3. Confirm the webhook is live:
   ```bash
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq .
   ```

## Smoke Test
1. Open Telegram → send `"Spin up a test_video_gen run"` to the bot.
2. Observe API logs (`make logs`) for `Processing Telegram message` entries (chat IDs are
   redacted, only suffixes are shown).
3. Approve workflow/ideate/prepublish gates directly from Telegram – each HITL interrupt
   posts a status + signed approval link back into the chat.
4. Watch LangSmith for the matching `brendan-chat` + `<project>-graph` traces.

## Idempotency
- Duplicate updates (same `update_id` or `chat_id/message_id`) within 60 seconds return
  `{ "ok": true, "duplicate": true }` and do not trigger new runs.
- Resetting the API process clears the cache; Telegram will resend the last update, which
  is why the cache window matches Telegram’s retry cadence.

## Error Handling & Sentry
- HTTP failures when calling the orchestrator send a polite “try again” message and are
  captured via Sentry (when DSN + SDK configured).
- Unexpected exceptions also post a fallback message and surface as Sentry events with the
  redacted chat ID.

## HITL Notifications
- When a run hits `ideate` or `prepublish`, `/v1/notifications/graph/{runId}` stores the
  notification artifact and sends the status back to Telegram if the original `user_id`
  started with `telegram_`.
- Messages include a signed approval URL (HMAC token) plus a reminder to reply for status
  updates once the gate is approved.

## Troubleshooting
| Symptom | Action |
| --- | --- |
| No replies in Telegram | Verify `TELEGRAM_BOT_TOKEN` secret, rerun the webhook setup command, ensure Fly ingress allows Telegram’s IPs. |
| Duplicate run starts | Check API logs for “Duplicate Telegram update skipped”; if absent, ensure system clock is correct so the 60s cache works. |
| HITL link missing | Confirm `public_base_url` is set so approval URLs resolve correctly. |
| Exceptions not visible | Ensure `sentry-sdk` is installed in the image and `SENTRY_DSN` is set; otherwise `capture_exception` is a no-op. |

## Related Files
- `apps/api/integrations/telegram.py` — webhook handler, idempotency cache, outbound replies.
- `apps/api/routes/notifications.py` — routes HITL notifications to Telegram when `user_id` begins with `telegram_`.
- `docs/stories/1.5.telegram-integration.md` — acceptance criteria and evidence.
