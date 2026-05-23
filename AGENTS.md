# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` — Start the Express gateway and Vite dev server together.
- `npm run dev:frontend` — Start only the Vite dev server (port 5173, proxies `/api` to port 3000).
- `npm run dev:backend` — Start only the gateway from `backend/gateway/src/index.ts` (port 3000).
- `npm run build` — Run TypeScript check (`vue-tsc -b`) then bundle with Vite.
- `npm test` — Run Vitest tests.
- `npm run preview` — Preview the production build locally.
- `cd backend/gateway && npm run build` — Compile the gateway TypeScript to `dist/`.
- `cd backend/gateway && npm run typecheck` — Type-check the gateway without emitting files.

## Project Architecture

This is a **Vue 3 + Vite** single-page AI chat application with a **Node/Express API gateway**. The frontend stores conversations locally and streams chat responses from `/api/chat`; the gateway routes requests to OpenAI-compatible providers, loads skills, and exposes MCP tools.

### Key Files

- `src/App.vue` — Root component orchestrating layout, active model, image uploads, skills, system prompt editing, and chat submission.
- `src/stores/chat.ts` — Module-level Vue store for conversations, groups, active conversation, titles, and localStorage persistence.
- `src/composables/useChatLoop.ts` — Builds chat requests, streams assistant output, tracks loading/abort state, and updates titles.
- `src/composables/useStream.ts` and `src/workers/sse-parser.worker.ts` — Fetch `/api/chat` and parse SSE stream events off the main thread.
- `src/components/ChatMessage.vue` — Renders individual chat messages (`user` vs `assistant`). User messages are right-aligned and bundled with their action buttons/timestamp in a unified wrapper.
- `src/components/ChatInput.vue` — Handles textarea UX, model selection, skill slash commands, pending images, submit/stop actions.
- `src/style.css` — Global CSS reset and theme tokens (colors via CSS custom properties like `--bg`, `--accent`, `--border`, `--text-primary`).
- `backend/gateway/src/index.ts` — Express gateway entrypoint.
- `backend/gateway/src/routes/chat.ts` — `/api/chat` route with model selection, skill prompt handling, retry behavior, and streaming response.
- `backend/gateway/src/services/chat-loop.ts` — Streaming tool-call loop that normalizes SSE events for the frontend.
- `backend/gateway/src/mcp/manager.ts` — MCP connection manager and OpenAI-compatible tool schema adapter.
- `backend/gateway/skills/index.json` — Built-in skill definitions surfaced to the frontend.

### Conventions

- **Composition API** with `<script setup lang="ts">` and TypeScript strict types throughout.
- **Scoped CSS** for component-level styles.
- **SVG icons** are embedded inline in templates rather than imported as assets.
- Messages use an internal `Message` interface with optional images: `{ id, role: 'user' | 'assistant', content, images?, timestamp }`.
- The gateway source of truth is TypeScript under `backend/gateway/src/`; deployment should build it and run `backend/gateway/dist/index.js` via `npm start`.

### Component Design

- `App.vue` orchestrates state and layout. New messages are pushed into the active conversation in the chat store; the list renders via `v-for`.
- `ChatMessage.vue` handles layout differences between roles: assistant messages include a numbered blue avatar badge and left-aligned text; user messages are right-aligned with a wrapper containing text + action buttons below it.
- `ChatInput.vue` owns the auto-expanding textarea and emits typed events to `App.vue`.
