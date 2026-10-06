# Private budget deployment

Budget is served on container port 8081, published to VPS loopback only.
Public budget.pipboi.dev returns 404. Admin authentication remains required.
The portfolio continues to use public ports 80/443.

## Deploy from the repository on the VPS

Back up the current Compose and Caddy files before copying these changes.
Copy BOTH compose.vps.yaml and frontend/Caddyfile.vps to the deployment directory.
The Caddyfile is mounted, so an image rebuild is unnecessary for this change.

```bash
cd /home/deploy/darth-forge
docker compose --env-file .env.vps -f compose.vps.yaml config --quiet
docker compose --env-file .env.vps -f compose.vps.yaml run --rm --no-deps frontend caddy validate --config /etc/caddy/Caddyfile.vps --adapter caddyfile
docker compose --env-file .env.vps -f compose.vps.yaml up -d --force-recreate frontend
sudo tailscale serve --bg --https=8443 http://127.0.0.1:8081
tailscale serve status
```

Follow any Tailscale HTTPS enablement prompt. Open the URL printed by Serve,
with /budget appended, from a device connected to your tailnet. Do not enable
Tailscale Funnel: it makes services public. Check `tailscale funnel status`
and disable any existing Funnel configuration before using this service.
Use tailnet access policies to restrict access to your own devices.

## Verify before calling it private

- Portfolio https://pipboi.dev/api/health still returns 200.
- Public https://budget.pipboi.dev/ and /api/admin/auth return 404.
- Docker publishes budget as 127.0.0.1:8081, never 0.0.0.0:8081 or [::]:8081.
- Tailscale URL on port 8443 works with Tailscale connected and cannot be
  reached from a device outside the tailnet. Login remains required.
- A request to public-ip:8081 from another machine fails.

Docker versions before 28 have a documented caveat allowing same-L2 peers
access to localhost-published ports. Upgrade Docker to a supported version
and verify network isolation; see Docker port-publishing documentation.

Remove the old budget DNS record and any Windows hosts override after switching
bookmarks to the Tailscale URL. The public Caddy block is deliberately retained
as a denial rule for requests specifying the old hostname.

This is network access isolation, not process/data isolation: both surfaces
still share a backend. Separating backend services and credentials is future work.