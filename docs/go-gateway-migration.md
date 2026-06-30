# Go Gateway Migration

## Goal

Reduce Node.js gateway pressure by moving selected API paths to a smaller Go sidecar, while keeping Node as the single public API entry inside one Render Docker backend.

## Current Shape

- Node gateway remains the single public backend entry for local development and production.
- Go gateway is introduced as a sidecar process under `backend/go-gateway`.
- Local Go gateway runs on port `3001`.
- Vite keeps `/api` proxied to Node. In normal local development, Node receives `GO_GATEWAY_BASE_URL=http://127.0.0.1:3001` and proxies Go-owned routes to the Go sidecar.
- `VITE_IMAGE_API_BASE_URL` is still available for isolated image-service verification, but it is not the default `npm run dev` path.
- Render runs Node and Go in one Docker Web Service. Go is not a separate Render backend service in the current plan.

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

Default local path:

```bash
npm run dev
```

Explicit Go sidecar path:

```bash
npm run dev:go
```

Both commands start Node, Go, and Vite. The browser calls `/api`; Node keeps Chat/MCP/Admin locally and proxies image, credits, and selected config endpoints to Go.

Node-only debugging path:

```bash
npm run dev:node
```

This starts only Node and Vite. Because the legacy Node image-generation handler has been removed, `/api/image/generate` returns a 503 migration message in this mode.

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

1. Build Node Gateway and Go Gateway into the same Render Docker image.
2. Start Go first on `127.0.0.1:3001`, wait for `/health` or `/ready`, then start Node on the public `PORT`.
3. Set Node `GO_GATEWAY_BASE_URL=http://127.0.0.1:3001`.
4. Keep frontend `VITE_API_BASE_URL` pointing to Node.
5. Test Go image endpoints through Node proxy first; direct Go testing is only for internal smoke checks inside the container or local development.
6. Keep Chat/MCP/Admin on Node until dedicated parity work is complete.

## Success Metrics

- The combined Docker backend starts reliably with both Node and Go healthy.
- Go-owned Image/credits traffic no longer exercises the old Node generation pipeline.
- Image public gallery and config routes return within acceptable latency after idle.
- No regression in auth, credit deduction, public gallery visibility, or image storage URLs.

## Known Gaps

- Go app config and credits endpoints are part of the Go-owned route set when Node sidecar proxy is enabled.
- Go image storage proxy and COS behavior need parity review.
- Go no longer provides `/api/chat`; Chat stays on Node.
- Go admin APIs are not implemented.
