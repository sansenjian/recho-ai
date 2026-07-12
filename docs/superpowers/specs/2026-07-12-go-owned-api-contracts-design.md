# Go-Owned API Contract Design

> Status: approved through `docs/optimization-plan-1-3-4-5-6.md` and implemented as item 4 of that plan.

## Goal

Create one repository-owned contract for every Go API route that the Node Gateway publicly proxies, then make Go handler tests, Node proxy tests, and a minimal live Node-to-Go integration test consume that contract.

## Scope

Included routes:

- `/api/config/app`
- `/api/config/supabase`
- `/api/credits`
- `/api/credits/redeem`
- `/api/image/references`
- `/api/image/storage/*`
- `/api/image/generate`
- `/api/image/history`
- `/api/image/history/{id}`

Excluded routes:

- Go-only `/`, `/health`, `/ready`, and `/live`
- conditionally enabled `/api/image/diagnostics`
- Node-owned Chat, MCP, Skill, Admin, and image-event APIs

## Approaches Considered

### 1. Full OpenAPI document and code generation

This gives strong schema tooling, but it would require documenting every nested image response immediately, selecting generators for TypeScript and Go, and adding generated artifacts before the current route boundary is stable. That is larger than the first contract milestone.

### 2. Focused JSON contract consumed directly by tests

This is the selected approach. A small JSON document records route/method pairs, forwarded headers, request kinds, success statuses, and live smoke scenarios. TypeScript and Go tests parse the same file with their standard JSON libraries. No runtime dependency or generated code is added.

### 3. Separate Node and Go fixtures

This is the smallest local change, but it does not solve the actual problem: one side can change while the other fixture remains stale. It is rejected because duplicate fixtures cannot act as a shared compatibility boundary.

## Architecture

```text
contracts/go-owned-api.json
        |             |
        |             +--> Go route and handler contract tests
        |
        +--> Node proxy contract tests
        |
        +--> Live Node HTTP server -> real Go process smoke test
```

The contract is a test input, not production routing configuration. Runtime routes remain owned by chi and the existing Express Sidecar middleware. This avoids making server startup depend on locating a repository JSON file while still making incompatible route and header changes fail tests.

## Contract Shape

The JSON document contains:

- `version`: contract format version
- `requestIdHeader`: canonical public correlation header
- `forwardHeaders`: headers Node must preserve when present
- `errorStatuses`: public status codes whose JSON body must retain `error` and expose `code`
- `routes`: route ID, HTTP method, path template, request kind, route-specific headers, and success statuses
- `liveScenarios`: requests that can run without Supabase or an image Provider, with expected status, response header, and required JSON keys

Path templates use chi-compatible `{id}` and `*` syntax. TypeScript test helpers convert them into concrete sample paths; Go route walking compares them directly with chi patterns.

## Components

### Shared contract

`contracts/go-owned-api.json` is the only route fixture. It contains no secrets, hostnames, or environment-specific values.

### TypeScript loader

`tests/helpers/go-owned-contract.ts` parses and validates the contract for Node tests. It rejects duplicate route IDs, duplicate method/path pairs, unknown request kinds, and paths outside `/api`.

### Node proxy contract test

`tests/go-sidecar-contract.test.ts` starts a real Express HTTP server with the production Sidecar router and a controlled upstream HTTP server. It iterates every contract route and verifies method, concrete path, query string, request body kind, `Authorization`, `X-Request-ID`, and route-specific headers.

### Go handler contract test

`backend/go-gateway/internal/handler/contract_test.go` reads the same JSON, registers the production config, credit, and image handlers on chi, walks the router, and verifies every contracted method/path pair exists. It also executes the shared no-database scenarios against real handlers and validates status, request ID response header, and required JSON keys.

### Live integration test

`tests/go-sidecar-live-contract.test.ts` builds the Go server into an OS temp directory, starts it from that directory so repository `.env` files are not loaded, and waits for `/health`. It then starts a real Node HTTP server with the production Sidecar router and runs the shared live scenarios through Node.

The live test sets neither `DATABASE_URL` nor `POSTGRES_URL`, so the Go server starts in its existing database-unavailable mode without contacting external services. Process output is captured for failure diagnostics, and both servers and temp files are always cleaned up.

## Error and Cancellation Behavior

- Go handler errors retain the existing `error` string and include a stable `code`.
- Node preserves Go response statuses and JSON bodies.
- Node-generated Sidecar connection failures remain covered separately as `502` or `504`.
- `Authorization`, `X-Request-ID`, and `Idempotency-Key` must reach Go unchanged.
- Client-disconnect cancellation remains covered by the dedicated Sidecar proxy test; the shared contract records that cancellation is part of the proxy boundary without duplicating the low-level race-sensitive test.

## CI

Add a focused `test:contracts` npm script and a GitHub Actions workflow that installs Node and Go, runs the TypeScript contract tests, runs the Go handler contract test, and builds both gateways. The existing Supabase migration workflow remains unchanged.

## Success Criteria

- Node and Go tests read the same contract file.
- Every Node-proxied Go route is represented exactly once.
- Header, method, path, query, body-kind, response status, and generic error envelope regressions fail tests.
- A real Node server can reach a real Go process for public config and unauthenticated credit error scenarios.
- Tests require no Supabase, object storage, or image Provider credentials.
- Health and conditional diagnostics routes remain outside the first contract scope.
