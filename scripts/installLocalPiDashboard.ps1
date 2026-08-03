[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$starter = Join-Path $PSScriptRoot 'startLocalPiDashboard.ps1'

Set-Location -LiteralPath $repository
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "Dashboard build failed with exit code $LASTEXITCODE." }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$starter`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName 'Trading Keys Pi Dashboard' -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the local Trading Keys chart renderer and secure Pi data tunnel.' -Force | Out-Null
Start-ScheduledTask -TaskName 'Trading Keys Pi Dashboard'

Write-Host 'Trading Keys Pi Dashboard is installed and starting at http://localhost:4000/pi-zones'
