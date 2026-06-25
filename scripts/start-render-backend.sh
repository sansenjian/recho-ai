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

for attempt in $(seq 1 60); do
  if ! kill -0 "$GO_PID" 2>/dev/null; then
    echo "go-gateway exited before becoming healthy" >&2
    exit 1
  fi

  # Use /ready (not /health) because /ready checks DB connectivity.
  # /health always returns 200 even when DB is not connected.
  if node -e "fetch('http://127.0.0.1:${GO_GATEWAY_PORT}/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "go-gateway did not become ready on port ${GO_GATEWAY_PORT} (DB connection may have failed)" >&2
    exit 1
  fi

  sleep 2
done

cd /app/backend/gateway
node dist/index.js
