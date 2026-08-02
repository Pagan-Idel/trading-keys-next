[CmdletBinding()]
param(
  [switch]$Candidate,
  [string]$HostName = $(if ($env:TRADING_KEYS_PI_HOST) { $env:TRADING_KEYS_PI_HOST } else { '192.168.0.48' })
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repository

function Invoke-Checked {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Program failed with exit code $LASTEXITCODE."
  }
}

if ((git branch --show-current) -ne 'main') {
  throw 'Pi deployment is restricted to the main branch.'
}
if (git status --porcelain) {
  throw 'Commit or stash local changes before deploying.'
}

Invoke-Checked git @('fetch', 'origin', 'main', '--prune')
$localCommit = (git rev-parse HEAD).Trim()
$remoteCommit = (git rev-parse origin/main).Trim()
if ($localCommit -ne $remoteCommit) {
  throw "Local main ($($localCommit.Substring(0, 12))) must exactly match origin/main ($($remoteCommit.Substring(0, 12)))."
}

$mode = if ($Candidate) { 'validated candidate (no restart)' } else { 'validated promotion' }
Write-Host "Deploying $($localCommit.Substring(0, 12)) to $HostName as $mode..."
$remoteCommand = if ($Candidate) {
  'sudo /srv/trading-keys/source/pi/deploy.sh'
} else {
  'sudo /srv/trading-keys/source/pi/deploy.sh --promote'
}
Invoke-Checked ssh @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', $HostName, $remoteCommand)

if ($Candidate) {
  Write-Host 'Candidate validated. Re-run without --candidate to promote it.'
  exit 0
}

$activeCommit = (& ssh -o BatchMode=yes -o ConnectTimeout=10 $HostName 'cat /srv/trading-keys/app/DEPLOYED_COMMIT').Trim()
if ($LASTEXITCODE -ne 0 -or $activeCommit -ne $localCommit) {
  throw 'Pi deployment completed without confirming the expected active commit.'
}
Write-Host "Pi deployment healthy at $($activeCommit.Substring(0, 12))."
