# Deploy

Production deployment to Fly.io.

---

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed
- Fly.io account

---

## Initial Setup

```bash
# Login
fly auth login

# Create app
fly apps create myloware-api

# Create Postgres
fly postgres create --name myloware-db
fly postgres attach myloware-db --app myloware-api
```

---

## Configure Secrets

```bash
fly secrets set \
  API_KEY="your-production-api-key" \
  TOGETHER_API_KEY="your-together-key" \
  LLAMA_STACK_URL="http://llama-stack.internal:5001" \
  WEBHOOK_BASE_URL="https://myloware-api.fly.dev" \
  WORKFLOW_DISPATCHER="db"
```

---

## Deploy

```bash
fly deploy
```

---

## Verify

```bash
curl https://myloware-api.fly.dev/health
```

---

## Monitoring

View logs:

```bash
fly logs
```

SSH into instance:

```bash
fly ssh console
```

---

## Scaling

Scale API horizontally:

```bash
fly scale count 2 --process app
```

Scale workers horizontally (recommended):

```bash
fly scale count 2 --process worker
```

Scale vertically (either process):

```bash
fly scale vm shared-cpu-2x
```

---

## Notes (Media Storage)

If you run workers, transcoded clip artifacts must be readable by the Remotion renderer:
- Single-machine deployments can use `TRANSCODE_STORAGE_BACKEND=local` with a shared volume.
- Multi-machine deployments should use `TRANSCODE_STORAGE_BACKEND=s3` (S3/R2/MinIO) and install the optional extra:
  `pip install 'myloware[s3]'`.
