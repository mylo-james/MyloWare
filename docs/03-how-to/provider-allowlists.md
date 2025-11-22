# Provider Allowlists & SSRF Controls

Outbound adapters refuse to call arbitrary hosts. This document explains how to
update the allowlists when infrastructure changes (e.g., new provider domains,
Cloudflare tunnels), plus the validation steps required before deploys.

## Why it exists

- Prevent SSRF escalation when personas proxy user input to tools.
- Keep callback/webhook domains pinned to known infrastructure.
- Provide predictable failure messages in Brendan/Quinn logs when a host is not approved.

All helpers live in `adapters/security/host_allowlist.py`. Most adapters call
`ensure_host_allowed(host, allowed_hosts, component=...)` during initialization.

## Default allowlists

| Component | Path | Default Hosts |
| --- | --- | --- |
| Kie.ai client | `adapters/ai_providers/kieai/client.py` | `api.kie.ai`, `staging-api.kie.ai` |
| Shotstack client | `adapters/ai_providers/shotstack/client.py` | `api.shotstack.io`, `api.shotstack.dev` |
| Upload Post client | `adapters/social/upload_post/client.py` | `api.upload-post.dev`, `api.upload-post.com` |
| FFmpeg normalizer | `content/editing/normalization/ffmpeg.py` | CDN domains for mock assets (see `DEFAULT_FFMPEG_ALLOWED_HOSTS`) |
| Cloudflare tunnel | `cloudflared/config.yml` | Must forward `myloware-api-staging.fly.dev` via `httpHostHeader` + `originServerName` |

Add new hosts when infrastructure changes (e.g., new Fly app, provider beta API)
by editing the relevant client module and updating `tests/unit/adapters/test_host_allowlists.py`.

## Procedure for updating allowlists

1. **Decide the domain(s)** – confirm production and staging hostnames.
2. **Update adapter module** – append the new host to `_allowed_hosts` or `_DEFAULT_ALLOWED_HOSTS`.
3. **Adjust infra configs** – e.g., `cloudflared/config.yml` must forward correct host headers so allowlists see the expected domain.
4. **Add migrations/secrets if needed** – update `.env` or Fly secrets to match the new base URL.
5. **Update docs** – mention the change here plus project-specific RUNBOOKs.
6. **Run tests**:
   ```bash
   make test TESTS=tests/unit/adapters/test_host_allowlists.py
   ```
   This covers the generic allowlist helper; integration tests that touch the adapter provide extra safety.

## Troubleshooting

- **ValueError: disallows host** – Logs include the component name. Ensure the base URL matches one of the allowlisted hosts or extends `_allowed_hosts`.
- **Webhook loops after tunnel changes** – Confirm `cloudflared/config.yml` uses `httpHostHeader` + `originServerName` so Fly receives the same host the allowlist expects.
- **Local testing vs. production** – The helpers allow `localhost`/`*.test` domains only when `allow_dev_hosts=True`. Set it to `False` for anything that should never point local (e.g., upload-post publish in staging/prod).

Keep this document close to `docs/03-how-to/kb-ingestion.md` so infra runbooks remain together.
