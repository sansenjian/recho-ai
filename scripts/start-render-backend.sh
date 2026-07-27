#!/bin/sh
set -eu

GO_GATEWAY_PORT="${GO_GATEWAY_PORT:-3001}"
export GO_GATEWAY_PORT
NODE_PID=""
CLEANING_UP=0

(
  cd /app/backend/go-gateway
  PORT="$GO_GATEWAY_PORT" ./go-gateway
) &
GO_PID="$!"

cleanup() {
  if [ "$CLEANING_UP" -eq 1 ]; then
    return
  fi
  CLEANING_UP=1
  trap '' INT TERM
  trap - EXIT

  for pid in "$NODE_PID" "$GO_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done

  for pid in "$NODE_PID" "$GO_PID"; do
    if [ -z "$pid" ]; then
      continue
    fi

    attempts=0
    while kill -0 "$pid" 2>/dev/null && [ "$attempts" -lt 10 ]; do
      sleep 1
      attempts=$((attempts + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  done
}

handle_signal() {
  exit_code="$1"
  cleanup
  exit "$exit_code"
}

trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM
trap cleanup EXIT

MAX_ATTEMPTS=60

for attempt in $(seq 1 $MAX_ATTEMPTS); do
  if ! kill -0 "$GO_PID" 2>/dev/null; then
    echo "go-gateway exited before becoming healthy" >&2
    exit 1
  fi

  # Use /ready (not /health) because /ready checks DB connectivity.
  # /health always returns 200 even when DB is not connected.
  if node -e "fetch('http://127.0.0.1:${GO_GATEWAY_PORT}/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    break
  fi

  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "go-gateway did not become ready on port ${GO_GATEWAY_PORT} (DB connection may have failed)" >&2
    exit 1
  fi

  sleep 2
done

cd /app/backend/gateway
node dist/index.js &
NODE_PID="$!"

# The public Node gateway and Go sidecar form one service. Exit the container
# when either process dies so Render restarts the complete pair.
while kill -0 "$GO_PID" 2>/dev/null && kill -0 "$NODE_PID" 2>/dev/null; do
  sleep 2
done

if ! kill -0 "$GO_PID" 2>/dev/null; then
  echo "go-gateway exited after startup" >&2
  wait "$GO_PID" 2>/dev/null || true
  exit 1
fi

echo "node gateway exited after startup" >&2
wait "$NODE_PID" 2>/dev/null || true
exit 1
