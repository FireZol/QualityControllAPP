param([Parameter(Mandatory = $true)][string]$Root)
# Registers a Scheduled Task (no third-party service wrapper, ADR-013):
# at system start-up, run whether a user is logged on or not, restart on failure.
$ErrorActionPreference = 'Stop'
$Root = $Root.TrimEnd('\')
$node = Join-Path $Root 'node\node.exe'
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null

$runner = Join-Path $Root 'run-server.bat'
$argument = '/c ""' + $runner + '""'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argument -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'ROMCAB-CTC' -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'ROMCAB CTC - control calitate' -Force | Out-Null
Write-Host 'Sarcina ROMCAB-CTC a fost inregistrata.'
