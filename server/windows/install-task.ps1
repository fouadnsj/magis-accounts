# Registers the server as a Windows task: starts at boot (before anyone logs in),
# runs as SYSTEM, never stopped after 3 days, restarted if it fails.
param([string]$Dir)
$action   = New-ScheduledTaskAction -Execute (Join-Path $Dir 'run.cmd') -WorkingDirectory $Dir
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'MAGIS Server' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'MAGIS Server'
