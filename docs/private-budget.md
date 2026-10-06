# Private budget on budget.pipboi.dev

All production changes go through PC commits -> GitHub Actions deployment.
No manual SSH changes are needed for this configuration.

## Before pushing

1. Cloudflare -> My Profile -> API Tokens -> Create Custom Token.
   Permissions: Zone / DNS / Edit and Zone / Zone / Read.
   Zone Resources: Include / Specific zone / pipboi.dev.
2. Save the token as GitHub repository secret CLOUDFLARE_API_TOKEN.
   Do not paste it into chat or commit it.
3. Keep TAILSCALE_IP=100.67.171.24 and VPS_HOST=159.195.246.62 as
   repository secrets. VPS_HOST must be the actual public IPv4, not a hostname.
4. Cloudflare DNS: budget A -> 100.67.171.24, DNS only (grey cloud).
   Remove public-IP and AAAA records for budget. Keep portfolio DNS unchanged.
   An existing hosts entry for the same Tailscale IP is fine.

DNS is discoverable publicly, but its Tailscale IP is reachable only through
Tailscale. DNS-01 proves domain control with TXT records; certificate issuance
and renewal do not require public access to the budget server.

## Deployment

CI builds the frontend image with caddy-dns/cloudflare, copies the versioned
Compose and Caddy configuration, and runs deploy-vps.sh. Public IPv4 port 443
maps to container 443 (portfolio and a budget 404). Tailscale IPv4 port 443 maps
to container 8443 (budget). Caddy never binds the host IP inside the container.
Unset addresses cause Compose to fail, rather than bind to every interface.
The former Serve upstream is removed; no sudo Tailscale setup is required.

Connect Tailscale and open https://budget.pipboi.dev (no port or path needed).
Allow DNS-01 certificate issuance to complete; check frontend logs in deployment
output if it fails. Admin authentication remains required.

## Acceptance checks

On your PC:

```powershell
Test-NetConnection 100.67.171.24 -Port 443
curl.exe --resolve budget.pipboi.dev:443:100.67.171.24 https://budget.pipboi.dev/api/health
curl.exe --resolve budget.pipboi.dev:443:159.195.246.62 https://budget.pipboi.dev/api/health
```

With Tailscale connected: private health must return 200. Public health must
return 404 regardless of DNS or Host header. With Tailscale disconnected the
private request must fail. Portfolio health must still return 200.
A public 401 for budget is a failure: it means the login endpoint is exposed.

The public portfolio publishes IPv4 only in this configuration. If portfolio
has a DNS AAAA record, remove it or deliberately add separate public IPv6 bindings.
The frontend and backend remain shared: this isolates network access, not processes.