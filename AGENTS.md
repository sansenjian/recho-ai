# AGENTS.md

This file provides guidance to Codex and Claude Code when working with code in this repository.

## Development Commands

- `npm run dev` — Start the Express gateway, Go gateway, and Vite dev server together. Vite proxies `/api` to Node; Node proxies Go-owned routes to Go via `GO_GATEWAY_BASE_URL`.
- `npm run dev:node` — Start only the Express gateway and Vite dev server. Legacy Node image generation is disabled in this mode.
- `npm run dev:frontend` — Start only the Vite dev server (port 5173, proxies `/api` to port 3000).
- `npm run dev:backend` — Start only the gateway from `backend/gateway/src/index.ts` (port 3000).
- `npm run build` — Run TypeScript check (`vue-tsc -b`) then bundle with Vite.
- `npm test` — Run Vitest tests.
- `npm run preview` — Preview the production build locally.
- `cd backend/gateway && npm run build` — Compile the Node gateway TypeScript to `dist/`.
- `cd backend/gateway && npm run typecheck` — Type-check the Node gateway without emitting files.
- `cd backend/go-gateway && go build ./cmd/server/...` — Build the Go gateway binary.

## Project Architecture

This is a **Vue 3 + Vite** single-page AI chat application with a **dual-gateway backend** (Node/Express + Go). The frontend stores conversations locally and streams chat responses from `/api/chat`; the Node gateway routes requests to OpenAI-compatible providers, loads skills, and exposes MCP tools. The Go gateway handles the image generation pipeline, credit management, and object storage.

### Frontend

- `src/App.vue` — Root component orchestrating layout, active model, image uploads, skills, system prompt editing, and chat submission.
- `src/stores/chat.ts` — Module-level Vue store for conversations, groups, active conversation, titles, and localStorage persistence.
- `src/composables/useChatLoop.ts` — Builds chat requests, streams assistant output, tracks loading/abort state, and updates titles.
- `src/composables/useStream.ts` and `src/workers/sse-parser.worker.ts` — Fetch `/api/chat` and parse SSE stream events off the main thread.
- `src/composables/useImageGen.ts` — Image generation composable with credit reservation, history, and result tracking.
- `src/composables/useImageCanvas.ts` — Canvas-mode node-based image workspace with pan/zoom, drag-and-drop, and node connections.
- `src/components/ChatMessage.vue` — Renders individual chat messages (`user` vs `assistant`). User messages are right-aligned and bundled with their action buttons/timestamp in a unified wrapper.
- `src/components/ChatInput.vue` — Handles textarea UX, model selection, skill slash commands, pending images, submit/stop actions.
- `src/components/ImageCanvas.vue` — Node-based image canvas with workspace tabs, parameter sidebar, and SVG connection lines.
- `src/components/ImagioView.vue` — Single-image generation panel with model/resolution/quality/size parameters.
- `src/assets/css/globals.css` — shadcn-vue theme tokens (CSS custom properties for light/dark mode: `--background`, `--foreground`, `--border`, `--radius`, etc.).
- `src/style.css` — Global CSS reset, markdown message styling, and base Tailwind directives.

### Node Gateway

- `backend/gateway/src/index.ts` — Express gateway entrypoint.
- `backend/gateway/src/routes/chat.ts` — `/api/chat` route with model selection, skill prompt handling, retry behavior, and streaming response.
- `backend/gateway/src/routes/image.ts` — Node fallback image routes. Reference upload/storage proxy remain for compatibility, while `/api/image/generate` returns a 503 migration message when Go sidecar proxy is not enabled.
- `backend/gateway/src/routes/go-sidecar.ts` — Proxies Go-owned routes (`/api/image/*`, `/api/credits*`, selected `/api/config/*`) to the Go gateway with timeout cleanup and client-disconnect abort handling.
- `backend/gateway/src/services/chat-loop.ts` — Streaming tool-call loop that normalizes SSE events for the frontend.
- `backend/gateway/src/mcp/manager.ts` — MCP connection manager and OpenAI-compatible tool schema adapter.
- `backend/gateway/skills/index.json` — Built-in skill definitions surfaced to the frontend.

### Go Gateway

- `backend/go-gateway/cmd/server/main.go` — Go gateway entrypoint with Supabase client initialization.
- `backend/go-gateway/internal/handler/image.go` — Image generation handler with credit reservation, S3 upload, thumbnail generation, history save, and rollback on failure.
- `backend/go-gateway/internal/service/storage.go` — Storage service with S3/COS upload, libvips image processing, thumbnail generation, and object lifecycle management.
- `backend/go-gateway/internal/pkg/supabase/client.go` — Supabase PostgreSQL client wrapper with connection pooling.

### Database

- **PostgreSQL** via Supabase. Key tables: `image_generations`, `image_history`, `image_attempts`, `users` (with credits), `app_settings`, `provider_settings`, `admin_announcements`.
- Go gateway uses `pgx` for direct TCP connections; Node gateway uses Supabase JS SDK for management operations.

## Conventions

- **Composition API** with `<script setup lang="ts">` and TypeScript strict types throughout.
- **Tailwind CSS + shadcn-vue** for all UI styling. No handwritten `<style scoped>` blocks in components — use Tailwind utility classes and shadcn primitives (`Button`, `Badge`, `Input`, `Textarea`, `Card`, `Dialog`, `ScrollArea`, etc.).
- **Icons** from `@lucide/vue`. Do not embed inline SVGs in templates; import the named icon component instead.
- Messages use an internal `Message` interface with optional images: `{ id, role: 'user' | 'assistant', content, images?, timestamp }`.
- The Node gateway source of truth is TypeScript under `backend/gateway/src/`; deployment should build it and run `backend/gateway/dist/index.js` via `npm start`.
- The Go gateway source of truth is under `backend/go-gateway/`; deployment builds a static binary.
- **CSS variables** follow the shadcn convention: `hsl(var(--background))`, `hsl(var(--foreground))`, `hsl(var(--border))`, `var(--radius)`. Dark mode toggles via `dark` class on `document.documentElement`.
- **Color tokens** for semantic meaning: `text-foreground` / `text-muted-foreground` / `text-accent-foreground`, `bg-background` / `bg-muted` / `bg-accent`, `border-border`.

## Git Workflow

- **All changes must go through Pull Requests.** Do not push directly to `master`.
- Create a feature branch from `master`: `git checkout -b feat/<description>` or `fix/<description>`.
- After completing changes, push the branch and open a PR on GitHub for review.
- Keep commits focused and write descriptive commit messages.

## Component Design

- `App.vue` orchestrates state and layout. New messages are pushed into the active conversation in the chat store; the list renders via `v-for`.
- `ChatMessage.vue` handles layout differences between roles: assistant messages include a numbered blue avatar badge and left-aligned text; user messages are right-aligned with a wrapper containing text + action buttons below it.
- `ChatInput.vue` owns the auto-expanding textarea and emits typed events to `App.vue`.
- `ImageCanvas.vue` uses a custom pan/zoom canvas with HTML nodes positioned absolutely. Nodes support drag, resize, and connect via SVG bezier curves. Right sidebar is hidden in canvas mode per `project_memory.md` constraints.
- `AdminView.vue` provides management dashboards for images, generation attempts, storage overview, runtime settings, and provider/API key configuration.
