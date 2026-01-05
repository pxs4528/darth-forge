FROM docker.io/library/node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
ARG CACHEBUST=1
COPY frontend ./frontend
# Limit Node.js memory to prevent OOM on Raspberry Pi
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

FROM docker.io/library/caddy:2
COPY --from=builder /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
