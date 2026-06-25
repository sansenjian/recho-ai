# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install build dependencies: git for go mod, vips-dev for image processing
RUN apk add --no-cache git vips-dev vips-heif build-base pkgconf

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary with CGO enabled for libvips
RUN CGO_ENABLED=1 GOOS=linux go build -a -o go-gateway ./cmd/server

# Runtime stage
FROM alpine:3.24

WORKDIR /app

# Install runtime dependencies for libvips, CA certificates, timezone data
RUN apk add --no-cache vips vips-heif ca-certificates tzdata \
    && addgroup -S app \
    && adduser -S -G app app

# Copy binary from builder
COPY --from=builder /app/go-gateway .

# Expose port
EXPOSE 3000

# Set environment
ENV PORT=3000

# Run as non-root
USER app

# Run
CMD ["./go-gateway"]
