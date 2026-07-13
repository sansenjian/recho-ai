# Go-Owned API Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one shared contract fail tests when Node Gateway and Go Gateway disagree about a proxied route, header, request kind, status, or generic error envelope.

**Architecture:** A focused JSON contract is read directly by TypeScript and Go tests. Unit-level contract tests validate every route through controlled servers and chi route walking; one live test starts the real Go binary behind a real Node HTTP server for credential-free scenarios.

**Tech Stack:** JSON, TypeScript 6, Vitest 4, Express 4, Go 1.25, chi v5, Node child processes, GitHub Actions.

---

## Scope

Included:

- Node-proxied `/api/config/*`, `/api/credits*`, and `/api/image/*` routes
- shared forwarded headers and request kinds
- success status and generic error envelope expectations
- real Node-to-Go smoke scenarios that need no external service
- focused CI workflow

Excluded:

- Go health/readiness routes
- conditional image diagnostics
- domain-specific image response schemas
- Supabase, object storage, and Provider-backed success flows

## File map

| File | Responsibility |
|---|---|
| `contracts/go-owned-api.json` | Single contract source for routes, headers, statuses, and live scenarios |
| `tests/helpers/go-owned-contract.ts` | Parse, validate, and materialize TypeScript contract samples |
| `tests/go-owned-api-contract.test.ts` | Contract self-validation tests |
| `tests/go-sidecar-contract.test.ts` | Node proxy verification against every contract route |
| `backend/go-gateway/internal/handler/contract_test.go` | chi route and real handler scenario verification using the same JSON |
| `tests/go-sidecar-live-contract.test.ts` | Real Node HTTP server to real Go process smoke test |
| `package.json` | Focused `test:contracts` command |
| `.github/workflows/contracts.yml` | Node and Go contract CI |
| `docs/optimization-plan-1-3-4-5-6.md` | Item 4 implementation status |

### Task 1: Shared JSON contract and TypeScript validation

**Files:**
- Create: `contracts/go-owned-api.json`
- Create: `tests/helpers/go-owned-contract.ts`
- Create: `tests/go-owned-api-contract.test.ts`

- [x] **Step 1: Write failing loader tests**

Create tests that call `loadGoOwnedContract()` and assert:

```ts
expect(contract.version).toBe(1)
expect(contract.requestIdHeader).toBe('X-Request-ID')
expect(new Set(contract.routes.map(route => route.id)).size).toBe(contract.routes.length)
expect(contract.routes).toContainEqual(expect.objectContaining({
  method: 'POST',
  path: '/api/image/generate',
  requestKind: 'json',
}))
expect(materializeContractPath('/api/image/history/{id}')).toBe('/api/image/history/contract-id')
expect(materializeContractPath('/api/image/storage/*')).toBe('/api/image/storage/contract/object.png')
```

The loader must reject duplicate IDs, duplicate method/path pairs, paths outside `/api`, and request kinds other than `none`, `json`, or `binary`.

- [x] **Step 2: Run the loader test and verify RED**

```bash
npm test -- tests/go-owned-api-contract.test.ts
```

Expected: FAIL because the contract and loader do not exist.

- [x] **Step 3: Create the focused contract**

Use this top-level shape:

```json
{
  "version": 1,
  "requestIdHeader": "X-Request-ID",
  "forwardHeaders": [
    "Authorization",
    "X-Request-ID",
    "Idempotency-Key",
    "Content-Type",
    "X-Reference-ID",
    "X-Reference-Title",
    "X-Reference-Filename"
  ],
  "errorStatuses": [400, 401, 402, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503, 504],
  "routes": [],
  "liveScenarios": []
}
```

Add exactly these method/path pairs:

```text
GET    /api/config/app
GET    /api/config/supabase
GET    /api/credits
POST   /api/credits/redeem
POST   /api/image/references
GET    /api/image/storage/*
POST   /api/image/generate
GET    /api/image/history
GET    /api/image/history/{id}
DELETE /api/image/history/{id}
DELETE /api/image/history
```

Every route uses success status `200`. Set `requestKind` to `json` for credit redemption and image generation, `binary` for reference upload, and `none` for the remaining routes. Record `Idempotency-Key` on redemption and generation and the three `X-Reference-*` headers on reference upload.

Add these live scenarios:

```text
config-app: GET /api/config/app -> 200, keys imageEventsEnabled/canvasContextEnabled/guestGenerationEnabled/imageCreditCostPerImage/availableImageModels/defaultImageModel
config-supabase: GET /api/config/supabase -> 200, keys configured/url/publishableKey
credits-unauthorized: GET /api/credits -> 401, keys error/code, code UNAUTHORIZED
```

- [x] **Step 4: Implement the TypeScript loader**

Expose:

```ts
export type ContractRequestKind = 'none' | 'json' | 'binary'
export async function loadGoOwnedContract(): Promise<GoOwnedContract>
export function validateGoOwnedContract(value: unknown): GoOwnedContract
export function materializeContractPath(path: string): string
```

Use `readFile(resolve(process.cwd(), 'contracts/go-owned-api.json'), 'utf8')` and `JSON.parse`. Vitest transforms `import.meta.url` to a non-file scheme, so the repository-root path is intentional. Validation errors must name the invalid field or duplicate route.

- [x] **Step 5: Verify GREEN and commit**

```bash
npm test -- tests/go-owned-api-contract.test.ts
git add contracts/go-owned-api.json tests/helpers/go-owned-contract.ts tests/go-owned-api-contract.test.ts
git commit -m "test(contract): define go-owned API surface"
```

Expected: contract validation tests pass.

### Task 2: Node proxy consumes every contract route

**Files:**
- Create: `tests/go-sidecar-contract.test.ts`

- [x] **Step 1: Write the failing proxy iteration test**

Start one controlled upstream HTTP server and one Express server using:

```ts
app.use(requestObservabilityMiddleware)
app.use('/api', goSidecarRouter)
```

For every contract route, send a request to `materializeContractPath(route.path) + '?contract=query'`. Send `Authorization`, a route-specific `X-Request-ID`, and all headers listed on that route. Send `{ "contract": true }` for JSON routes and `contract-binary-body` for binary routes.

Assert the upstream observes the exact method, path, query, request ID, Authorization header, route-specific headers, and body.

- [x] **Step 2: Run the proxy contract test and verify RED**

```bash
npm test -- tests/go-sidecar-contract.test.ts
```

Expected: FAIL until the shared fixture is wired into a real proxy server. A missing proxy regex must surface as a 404.

- [x] **Step 3: Complete the controlled proxy fixture**

Return JSON with the route's first success status and echo the request ID. Preserve the Node response request ID even if the upstream sends a different value. Restore `GO_GATEWAY_BASE_URL` and close every HTTP server after the test. Do not use `vi.resetModules`.

- [x] **Step 4: Verify Node proxy contracts and commit**

```bash
npm test -- tests/go-owned-api-contract.test.ts tests/go-sidecar-contract.test.ts tests/go-sidecar-proxy.test.ts
cd backend/gateway && npm run typecheck
git add tests/go-sidecar-contract.test.ts
git commit -m "test(gateway): verify go-owned proxy contract"
```

### Task 3: Go handlers consume the shared route contract

**Files:**
- Create: `backend/go-gateway/internal/handler/contract_test.go`

- [x] **Step 1: Write the failing Go route tests**

Define test-only structs matching the JSON and resolve the contract path with `runtime.Caller`. Register:

```go
r := chi.NewRouter()
r.Use(middleware.RequestID)
r.Route("/api", func(r chi.Router) {
    NewConfigHandler(nil, nil).RegisterRoutes(r)
    NewCreditsHandler(nil, nil, nil).RegisterRoutes(r)
    r.Route("/image", func(r chi.Router) {
        NewImageHandler(nil, nil, nil).RegisterRoutes(r)
    })
})
```

Use `chi.Walk` to collect method/path pairs and assert every contracted route exists. Ignore conditional diagnostics.

- [x] **Step 2: Add failing live-scenario handler tests**

For every shared live scenario, call the chi router with a request ID. Assert status, response request ID, all required JSON keys, and `expectedCode` when present.

- [x] **Step 3: Run Go contract tests and verify RED**

```bash
cd backend/go-gateway
go test ./internal/handler -run Contract -count=1
```

Expected: FAIL until the loader, route walking, and scenario assertions exist.

- [x] **Step 4: Implement helpers, verify GREEN, and commit**

Keep all helpers in `contract_test.go`; no production contract package is needed.

```bash
cd backend/go-gateway
go test ./internal/handler -run Contract -count=1
git add backend/go-gateway/internal/handler/contract_test.go
git commit -m "test(go-gateway): verify shared API contract"
```

### Task 4: Real Node-to-Go smoke test and CI

**Files:**
- Create: `tests/go-sidecar-live-contract.test.ts`
- Modify: `package.json`
- Create: `.github/workflows/contracts.yml`

- [x] **Step 1: Write the failing live integration harness**

Build the Go server into an OS temp directory:

```ts
await execFileAsync('go', ['build', '-o', binaryPath, './cmd/server/...'], {
  cwd: goGatewayDirectory,
})
```

Start the binary with the temp directory as `cwd`, a reserved port, no database URLs, and `DB_CONNECT_MAX_RETRIES=1`. Wait for `/health` with bounded polling, then start a real Express server using the production Sidecar router and run the shared live scenarios through Node.

- [x] **Step 2: Run the live test and verify RED**

```bash
npm test -- tests/go-sidecar-live-contract.test.ts
```

Expected: FAIL until process startup, polling, proxy startup, assertions, and cleanup are implemented.

- [x] **Step 3: Complete deterministic cleanup**

Capture Go stdout/stderr for diagnostics. In `afterAll`, close Node, terminate Go, await exit with a timeout, restore environment variables, and remove the temp directory. Give the Go build hook 120 seconds and each scenario 20 seconds. Fail early if the Go child exits before health succeeds.

- [x] **Step 4: Add focused npm and CI commands**

Add to `package.json`:

```json
"test:contracts": "vitest run tests/go-owned-api-contract.test.ts tests/go-sidecar-contract.test.ts tests/go-sidecar-live-contract.test.ts"
```

Create `.github/workflows/contracts.yml` for relevant pull requests and pushes. Use Node 22 and the Go version from `go.mod`, then run:

```bash
npm ci
npm run test:contracts
npm --prefix backend/gateway run typecheck
cd backend/go-gateway && go test ./internal/handler -run Contract -count=1
cd backend/go-gateway && go build ./cmd/server/...
```

- [x] **Step 5: Verify and commit live contracts**

```bash
npm run test:contracts
cd backend/go-gateway && go test ./internal/handler -run Contract -count=1
git add tests/go-sidecar-live-contract.test.ts package.json .github/workflows/contracts.yml
git commit -m "test(contract): add live node-go verification"
```

### Task 5: Full verification and documentation

**Files:**
- Modify: `docs/optimization-plan-1-3-4-5-6.md`
- Modify: `docs/superpowers/plans/2026-07-12-go-owned-api-contracts.md`

- [x] **Step 1: Run focused verification**

```bash
npm run test:contracts
npm test -- tests/go-sidecar-proxy.test.ts tests/go-sidecar-image-attempt.test.ts
cd backend/gateway && npm run typecheck && npm run build
cd backend/go-gateway && go test ./internal/handler -run Contract -count=1
```

- [x] **Step 2: Run Go and root verification**

```bash
cd backend/go-gateway && go test ./... -count=1
cd backend/go-gateway && go build ./cmd/server/...
npm run build
npm test
```

Expected: all Go tests and builds pass; root build passes; root Vitest has no new failure beyond the known `tests/admin-images.test.ts` fixture mismatch.

- [x] **Step 3: Update item 4 status**

Mark the shared contract, Node proxy coverage, Go handler coverage, live Node-to-Go smoke test, and CI workflow as implemented. Record that Provider/Supabase/storage-backed success scenarios remain deferred until persistent job fixtures exist.

- [x] **Step 4: Self-review and commit documentation**

```bash
rg -n "T[B]D|T[O]DO|implement l[a]ter|add appropri[a]te|handle edge c[a]ses" docs/superpowers/plans/2026-07-12-go-owned-api-contracts.md
git diff --check
git add docs/optimization-plan-1-3-4-5-6.md docs/superpowers/plans/2026-07-12-go-owned-api-contracts.md
git commit -m "docs: track go-owned contract rollout"
```

## Implementation record

Completed on 2026-07-12:

- `21d131c` - shared JSON contract, TypeScript loader, and validation tests.
- `5385038` - Node Sidecar verification for every contracted method/path/header/body combination.
- `61aed4c` - Go chi route walking and real Handler scenario verification.
- `ff1f4d4` - real Node-to-Go process smoke test, focused npm script, and GitHub Actions workflow.

Actual verification:

- `npm run test:contracts`: 3 files and 6 tests passed.
- Sidecar regression tests: 11 tests passed.
- Node Gateway typecheck and build: passed.
- Go `go test ./... -count=1`: all packages passed.
- Go server and root production builds: passed.
- Root Vitest: 194 passed; only the pre-existing `tests/admin-images.test.ts` fixture mismatch failed.

Deferred contract depth:

- Provider, Supabase, and object-storage-backed success scenarios.
- Complete nested schemas for generated images, history records, and credit responses.
- Long-stream and multipart boundary cases already covered by dedicated tests but not duplicated in the shared JSON.
