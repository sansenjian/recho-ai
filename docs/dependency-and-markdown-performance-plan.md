# Dependency And Markdown Performance Plan

This plan captures two focused maintenance tasks for Recho:

- remediate the backend production dependency audit warning
- reduce the frontend Markdown and syntax highlighting bundle cost

The goal is to improve security posture and first-load performance without broad dependency churn.

## Current Findings

Backend audit:

```text
backend/gateway npm audit --omit=dev
1 moderate vulnerability from hono
path: @modelcontextprotocol/sdk -> @hono/node-server / hono
```

Frontend build:

```text
ChatMessage chunk: about 1 MB minified, about 352 KB gzip
Likely heavy contributors: markdown-it and highlight.js
```

Root install hygiene:

```text
@emnapi/wasi-threads is currently extraneous in root node_modules
```

## Non-Goals

- Do not upgrade Express 4 to Express 5 in this task.
- Do not upgrade OpenAI SDK 4 to 6 in this task.
- Do not replace Markdown rendering libraries in this task unless bundle splitting is insufficient.
- Do not mix UI behavior changes into dependency remediation.

## Task 1: Backend Audit Fix

### Objective

Resolve the current backend production audit warning while keeping gateway behavior unchanged.

### Proposed Steps

1. Run the audit fix inside `backend/gateway`:

   ```bash
   cd backend/gateway
   npm audit fix
   ```

2. Confirm the transitive path changed as expected:

   ```bash
   cd backend/gateway
   npm explain hono
   npm audit --omit=dev
   ```

3. Verify gateway type and build health:

   ```bash
   cd backend/gateway
   npm run typecheck
   npm run build
   ```

4. Verify app-level health:

   ```bash
   npm test
   npm run build
   ```

### Acceptance Criteria

- `backend/gateway npm audit --omit=dev` reports no production vulnerabilities, or the remaining finding is documented with the exact package path and reason.
- Gateway typecheck and build pass.
- Root tests and frontend build pass.
- Lockfile changes are limited to dependency remediation.

## Task 2: Markdown And Highlight Bundle Split

### Objective

Reduce the initial JavaScript cost caused by Markdown rendering and syntax highlighting.

### Current Hot Path

Relevant files:

```text
src/components/ChatMessage.vue
src/utils/markdown.ts
```

Current direct imports:

```text
markdown-it
highlight.js
```

The production build currently emits a large `ChatMessage` chunk. This is especially costly when the first visited route is `/image`, because chat Markdown code may be loaded before the user needs it.

### Proposed Steps

1. Move Markdown rendering behind a lazy boundary.

   Recommended options:

   - Lazy-load `ChatMessage.vue` where chat routes need it.
   - Or keep `ChatMessage.vue` loaded but dynamically import `src/utils/markdown.ts` only when rendering assistant content that needs Markdown.

2. Limit Highlight.js language registration.

   Prefer explicit language imports for likely languages:

   ```text
   javascript
   typescript
   json
   bash
   python
   css
   html
   markdown
   ```

   Avoid importing the all-language Highlight.js build.

3. Preserve rendering behavior.

   Keep support for:

   - code fences
   - inline code
   - links
   - paragraphs and lists
   - existing assistant message styling

4. Compare build output before and after.

   ```bash
   npm run build
   ```

   Capture:

   - `ChatMessage` chunk size
   - initial route chunks for `/image`
   - total gzip size of large chunks

### Acceptance Criteria

- Markdown rendering still works for chat messages.
- Code highlighting still works for the supported language set.
- `/image` first-load path no longer pulls the full Markdown/highlight chunk unless chat UI needs it.
- Production build passes.
- Tests pass.

## Optional Cleanup

Clean extraneous root packages after dependency work:

```bash
npm prune
npm ls --depth=0
```

This should be done after lockfile changes are stable.

## Risk Notes

- Dynamic Markdown rendering may require a loading or fallback state in chat messages.
- Restricting Highlight.js languages can affect uncommon code fences. Unknown languages should still render as plain code.
- `npm audit fix` may update transitive packages under `@modelcontextprotocol/sdk`; verify MCP routes and tool listing still work.

## Final Verification Checklist

```bash
cd backend/gateway && npm audit --omit=dev
cd backend/gateway && npm run typecheck
cd backend/gateway && npm run build
npm test
npm run build
npm ls --depth=0
```
