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
| `OPENAI_STANDARD_WEBHOOK_SECRET` | — | Standard Webhooks secret (`webhook-signature`) for OpenAI events (e.g., Sora `video.completed`) |
| `OPENAI_SORA_SIGNING_SECRET` | — | Sora HMAC secret (legacy/fallback) |
| `SORA_PROVIDER` | `real` | `real\|fake\|off` |
| `SORA_FAKE_CLIPS_DIR` | `fake_clips/sora` | MP4 fixtures directory (fake mode) |
| `SORA_FAKE_CLIP_PATHS` | — | Comma-separated MP4 paths (fake mode) |
| `REMOTION_SERVICE_URL` | — | Remotion render service |
| `REMOTION_API_SECRET` | — | Remotion authentication |
| `REMOTION_WEBHOOK_SECRET` | — | HMAC secret for verifying Remotion callbacks (API side) |
| `WEBHOOK_SECRET` | — | Remotion service webhook signing secret (service side; should match `REMOTION_WEBHOOK_SECRET`) |
| `REMOTION_PROVIDER` | `real` | `real\|fake\|off` |
| `UPLOAD_POST_API_KEY` | — | Upload-Post API key (required when provider is real) |
| `UPLOAD_POST_API_URL` | `https://api.upload-post.com` | Upload-Post API base URL |
| `UPLOAD_POST_PROVIDER` | `real` | `real\|fake\|off` |
| `UPLOAD_POST_POLL_INTERVAL_S` | `10.0` | Polling interval (seconds) when Upload-Post returns async request_id |
| `UPLOAD_POST_POLL_TIMEOUT_S` | `600.0` | Polling timeout (seconds) for async Upload-Post publishes |
| `MEDIA_ACCESS_TOKEN` | — | Optional bearer token required for `/v1/media/*` endpoints |
| `PUBLIC_DEMO_ENABLED` | `false` | Enable public demo endpoints (motivational-only) |
| `PUBLIC_DEMO_ALLOWED_WORKFLOWS` | `motivational` | Comma-separated allowlist for public demo workflows |
| `PUBLIC_DEMO_TOKEN_TTL_HOURS` | `72` | TTL for public demo run tokens |
| `PUBLIC_DEMO_RATE_LIMIT` | `10/minute` | Rate limit for demo run starts |
| `PUBLIC_DEMO_CORS_ORIGINS` | `https://myloware.mjames.dev` | Comma-separated CORS allowlist for demo UI |

---

## Scaling / Workers

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKFLOW_DISPATCHER` | `inprocess` | `inprocess\|db` (`db` enqueues durable jobs to Postgres for worker processes) |
| `WORKER_CONCURRENCY` | `4` | Max concurrent jobs per worker process |
| `WORKER_ID` | — | Optional worker identifier (auto-generated if empty) |
| `JOB_POLL_INTERVAL_SECONDS` | `1.0` | Worker poll interval when no jobs are available |
| `JOB_LEASE_SECONDS` | `600.0` | Job lease duration; workers renew while running |
| `JOB_MAX_ATTEMPTS` | `5` | Default retry attempts for queued jobs |
| `JOB_RETRY_DELAY_SECONDS` | `5.0` | Base retry delay (worker applies simple backoff) |

---

## Transcode Storage (Media)

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSCODE_STORAGE_BACKEND` | `local` | `local\|s3` (`s3` recommended for multi-replica) |
| `TRANSCODE_OUTPUT_DIR` | `/tmp/myloware_videos` | Local output dir for transcoded clips (must be shared between API and workers) |
| `TRANSCODE_ALLOW_FILE_URLS` | `false` | Allow `file://` URLs for transcode inputs (local-only) |
| `TRANSCODE_S3_BUCKET` | — | S3 bucket when `TRANSCODE_STORAGE_BACKEND=s3` |
| `TRANSCODE_S3_PREFIX` | `myloware/transcoded` | Object key prefix for uploaded clips |
| `TRANSCODE_S3_ENDPOINT_URL` | — | Optional endpoint for S3-compatible storage (R2/MinIO) |
| `TRANSCODE_S3_REGION` | — | Region for AWS S3 client (if required) |
| `TRANSCODE_S3_PRESIGN_SECONDS` | `86400` | Presigned GET TTL for renderer access |

Note: S3 mode requires `boto3` (install with `pip install 'myloware[s3]'`) and standard AWS credentials
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`).

---

## Safety

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_SAFETY_SHIELDS` | `true` | Enable Llama Guard |
| `CONTENT_SAFETY_SHIELD_ID` | `together/meta-llama/Llama-Guard-4-12B` | Shield identifier / model ID |

**Note**: Safety is fail-closed. Shield errors block requests.
In production code, shields are forced on (setting `ENABLE_SAFETY_SHIELDS=false` is ignored).

---

## Remotion Sandbox

| Variable | Default | Description |
|----------|---------|-------------|
| `REMOTION_SANDBOX_ENABLED` | `false` | Enable sandbox mode |
| `REMOTION_ALLOW_COMPOSITION_CODE` | `false` | Allow dynamic code |
| `REMOTION_SANDBOX_STRICT` | `false` | Require strict sandbox enforcement before enabling dynamic code |

**Warning**: Only enable `ALLOW_COMPOSITION_CODE` in isolated environments.

---

## Remotion Service (services/remotion)

| Variable | Default | Description |
|----------|---------|-------------|
| `REMOTION_MAX_JOBS` | `1000` | Max in-memory job records retained |
| `REMOTION_JOB_TTL_SECONDS` | `21600` | Prune completed/error jobs older than this |
| `REMOTION_OUTPUT_TTL_SECONDS` | `86400` | Prune rendered MP4s older than this |
| `REMOTION_OUTPUT_PUBLIC` | `false` | Serve `/output` without auth when true |
| `REMOTION_CALLBACK_ALLOWLIST` | — | Comma-separated hostname allowlist for render callbacks |
| `REMOTION_CALLBACK_TIMEOUT_MS` | `5000` | Timeout for webhook callbacks (ms) |
| `REMOTION_RENDER_TIMEOUT_SECONDS` | `900` | Max render duration before cancellation |
| `REMOTION_FRAME_CONCURRENCY` | `100%` | Frame render concurrency (number or percentage) |
| `REMOTION_BUNDLE_CACHE_MAX` | `32` | Max cached bundles to keep in memory |
| `REMOTION_BUNDLE_CACHE_TTL_SECONDS` | `3600` | Bundle cache TTL (seconds) |
| `REMOTION_BROWSER_IDLE_TTL_SECONDS` | `300` | Close Chromium if idle for this long (seconds) |

---

## Development

| Variable | Default | Description |
|----------|---------|-------------|
| `USE_FAKE_PROVIDERS` | `false` | Convenience switch: treat providers as fake in dev/tests |
| `DISABLE_BACKGROUND_WORKFLOWS` | `false` | Skip background workflow execution (fast tests) |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
