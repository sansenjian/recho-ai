# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` — Start Vite dev server (port 5173).
- `npm run build` — Run TypeScript check (`vue-tsc -b`) then bundle with Vite.
- `npm run preview` — Preview the production build locally.

## Project Architecture

This is a **Vue 3 + Vite** single-page application for an AI chat interface. It is currently a pure frontend with no API/backend integration.

### Key Files

- `src/App.vue` — Root component containing the full chat layout: header, message list, input area, and footer bar. Also holds the reactive `messages` state and `Message` interface.
- `src/components/ChatMessage.vue` — Renders individual chat messages (`user` vs `assistant`). User messages are right-aligned and bundled with their action buttons/timestamp in a unified wrapper.
- `src/style.css` — Global CSS reset and theme tokens (colors via CSS custom properties like `--bg`, `--accent`, `--border`, `--text-primary`).

### Conventions

- **Composition API** with `<script setup lang="ts">` and TypeScript strict types throughout.
- **Scoped CSS** for component-level styles.
- **SVG icons** are embedded inline in templates rather than imported as assets.
- Messages use an internal `Message` interface: `{ id, role: 'user' | 'assistant', content, timestamp }`.

### Component Design

- `App.vue` orchestrates state and layout. New messages are pushed into the `messages` array; the list renders via `v-for`.
- `ChatMessage.vue` handles layout differences between roles: assistant messages include a numbered blue avatar badge and left-aligned text; user messages are right-aligned with a wrapper containing text + action buttons below it.
- The input textarea auto-expands via an inline `@input` handler that adjusts `scrollHeight`.
