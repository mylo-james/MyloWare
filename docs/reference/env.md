# Environment Variables

All configuration options for MyloWare.

---

## Required

| Variable | Description |
|----------|-------------|
| `API_KEY` | API authentication key |
| `LLAMA_STACK_URL` | Llama Stack server URL |

---

## Llama Stack

| Variable | Default | Description |
|----------|---------|-------------|
| `LLAMA_STACK_URL` | — | Base URL (e.g., `http://localhost:5001`) |
| `LLAMA_STACK_MODEL` | `openai/gpt-5-nano` | Default model |
| `LLAMA_STACK_PROVIDER` | `real` | `real\|fake\|off` (fake avoids network in tests/dev) |
| `OPENAI_API_KEY` | — | OpenAI API key (embeddings + Sora when enabled) |
| `BRAVE_API_KEY` | — | For web search tool |

---

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+psycopg2://myloware:myloware@localhost:5432/myloware` | Database connection string |

---

## Providers & Webhooks

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_BASE_URL` | — | Public URL for callbacks (required for real providers in prod) |
| `OPENAI_STANDARD_WEBHOOK_SECRET` | — | Standard Webhooks secret (`webhook-signature`) |
| `OPENAI_SORA_SIGNING_SECRET` | — | Sora HMAC secret (legacy/fallback) |
| `SORA_PROVIDER` | `real` | `real\|fake\|off` |
| `SORA_FAKE_CLIPS_DIR` | `fake_clips/sora` | MP4 fixtures directory (fake mode) |
| `SORA_FAKE_CLIP_PATHS` | — | Comma-separated MP4 paths (fake mode) |
| `REMOTION_SERVICE_URL` | — | Remotion render service |
| `REMOTION_API_SECRET` | — | Remotion authentication |
| `REMOTION_PROVIDER` | `real` | `real\|fake\|off` |
| `UPLOAD_POST_PROVIDER` | `real` | `real\|fake\|off` |

---

## Safety

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_SAFETY_SHIELDS` | `true` | Enable Llama Guard |
| `CONTENT_SAFETY_SHIELD_ID` | `content_safety` | Shield identifier |

**Note**: Safety is fail-closed. Shield errors block requests.

---

## Remotion Sandbox

| Variable | Default | Description |
|----------|---------|-------------|
| `REMOTION_SANDBOX_ENABLED` | `false` | Enable sandbox mode |
| `REMOTION_ALLOW_COMPOSITION_CODE` | `false` | Allow dynamic code |

**Warning**: Only enable `ALLOW_COMPOSITION_CODE` in isolated environments.

---

## Development

| Variable | Default | Description |
|----------|---------|-------------|
| `DISABLE_BACKGROUND_WORKFLOWS` | `false` | Skip background workflow execution (fast tests) |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
