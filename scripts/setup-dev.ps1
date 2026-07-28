# One-command dev environment setup for darth-forge (Windows).
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-dev.ps1
#
# Installs Go + Node LTS via winget (skipping anything already present),
# pulls dependencies, and runs the full check suite. Idempotent -- safe to
# re-run any time. Verified on Windows 11 with winget 1.29.
# ASCII only: PowerShell 5.1 misparses BOM-less UTF-8.
#
# After setup:  npm run dev   (frontend :3000 with /api proxied to Go on :8080)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Ensure-Tool([string]$cmd, [string]$wingetId, [string]$label) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        Write-Host "[ok] $label already installed: $((Get-Command $cmd).Source)"
        return
    }
    Write-Host "[..] Installing $label via winget..."
    winget install --id $wingetId -e --accept-source-agreements --accept-package-agreements --disable-interactivity
    Refresh-Path
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "$label installed but '$cmd' still not on PATH -- open a new terminal and re-run."
    }
    Write-Host "[ok] $label installed"
}

Refresh-Path
Ensure-Tool 'go'   'GoLang.Go'         'Go'
Ensure-Tool 'node' 'OpenJS.NodeJS.LTS' 'Node.js LTS'

Write-Host ""
Write-Host "[..] Backend dependencies + checks"
Set-Location (Join-Path $repo 'backend')
go mod download
go build ./...
go vet ./...
go test ./...
Write-Host "[ok] backend clean"

Write-Host ""
Write-Host "[..] Frontend dependencies + checks"
Set-Location $repo
npm install --no-audit --no-fund
npx tsc --noEmit -p frontend
npm run lint
npm run test:frontend
Write-Host "[ok] frontend clean"

Write-Host ""
Write-Host "Done. Daily use:"
Write-Host "  npm run dev          # frontend :3000 + backend :8080 together"
Write-Host "  npm test             # everything"
Write-Host ""
Write-Host "Backend env vars for local dev (PowerShell, before npm run dev):"
Write-Host "  `$env:ADMIN_SECRET       = 'pick-something'"
Write-Host "  `$env:TURSO_DATABASE_URL = 'libsql://...'   # use a -dev database, not prod"
Write-Host "  `$env:TURSO_AUTH_TOKEN   = '...'"
Write-Host "Without the Turso vars the site runs but /budget API returns 503."
