# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o go-gateway ./cmd/server

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install CA certificates for HTTPS
RUN apk add --no-cache ca-certificates tzdata

# Copy binary from builder
COPY --from=builder /app/go-gateway .

# Expose port
EXPOSE 3000

# Set environment
ENV PORT=3000

# Run
CMD ["./go-gateway"]
