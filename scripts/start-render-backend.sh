#!/bin/sh
set -eu

GO_GATEWAY_PORT="${GO_GATEWAY_PORT:-3001}"
export GO_GATEWAY_PORT

(
  cd /app/backend/go-gateway
  PORT="$GO_GATEWAY_PORT" ./go-gateway
) &
GO_PID="$!"

cleanup() {
  kill "$GO_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

cd /app/backend/gateway
node dist/index.js
