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

$env:PULSE_CONTROL_TOKEN = & ssh.exe -o BatchMode=yes 192.168.0.48 'sudo sed -n "s/^PULSE_CONTROL_TOKEN=//p" /etc/trading-keys/automation.env'
if ([string]::IsNullOrWhiteSpace($env:PULSE_CONTROL_TOKEN)) {
  throw 'Could not load the Pi control token over the authenticated SSH connection.'
}
$env:AUTOMATION_CONFIG_READ_TOKEN = & ssh.exe -o BatchMode=yes 192.168.0.48 'sudo sed -n "s/^APPROVED_STRATEGY_SYNC_TOKEN=//p" /etc/trading-keys/automation.env'
if ([string]::IsNullOrWhiteSpace($env:AUTOMATION_CONFIG_READ_TOKEN)) {
  throw 'Could not load the approved-strategy token over the authenticated SSH connection.'
}
$env:OANDA_DEMO_ACCOUNT_ID = & ssh.exe -o BatchMode=yes 192.168.0.48 'sudo sed -n "s/^OANDA_DEMO_ACCOUNT_ID=//p" /etc/trading-keys/automation.env'
$env:OANDA_DEMO_ACCOUNT_TOKEN = & ssh.exe -o BatchMode=yes 192.168.0.48 'sudo sed -n "s/^OANDA_DEMO_ACCOUNT_TOKEN=//p" /etc/trading-keys/automation.env'
if ([string]::IsNullOrWhiteSpace($env:OANDA_DEMO_ACCOUNT_ID) -or [string]::IsNullOrWhiteSpace($env:OANDA_DEMO_ACCOUNT_TOKEN)) {
  throw 'Could not load the Pi demo OANDA credentials over the authenticated SSH connection.'
}

Set-Location -LiteralPath $repository
$dashboardListener = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
if ($dashboardListener) {
  $buildId = (Get-Content -Raw -LiteralPath (Join-Path $repository '.next\BUILD_ID')).Trim()
  try {
    Invoke-WebRequest -Uri "http://localhost:4000/_next/static/$buildId/_buildManifest.js" -UseBasicParsing -TimeoutSec 5 | Out-Null
  } catch {
    $dashboardPid = $dashboardListener.OwningProcess
    $dashboardProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$dashboardPid"
    if ($dashboardProcess.CommandLine -like "*$repository*next*start*-p*4000*") {
      Stop-Process -Id $dashboardPid -Force
    } else {
      throw "Port 4000 is occupied by an unexpected process; refusing to stop PID $dashboardPid."
    }
  }
}
if (-not (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process -FilePath (Join-Path $repository 'node_modules\.bin\next.cmd') `
    -ArgumentList 'start','-p','4000' `
    -WorkingDirectory $repository `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory 'local-dashboard.log') `
    -RedirectStandardError (Join-Path $logDirectory 'local-dashboard.error.log')
}

# Research is archive-only. Do not let a workstation research worker inherit
# credentials that could apply a result to local automation or the Pi.
$env:PI_PULSE_CONTROL_TOKEN = ''
$env:PULSE_CONTROL_TOKEN = ''

Start-Process -FilePath (Join-Path $repository 'node_modules\.bin\tsx.cmd') `
  -ArgumentList 'runner/resumeAutoResearch.ts' `
  -WorkingDirectory $repository `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDirectory 'local-research.log') `
  -RedirectStandardError (Join-Path $logDirectory 'local-research.error.log')
