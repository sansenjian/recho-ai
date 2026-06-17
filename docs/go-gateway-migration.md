# Go Gateway Migration

## Goal

Reduce Render memory pressure and cold-start latency by moving selected API paths from the Node.js gateway to a smaller Go gateway, while keeping the Node gateway as the default fallback during migration.

## Current Shape

- Node gateway remains the default backend for local development and production.
- Go gateway is introduced as a parallel service under `backend/go-gateway`.
- Local Go gateway runs on port `3001`.
- Vite can point `/api` to Go with `VITE_API_PROXY_TARGET=http://127.0.0.1:3001`.
- Render can deploy a separate `recho-go-gateway` service without replacing `recho-gateway`.

## Why Parallel First

The existing `go-gateway` branch diverged from current `master` and also rewrites frontend Image/Imagio/Admin code. This migration intentionally imports only the Go backend and required database migrations, avoiding broad frontend regressions.

## First Migration Targets

These endpoints are good candidates because they affect Image page startup or credit-consuming flows and do not require MCP:

- `GET /health`
- `GET /api/config/app`
- `GET /api/config/supabase`
- `GET /api/image/history?scope=public`
- `GET /api/image/history?scope=mine`
- `POST /api/image/generate`
- `GET /api/credits`
- `POST /api/credits/redeem`

Node should remain responsible for now:

- Chat streaming with MCP/tool calls
- Skills loading
- Admin panels
- Tool endpoints
- Any route that has not been response-compatible tested against Node

## Local Commands

Default Node path:

```bash
npm run dev
```

Go candidate path:

```bash
npm run dev:go
```

Build checks:

```bash
npm run build
npm run build:go-backend
```

## Smoke Test

With Go running on `3001`:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/api/config/app
curl "http://127.0.0.1:3001/api/image/history?scope=public&limit=2"
```

Expected in limited local mode without Supabase env:

- `/health` returns `status: ok`.
- `/api/config/app` returns frontend-safe defaults.
- Public image history returns an empty list with `persistence: false`, rather than crashing.

## Deploy Strategy

1. Deploy `recho-go-gateway` alongside the existing Node `recho-gateway`.
2. Keep frontend `VITE_API_BASE_URL` pointing to Node.
3. Test Go endpoints directly in production.
4. Move only Image-related frontend API base to Go after response compatibility is verified.
5. Keep Chat/MCP/Admin on Node until dedicated parity work is complete.

## Success Metrics

- Go service cold start is consistently lower than Node gateway cold start.
- Go service memory stays materially below Node gateway under Image/credits traffic.
- Image public gallery and config routes return within acceptable latency after idle.
- No regression in auth, credit deduction, public gallery visibility, or image storage URLs.

## Known Gaps

- Go app config currently uses env defaults and does not read `app_settings`.
- Go image history response needs parity review against Node before production cutover.
- Go image storage proxy and COS behavior need parity review.
- Go chat route is basic upstream streaming and does not implement the current Node MCP/tool loop.
- Go admin APIs are not implemented.
