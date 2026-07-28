# Daily budget-database pull for a dev PC / laptop (Windows).
#
# Fetches a full SQL dump from the live site's /api/admin/budget/dump using
# the dedicated BACKUP_TOKEN (never the admin password), saves it dated, and
# prunes old copies. Complementary to the Pi's own nightly cron dump.
#
# Config: %USERPROFILE%\.budget-backup.json
#   { "url": "https://your-domain.com/api/admin/budget/dump",
#     "token": "<BACKUP_TOKEN value from .env.prod>",
#     "dir": "optional output dir", "keepDays": 60 }
#
# Register as a daily scheduled task (see docs/budget.md).
# ASCII only: PowerShell 5.1 misparses BOM-less UTF-8.

$ErrorActionPreference = 'Stop'

$cfgPath = Join-Path $env:USERPROFILE '.budget-backup.json'
if (-not (Test-Path $cfgPath)) {
    Write-Error "Missing $cfgPath - create it with url + token (see script header)."
    exit 1
}
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
if (-not $cfg.url -or -not $cfg.token -or $cfg.token -eq 'PASTE-BACKUP-TOKEN-HERE') {
    Write-Error "Fill in url and token in $cfgPath"
    exit 1
}

if ($cfg.dir) { $dir = $cfg.dir } else { $dir = Join-Path $env:USERPROFILE 'Backups\budget' }
if ($cfg.keepDays) { $keepDays = [int]$cfg.keepDays } else { $keepDays = 60 }
New-Item -ItemType Directory -Force $dir | Out-Null

$out = Join-Path $dir ("budget-" + (Get-Date -Format 'yyyy-MM-dd') + ".sql")
$tmp = "$out.tmp"

Invoke-WebRequest -Uri $cfg.url -Headers @{ 'X-Backup-Token' = $cfg.token } `
    -OutFile $tmp -UseBasicParsing -TimeoutSec 60

# a dump under 100 bytes means something went wrong - keep previous backups
$size = (Get-Item $tmp).Length
if ($size -lt 100) {
    Remove-Item $tmp -Force
    Write-Error "Backup FAILED - response too small ($size bytes)"
    exit 1
}
Move-Item $tmp $out -Force

Get-ChildItem $dir -Filter 'budget-*.sql' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$keepDays) } |
    Remove-Item -Force -Confirm:$false

Write-Output ("[{0}] backup ok: {1} ({2} bytes)" -f (Get-Date), $out, $size)
