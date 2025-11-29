# Stage 1: Build the Go binary
FROM docker.io/library/golang:1.21-alpine AS builder

WORKDIR /app

# Copy go.mod (and go.sum if it exists) for dependency caching
COPY go.mod ./

# Download dependencies (cached if go.mod hasn't changed)
RUN go mod download

# Copy source code
COPY . .

# Build static binary
# CGO_ENABLED=0: Disable C dependencies for fully static binary
# GOOS=linux: Target Linux OS
# -ldflags="-w -s": Strip debug info to reduce binary size
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o api ./cmd/api

# Stage 2: Run the binary in minimal image
FROM docker.io/library/alpine:latest

# Add ca-certificates for HTTPS requests (if your API makes external calls)
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy only the compiled binary from builder
COPY --from=builder /app/api .

# Expose the port your API listens on
EXPOSE 8080

# Run the binary
CMD ["./api"]
