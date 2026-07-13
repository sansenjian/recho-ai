# Request Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Node and Go request one validated `X-Request-ID`, emit safe structured request logs, and return backward-compatible machine-readable gateway error codes.

**Architecture:** Node creates or validates the public request ID before CORS and proxy routing, stores it back on the request headers, exposes it on the response, and uses it in gateway-generated errors and request logs. Go sanitizes direct inbound IDs, reuses Node IDs, exposes the same ID in responses, and logs request completion as one JSON object. Existing `{ "error": "..." }` consumers remain compatible because new `code` and `requestId` fields are additive.

**Tech Stack:** Express 4, TypeScript 6, Vitest 4, Go 1.25, chi v5, standard-library JSON logging.

---

## Scope

This plan implements item 3 from `docs/optimization-plan-1-3-4-5-6.md`.

Included:

- validated request IDs at both gateway entries
- Node-to-Go request ID propagation
- response header exposure through CORS
- structured request-completion logs with safe fields
- stable gateway-level error codes
- client-disconnect cancellation coverage for the Node proxy

Deferred to the contract and orchestration plans:

- domain-specific error codes for every image and credit failure
- distributed tracing exporters
- persistent image job correlation fields
- dashboards and alerts

## File map

| File | Responsibility |
|---|---|
| `backend/gateway/src/middleware/request-observability.ts` | Validate/generate Node request IDs, expose response headers, emit completion logs |
| `backend/gateway/src/services/api-error.ts` | Build backward-compatible Node gateway error bodies |
| `backend/gateway/src/index.ts` | Mount request observability before timeout, CORS, and proxy middleware |
| `backend/gateway/src/routes/go-sidecar.ts` | Return coded proxy failures and preserve the correlated request ID |
| `tests/gateway-request-observability.test.ts` | Node request ID, CORS exposure, logging, and error-body tests |
| `tests/go-sidecar-proxy.test.ts` | Header propagation and client-disconnect cancellation tests |
| `backend/go-gateway/internal/middleware/request_observability.go` | Sanitize/generate Go request IDs and emit JSON completion logs |
| `backend/go-gateway/internal/middleware/request_observability_test.go` | Go request ID and logger tests |
| `backend/go-gateway/internal/pkg/response/response.go` | Add generic machine-readable error codes without removing `error` |
| `backend/go-gateway/internal/pkg/response/response_test.go` | Error envelope compatibility tests |
| `backend/go-gateway/cmd/server/main.go` | Replace chi text request logging with the project middleware |

### Task 1: Node request ID middleware

**Files:**
- Create: `backend/gateway/src/middleware/request-observability.ts`
- Create: `tests/gateway-request-observability.test.ts`

- [x] **Step 1: Write failing request ID tests**

Create an Express test app and assert that a valid caller ID is preserved, an invalid ID is replaced, and every response exposes the final ID:

```ts
import http from 'node:http'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { requestObservabilityMiddleware } from '../backend/gateway/src/middleware/request-observability'

describe('request observability middleware', () => {
  it('preserves a valid request id', async () => {
    const response = await request({ 'X-Request-ID': 'req_test-123' })
    expect(response.headers.get('x-request-id')).toBe('req_test-123')
    await expect(response.json()).resolves.toMatchObject({ requestId: 'req_test-123' })
  })

  it('replaces an invalid request id', async () => {
    const response = await request({ 'X-Request-ID': 'invalid request id' })
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })
})
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
npm test -- tests/gateway-request-observability.test.ts
```

Expected: FAIL because `request-observability.ts` does not exist.

- [x] **Step 3: Implement the minimal middleware**

Use this public API:

```ts
import { randomUUID } from 'node:crypto'
import type { Request, RequestHandler } from 'express'

export const REQUEST_ID_HEADER = 'X-Request-ID'
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function requestId(req: Request) {
  return req.get(REQUEST_ID_HEADER) || 'unknown'
}

export const requestObservabilityMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER)?.trim() || ''
  const id = REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID()
  req.headers['x-request-id'] = id
  res.setHeader(REQUEST_ID_HEADER, id)
  next()
}
```

- [x] **Step 4: Run the test and verify GREEN**

Run:

```bash
npm test -- tests/gateway-request-observability.test.ts
```

Expected: 2 tests pass.

- [x] **Step 5: Commit the middleware slice**

```bash
git add backend/gateway/src/middleware/request-observability.ts tests/gateway-request-observability.test.ts
git commit -m "feat(gateway): add correlated request ids"
```

### Task 2: Node structured request logs and coded errors

**Files:**
- Modify: `backend/gateway/src/middleware/request-observability.ts`
- Create: `backend/gateway/src/services/api-error.ts`
- Modify: `backend/gateway/src/index.ts`
- Modify: `tests/gateway-request-observability.test.ts`

- [x] **Step 1: Add failing logging and error-body tests**

Add tests that spy on `console.info`, finish one request, parse the logged JSON, and assert only safe request fields are emitted. Add an error helper test:

```ts
expect(JSON.parse(logLine)).toMatchObject({
  level: 'info',
  service: 'node-gateway',
  event: 'request.completed',
  requestId: expect.any(String),
  method: 'GET',
  path: '/test',
  statusCode: 200,
  durationMs: expect.any(Number),
})

expect(apiErrorBody(req, 'GO_SIDECAR_UNAVAILABLE', 'unavailable')).toEqual({
  error: 'unavailable',
  code: 'GO_SIDECAR_UNAVAILABLE',
  requestId: expect.any(String),
})
```

- [x] **Step 2: Run the test and verify RED**

```bash
npm test -- tests/gateway-request-observability.test.ts
```

Expected: FAIL because request completion logging and `api-error.ts` are missing.

- [x] **Step 3: Add completion logging**

Extend the middleware after assigning the ID:

```ts
const startedAt = performance.now()
res.once('finish', () => {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'node-gateway',
    event: 'request.completed',
    requestId: id,
    method: req.method,
    path: req.path,
    statusCode: res.statusCode,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
  }))
})
```

- [x] **Step 4: Add the backward-compatible error helper**

Create:

```ts
import type { Request } from 'express'
import { requestId } from '../middleware/request-observability.js'

export type GatewayErrorCode =
  | 'GATEWAY_TIMEOUT'
  | 'GO_SIDECAR_UNAVAILABLE'
  | 'GO_SIDECAR_TIMEOUT'
  | 'INVALID_REQUEST_BODY'
  | 'REQUEST_BODY_TOO_LARGE'
  | 'INTERNAL_ERROR'

export function apiErrorBody(req: Request, code: GatewayErrorCode, error: string) {
  return { error, code, requestId: requestId(req) }
}
```

- [x] **Step 5: Mount middleware and use coded gateway errors**

In `backend/gateway/src/index.ts`:

```ts
app.use(requestObservabilityMiddleware)

app.use(cors({
  origin: CORS_ORIGIN.length === 1 ? CORS_ORIGIN[0] : CORS_ORIGIN,
  exposedHeaders: [REQUEST_ID_HEADER],
}))
```

Use `apiErrorBody` for timeout, request-body parsing, and the global error handler. Keep the existing human-readable `error` string unchanged.

- [x] **Step 6: Verify Node tests and typecheck**

```bash
npm test -- tests/gateway-request-observability.test.ts
cd backend/gateway && npm run typecheck
```

Expected: all targeted tests pass and TypeScript reports no errors.

- [x] **Step 7: Commit Node observability**

```bash
git add backend/gateway/src/index.ts backend/gateway/src/middleware/request-observability.ts backend/gateway/src/services/api-error.ts tests/gateway-request-observability.test.ts
git commit -m "feat(gateway): add structured request observability"
```

### Task 3: Sidecar propagation and cancellation coverage

**Files:**
- Modify: `backend/gateway/src/routes/go-sidecar.ts`
- Modify: `tests/go-sidecar-proxy.test.ts`

- [x] **Step 1: Add failing propagation and error tests**

Add an upstream fixture that records `x-request-id`, returns it in its response, and assert the Node response uses the same ID. Add a proxy connection failure test that expects:

```ts
{
  error: 'Go image service is temporarily unavailable.',
  code: 'GO_SIDECAR_UNAVAILABLE',
  requestId: 'req_proxy_test',
}
```

- [x] **Step 2: Add a failing client-disconnect test**

Use `http.request()` against the Node proxy, write a partial POST body, destroy the client request before completion, and assert the upstream request emits `aborted` or `close` before its response is written.

- [x] **Step 3: Run proxy tests and verify RED**

```bash
npm test -- tests/go-sidecar-proxy.test.ts
```

Expected: request ID tests fail until the Node middleware is mounted in the fixture; coded proxy error fails until `go-sidecar.ts` uses `apiErrorBody`; the disconnect assertion exposes any cancellation regression.

- [x] **Step 4: Implement coded proxy failures**

In the proxy catch block:

```ts
const timedOut = err?.name === 'AbortError'
const status = timedOut ? 504 : 502
const code = timedOut ? 'GO_SIDECAR_TIMEOUT' : 'GO_SIDECAR_UNAVAILABLE'
if (!res.headersSent) {
  res.status(status).json(apiErrorBody(req, code, 'Go image service is temporarily unavailable.'))
}
```

Mount `requestObservabilityMiddleware` in each proxy test app before `/api`.

- [x] **Step 5: Verify proxy tests**

```bash
npm test -- tests/go-sidecar-proxy.test.ts tests/go-sidecar-image-attempt.test.ts
```

Expected: all tests pass, including the normal POST and aborted-client cases.

- [x] **Step 6: Commit proxy observability**

```bash
git add backend/gateway/src/routes/go-sidecar.ts tests/go-sidecar-proxy.test.ts
git commit -m "test(gateway): cover sidecar correlation and cancellation"
```

### Task 4: Go request ID middleware

**Files:**
- Create: `backend/go-gateway/internal/middleware/request_observability.go`
- Create: `backend/go-gateway/internal/middleware/request_observability_test.go`
- Modify: `backend/go-gateway/cmd/server/main.go`

- [x] **Step 1: Write failing Go request ID tests**

Cover a valid ID, an invalid ID, and a missing ID. Every case must assert both the response header and the request header visible to the next handler:

```go
func TestRequestIDPreservesValidIncomingID(t *testing.T) {
    handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        response.JSON(w, http.StatusOK, map[string]string{"requestId": r.Header.Get("X-Request-ID")})
    }))
    req := httptest.NewRequest(http.MethodGet, "/api/config/app", nil)
    req.Header.Set("X-Request-ID", "req_go-123")
    rec := httptest.NewRecorder()
    handler.ServeHTTP(rec, req)
    if got := rec.Header().Get("X-Request-ID"); got != "req_go-123" {
        t.Fatalf("expected correlated id, got %q", got)
    }
}
```

- [x] **Step 2: Run Go tests and verify RED**

```bash
cd backend/go-gateway && go test ./internal/middleware -run RequestID -count=1
```

Expected: FAIL because `RequestID` does not exist.

- [x] **Step 3: Implement the Go middleware**

Compose chi's request ID middleware so existing `chiMiddleware.GetReqID()` callers continue to work:

```go
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

func RequestID(next http.Handler) http.Handler {
    expose := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := chiMiddleware.GetReqID(r.Context())
        r.Header.Set("X-Request-ID", id)
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r)
    })
    assign := chiMiddleware.RequestID(expose)
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        candidate := strings.TrimSpace(r.Header.Get("X-Request-ID"))
        if !requestIDPattern.MatchString(candidate) {
            candidate = newRequestID()
        }
        r.Header.Set("X-Request-ID", candidate)
        assign.ServeHTTP(w, r)
    })
}
```

- [x] **Step 4: Mount the middleware**

Replace `r.Use(chiMiddleware.RequestID)` in `main.go` with `r.Use(middleware.RequestID)`. Keep Recoverer after request ID assignment so recovered failures still expose the ID.

- [x] **Step 5: Verify Go request ID tests**

```bash
cd backend/go-gateway && go test ./internal/middleware -run RequestID -count=1
```

Expected: all RequestID tests pass.

- [x] **Step 6: Commit Go request correlation**

```bash
git add backend/go-gateway/cmd/server/main.go backend/go-gateway/internal/middleware/request_observability.go backend/go-gateway/internal/middleware/request_observability_test.go
git commit -m "feat(go-gateway): correlate request ids"
```

### Task 5: Go structured logs and error codes

**Files:**
- Modify: `backend/go-gateway/internal/middleware/request_observability.go`
- Modify: `backend/go-gateway/internal/middleware/request_observability_test.go`
- Modify: `backend/go-gateway/internal/pkg/response/response.go`
- Create: `backend/go-gateway/internal/pkg/response/response_test.go`
- Modify: `backend/go-gateway/cmd/server/main.go`

- [x] **Step 1: Write failing JSON log tests**

Pass a `bytes.Buffer` to `RequestLogger`, invoke a request, decode one JSON line, and assert:

```go
map[string]any{
    "level":       "info",
    "service":     "go-gateway",
    "event":       "request.completed",
    "request_id":  "req_go_log",
    "method":      "GET",
    "path":        "/api/config/app",
    "status_code": float64(204),
}
```

Assert that query strings, Authorization headers, and request bodies are absent.

- [x] **Step 2: Write failing error envelope tests**

Call `response.Error` for `400`, `401`, `403`, `409`, `429`, `500`, `502`, `503`, and `504`. Decode the body and assert the existing `error` field remains while `code` contains `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`, `BAD_GATEWAY`, `SERVICE_UNAVAILABLE`, or `GATEWAY_TIMEOUT`.

- [x] **Step 3: Run Go tests and verify RED**

```bash
cd backend/go-gateway && go test ./internal/middleware ./internal/pkg/response -count=1
```

Expected: FAIL because `RequestLogger` and the `code` field are missing.

- [x] **Step 4: Implement the JSON request logger**

Use chi's `NewWrapResponseWriter` so streaming, flushing, and optional HTTP interfaces remain intact:

```go
func RequestLogger(out io.Writer) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            startedAt := time.Now()
            wrapped := chiMiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
            next.ServeHTTP(wrapped, r)
            _ = json.NewEncoder(out).Encode(map[string]any{
                "timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
                "level":       "info",
                "service":     "go-gateway",
                "event":       "request.completed",
                "request_id":  chiMiddleware.GetReqID(r.Context()),
                "method":      r.Method,
                "path":        r.URL.Path,
                "status_code": wrapped.Status(),
                "duration_ms": time.Since(startedAt).Milliseconds(),
            })
        })
    }
}
```

- [x] **Step 5: Add generic Go error codes**

Change the error body to:

```go
type ErrorResponse struct {
    Error string `json:"error"`
    Code  string `json:"code"`
}
```

Add a private `errorCodeForStatus(status int) string` switch and keep every existing handler call to `response.Error(w, status, message)` source-compatible.

- [x] **Step 6: Mount the JSON logger**

In `main.go`, remove `r.Use(chiMiddleware.Logger)` and add:

```go
r.Use(middleware.RequestID)
r.Use(middleware.RequestLogger(os.Stdout))
r.Use(chiMiddleware.Recoverer)
```

- [x] **Step 7: Verify Go tests**

```bash
cd backend/go-gateway && go test ./internal/middleware ./internal/pkg/response ./internal/handler ./internal/orchestrator -count=1
```

Expected: all targeted Go packages pass.

- [x] **Step 8: Commit Go observability**

```bash
git add backend/go-gateway/cmd/server/main.go backend/go-gateway/internal/middleware/request_observability.go backend/go-gateway/internal/middleware/request_observability_test.go backend/go-gateway/internal/pkg/response/response.go backend/go-gateway/internal/pkg/response/response_test.go
git commit -m "feat(go-gateway): add structured request logs"
```

### Task 6: Verification and documentation update

**Files:**
- Modify: `docs/optimization-plan-1-3-4-5-6.md`
- Modify: `docs/superpowers/plans/2026-07-11-request-observability.md`

- [x] **Step 1: Run focused Node verification**

```bash
npm test -- tests/gateway-request-observability.test.ts tests/go-sidecar-proxy.test.ts tests/go-sidecar-image-attempt.test.ts
cd backend/gateway && npm run typecheck && npm run build
```

Expected: all targeted tests pass and the Node gateway builds.

- [x] **Step 2: Run focused Go verification**

```bash
cd backend/go-gateway && go test ./... -count=1
cd backend/go-gateway && go build ./cmd/server/...
```

Expected: all Go tests and the server build pass.

- [x] **Step 3: Run root verification**

```bash
npm run build
npm test
```

Expected baseline: the production build passes. The suite currently has one unrelated known failure in `tests/admin-images.test.ts` because the unchanged fixture supplies `size` while the implementation reads `original_bytes`; no new failures may be introduced.

- [x] **Step 4: Update the master optimization plan**

Mark item 3 as implemented and record exact remaining work: domain error taxonomy, persistent generation correlation, metrics export, and alerting.

- [x] **Step 5: Self-review this plan and mark completed checkboxes**

Run:

```bash
rg -n "T[B]D|T[O]DO|implement l[a]ter|add appropri[a]te|handle edge c[a]ses" docs/superpowers/plans/2026-07-11-request-observability.md
git diff --check
```

Expected: no plan placeholders and no whitespace errors.

- [x] **Step 6: Commit verification documentation**

```bash
git add docs/optimization-plan-1-3-4-5-6.md docs/superpowers/plans/2026-07-11-request-observability.md
git commit -m "docs: track request observability rollout"
```

## Implementation record

Completed on 2026-07-12 through these focused commits:

- `bfe8ec1` - Node request ID middleware.
- `e400f3d` and `c2231ac` - Node structured logs, coded errors, and body-parser classification fixes.
- `c4e2366` - Sidecar correlation, coded proxy errors, and cancellation coverage.
- `8885bfa` - Go request ID middleware.
- `58cb958` - Go structured logs and generic error codes, plus Node snake_case log alignment.
- `4a66646` - stable Sidecar integration tests without per-test module reloads.

Actual verification:

- Focused Node observability tests: 19 passed.
- Node Gateway typecheck and build: passed.
- Go `go test ./... -count=1`: all packages passed.
- Go server build: passed.
- Root production build: passed.
- Root Vitest: 188 passed, with only the pre-existing `tests/admin-images.test.ts` fixture mismatch failing (`size` versus `original_bytes`).

Implementation details that intentionally extend the original snippets:

- Node and Go request completion logs both use snake_case fields.
- Go generates UUID v4 IDs itself because chi's default generated format contains `/`, which does not satisfy the shared public request ID pattern.
- Go maps additional statuses used by the repository, including `404`, `413`, and `415`, and reusable error bodies keep idempotent credit redemption replays consistent.
- Sidecar environment values are read per request so integration tests can configure the proxy without repeated cold module imports.
