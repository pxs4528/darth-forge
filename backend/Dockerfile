# Stage 1: Build the Go binary.
# --platform=$BUILDPLATFORM keeps this stage native on the CI runner (amd64);
# Go cross-compiles to the target arch via GOOS/GOARCH — no QEMU, fast builds.
FROM --platform=$BUILDPLATFORM docker.io/library/golang:1.21-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# Copy go.mod/go.sum for dependency caching
COPY go.mod go.sum* ./

# Download dependencies (cached if go.mod hasn't changed)
RUN go mod download

# Copy source code
COPY . .

# Build static binary for the target platform
# CGO_ENABLED=0: fully static binary (also required by the libsql HTTP driver path)
# -ldflags="-w -s": strip debug info to reduce binary size
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-arm64} \
    go build -ldflags="-w -s" -o api ./cmd/api

# Stage 2: Run the binary in minimal image
FROM docker.io/library/alpine:latest

# Add ca-certificates for HTTPS requests (Turso, USCIS, ntfy)
RUN apk --no-cache add ca-certificates

WORKDIR /app

# Copy only the compiled binary from builder
COPY --from=builder /app/api .

EXPOSE 8080

CMD ["./api"]
