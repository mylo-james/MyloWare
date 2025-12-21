# MyloWare

MyloWare is a multi-agent video pipeline: brief → ideation → clip generation (Sora) → render (Remotion) → publish (Upload-Post/TikTok), with two human-in-the-loop approvals and fail-closed safety shields.

## Quickstart

Prereqs: Python **3.13** (see `.python-version`).

```bash
make dev-install
make demo-run
make serve
```

Run an end-to-end fake workflow (no paid APIs):

```bash
make demo-smoke
```

Quality gates:

```bash
make ci
make preflight
```

## Public Demo UI (Firebase Hosting)

The demo is a static site under `web/demo/` that talks to the public demo endpoints:

- `POST /v1/public/demo/start`
- `GET /v1/public/demo/runs/{public_token}`

Enable with:

- `PUBLIC_DEMO_ENABLED=true`
- `PUBLIC_DEMO_CORS_ORIGINS=<your firebase domain>`

Details: `docs/how-to/public-demo.md`.

## Deployments

- Backend (Fly.io): `fly deploy -a myloware-api`
- Frontend (Firebase Hosting): `firebase deploy --only hosting`

## Docs

- `docs/QUICKSTART.md`
- `docs/index.md`

## License

MIT (see `LICENSE`).
