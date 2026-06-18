# Build Go sidecar
FROM golang:1.25-alpine AS go-builder

WORKDIR /app/backend/go-gateway
RUN apk add --no-cache git
COPY backend/go-gateway/go.mod backend/go-gateway/go.sum ./
RUN go mod download
COPY backend/go-gateway ./
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /out/go-gateway ./cmd/server

# Build Node gateway
FROM node:22-alpine AS node-builder

WORKDIR /app/backend/gateway
COPY backend/gateway/package*.json ./
RUN npm ci
COPY backend/gateway ./
RUN npm run build && npm prune --omit=dev

# Runtime
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata tini \
    && addgroup -S app \
    && adduser -S -G app app

COPY --from=node-builder /app/backend/gateway ./backend/gateway
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
