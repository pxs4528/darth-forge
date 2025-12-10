#!/usr/bin/env python3
"""
Simple webhook listener for GitHub deployments
Listens for GitHub push events and triggers deployment
"""

import hashlib
import hmac
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from datetime import datetime

PORT = int(os.getenv('WEBHOOK_PORT', '9000'))
WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET', 'changeme').encode('utf-8')
DEPLOY_SCRIPT = os.getenv('DEPLOY_SCRIPT', '/home/darth/darth-forge/.cicd/deploy.sh')


class WebhookHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != '/webhook':
            self.send_response(404)
            self.end_headers()
            return

        # Get the signature from headers
        signature_header = self.headers.get('X-Hub-Signature-256')

        # Read the payload
        content_length = int(self.headers.get('Content-Length', 0))
        payload = self.rfile.read(content_length)

        # Verify signature if secret is set
        if WEBHOOK_SECRET != b'changeme' and signature_header:
            expected_signature = 'sha256=' + hmac.new(
                WEBHOOK_SECRET, payload, hashlib.sha256
            ).hexdigest()

            if not hmac.compare_digest(signature_header, expected_signature):
                print(f"[{datetime.now()}] Invalid signature!")
                self.send_response(403)
                self.end_headers()
                self.wfile.write(b'{"error": "Invalid signature"}')
                return

        # Trigger deployment
        print(f"[{datetime.now()}] Webhook received - triggering deployment")

        try:
            # Run deployment script in background
            subprocess.Popen(
                ['/bin/bash', DEPLOY_SCRIPT],
                stdout=open('/home/darth/darth-forge/.cicd/deploy.log', 'a'),
                stderr=subprocess.STDOUT
            )

            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "deployment triggered"}')

        except Exception as e:
            print(f"[{datetime.now()}] Error: {e}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f'{{"error": "{str(e)}"}}'.encode())

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status": "healthy"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        print(f"[{datetime.now()}] {format % args}")


def run_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, WebhookHandler)
    print(f"[{datetime.now()}] Webhook listener starting on port {PORT}")
    print(f"[{datetime.now()}] POST to http://YOUR_IP:{PORT}/webhook")
    print(f"[{datetime.now()}] Health check: http://YOUR_IP:{PORT}/health")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print(f"\n[{datetime.now()}] Shutting down...")
        httpd.shutdown()


if __name__ == '__main__':
    run_server()
