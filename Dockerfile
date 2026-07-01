# Build Go sidecar
FROM golang:1.25-alpine AS go-builder

WORKDIR /app/backend/go-gateway
RUN apk add --no-cache git
COPY backend/go-gateway/go.mod backend/go-gateway/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY backend/go-gateway ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/go-gateway ./cmd/server

# Install Node production deps in a source-independent layer.
FROM node:22-alpine AS node-prod-deps

WORKDIR /app/backend/gateway
COPY backend/gateway/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Build Node gateway
FROM node:22-alpine AS node-builder

WORKDIR /app/backend/gateway
COPY backend/gateway/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY backend/gateway/tsconfig.json ./tsconfig.json
COPY backend/gateway/src ./src
COPY backend/gateway/skills ./skills
RUN npm run build

# Runtime
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata tini \
    && addgroup -S app \
    && adduser -S -G app app

COPY backend/gateway/package*.json ./backend/gateway/
COPY --from=node-prod-deps /app/backend/gateway/node_modules ./backend/gateway/node_modules
COPY --from=node-builder /app/backend/gateway/dist ./backend/gateway/dist
COPY backend/gateway/skills ./backend/gateway/skills
COPY backend/gateway/mcp.json ./backend/gateway/mcp.json
COPY --from=go-builder /out/go-gateway ./backend/go-gateway/go-gateway
COPY scripts/start-render-backend.sh ./scripts/start-render-backend.sh

RUN chmod +x ./scripts/start-render-backend.sh \
    && chown -R app:app /app

ENV PORT=3000
ENV GO_GATEWAY_PORT=3001
ENV GO_GATEWAY_BASE_URL=http://127.0.0.1:3001

EXPOSE 3000

USER app

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./scripts/start-render-backend.sh"]
