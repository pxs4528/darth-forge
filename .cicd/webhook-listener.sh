#!/bin/bash
# Simple webhook listener for GitHub deployments
# Listens on port 9000 for webhook events

PORT=9000
WEBHOOK_SECRET="${WEBHOOK_SECRET:-changeme}"
DEPLOY_SCRIPT="/home/darth/darth-forge/.cicd/deploy.sh"

echo "Starting webhook listener on port $PORT..."
echo "Webhook secret: ${WEBHOOK_SECRET:0:4}***"

# Use netcat to listen for HTTP requests
while true; do
    response=$(echo -e "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"received\"}" )

    echo "$response" | nc -l -p $PORT -q 1 | while IFS= read -r line; do
        # Check for GitHub webhook signature header
        if [[ "$line" =~ X-Hub-Signature.*$ ]]; then
            echo "Received webhook: $line"
        fi

        # Detect end of headers (empty line)
        if [[ "$line" =~ ^[[:space:]]*$ ]]; then
            echo "Webhook received at $(date)"
            echo "Triggering deployment..."

            # Run deployment script in background
            bash "$DEPLOY_SCRIPT" >> /home/darth/darth-forge/.cicd/deploy.log 2>&1 &

            break
        fi
    done
done
