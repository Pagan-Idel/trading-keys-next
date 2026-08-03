[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repository 'data'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

if (-not (Get-NetTCPConnection -LocalPort 4080 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath 'ssh.exe' `
    -ArgumentList '-N','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3','-L','4080:127.0.0.1:4080','192.168.0.48' `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'pi-tunnel.log') `
    -RedirectStandardError (Join-Path $logDirectory 'pi-tunnel.error.log')
}

if (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) { exit 0 }

$env:PULSE_CONTROL_TOKEN = & ssh.exe -o BatchMode=yes 192.168.0.48 'sudo sed -n "s/^PULSE_CONTROL_TOKEN=//p" /etc/trading-keys/automation.env'
if ([string]::IsNullOrWhiteSpace($env:PULSE_CONTROL_TOKEN)) {
  throw 'Could not load the Pi control token over the authenticated SSH connection.'
}

Set-Location -LiteralPath $repository
& (Join-Path $repository 'node_modules\.bin\next.cmd') start -p 4000 `
  1>> (Join-Path $logDirectory 'local-dashboard.log') `
  2>> (Join-Path $logDirectory 'local-dashboard.error.log')
