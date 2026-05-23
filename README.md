# recho-ai

A Vue 3 + Vite AI chat app with a Node/Express gateway. The frontend streams chat responses from `/api/chat`, stores conversations in `localStorage`, supports image messages and skill slash commands, and the gateway routes OpenAI-compatible model calls with optional MCP tools.

## Commands

- `npm run dev` - start the gateway and Vite dev server together.
- `npm run dev:frontend` - start only Vite on port 5173.
- `npm run dev:backend` - start only the gateway on port 3000.
- `npm test` - run Vitest tests.
- `npm run build` - type-check and build the frontend.
- `cd backend/gateway && npm run build` - compile the gateway TypeScript.
- `cd backend/gateway && npm start` - run the compiled gateway from `dist/index.js`.

## Structure

- `src/` - Vue frontend, chat store, stream parser worker, and UI components.
- `backend/gateway/src/` - Express API gateway source.
- `backend/gateway/skills/index.json` - skill presets shown in the chat input.
- `backend/gateway/mcp.json` - MCP server configuration.
