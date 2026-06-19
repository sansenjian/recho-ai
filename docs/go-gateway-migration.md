# Go Gateway Migration

## Goal

Reduce Render memory pressure and cold-start latency by moving selected API paths from the Node.js gateway to a smaller Go gateway, while keeping the Node gateway as the default fallback during migration.

## Current Shape

- Node gateway remains the default backend for local development and production.
- Go gateway is introduced as a parallel service under `backend/go-gateway`.
- Local Go gateway runs on port `3001`.
- Vite keeps `/api` proxied to Node and can point only image calls to Go with `VITE_IMAGE_API_BASE_URL=http://127.0.0.1:3001`.
- Render can deploy a separate `recho-go-gateway` service without replacing `recho-gateway`.

## Why Parallel First

The existing `go-gateway` branch diverged from current `master` and also rewrites frontend Image/Imagio/Admin code. This migration intentionally imports only the Go backend and required database migrations, avoiding broad frontend regressions.

## First Migration Targets

These endpoints are good candidates because they affect Image page startup or credit-consuming flows and do not require MCP:

- `GET /api/image/history?scope=public`
- `GET /api/image/history?scope=mine`
- `GET /api/image/history/:id`
- `POST /api/image/references`
- `POST /api/image/generate`
- `DELETE /api/image/history/:id`
- `DELETE /api/image/history`

Node should remain responsible for now:

- Chat streaming with MCP/tool calls
- Skills loading
- Admin panels
- Credits and app config, unless they are explicitly moved after parity testing
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

This starts both gateways. `/api` still goes to Node through the Vite proxy; only image calls use the Go service through `VITE_IMAGE_API_BASE_URL`.

Build checks:

```bash
npm run build
npm run build:go-backend
```

## Smoke Test

With Go running on `3001`:

```bash
curl http://127.0.0.1:3001/health
curl "http://127.0.0.1:3001/api/image/history?scope=public&limit=2"
```

Expected in limited local mode without Supabase env:

- `/health` returns `status: ok`.
- Public image history returns an empty list with `persistence: false`, rather than crashing.

## Deploy Strategy

1. Deploy `recho-go-gateway` alongside the existing Node `recho-gateway`.
2. Keep frontend `VITE_API_BASE_URL` pointing to Node.
3. Set frontend `VITE_IMAGE_API_BASE_URL` to the Go service when image endpoints are ready.
4. Test Go image endpoints directly in production.
5. Keep Chat/MCP/Admin on Node until dedicated parity work is complete.

## Success Metrics

- Go service cold start is consistently lower than Node gateway cold start.
- Go service memory stays materially below Node gateway under Image/credits traffic.
- Image public gallery and config routes return within acceptable latency after idle.
- No regression in auth, credit deduction, public gallery visibility, or image storage URLs.

## Known Gaps

- Go app config and credits endpoints exist for experiments, but frontend traffic should remain on Node for now.
- Go image storage proxy and COS behavior need parity review.
- Go chat route is basic upstream streaming and does not implement the current Node MCP/tool loop.
- Go admin APIs are not implemented.
