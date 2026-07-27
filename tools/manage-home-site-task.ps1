param(
  [ValidateSet("install", "uninstall", "start", "stop", "status")]
  [string]$Action = "status"
)

$ErrorActionPreference = "Stop"

$taskName = "WWPDW Home Site"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$runnerPath = Join-Path $PSScriptRoot "run-home-site-task.ps1"
$powerShellPath = (Get-Command pwsh.exe -ErrorAction Stop).Source
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Get-HomeSiteTask {
  Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

function Get-HomeSiteListener {
  Get-NetTCPConnection -State Listen -LocalPort 43187 -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Stop-HomeSiteListener {
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if (-not (Get-HomeSiteListener)) {
      return
    }
    Start-Sleep -Milliseconds 250
  }

  $listener = Get-HomeSiteListener
  if (-not $listener) {
    return
  }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  if ($process.CommandLine -notlike "*tools/start-home-site.mjs*") {
    throw "Port 43187 is owned by unexpected PID $($listener.OwningProcess)."
  }
  Stop-Process -Id $listener.OwningProcess -Force
}

function Wait-HomeSiteHealthy {
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:43187/health" -TimeoutSec 2
      if ($health.ok) {
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    }
  }
  throw "WWP home site did not become healthy on port 43187 within 30 seconds."
}

switch ($Action) {
  "install" {
    $taskAction = New-ScheduledTaskAction `
      -Execute $powerShellPath `
      -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runnerPath`"" `
      -WorkingDirectory $repositoryRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal `
      -UserId $currentUser `
      -LogonType Interactive `
      -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -RestartCount 5 `
      -RestartInterval (New-TimeSpan -Minutes 1) `
      -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -MultipleInstances IgnoreNew

    Register-ScheduledTask `
      -TaskName $taskName `
      -Action $taskAction `
      -Trigger $trigger `
      -Principal $principal `
      -Settings $settings `
      -Description "Runs the WWP home site and local media cache worker after this user signs in." `
      -Force | Out-Null
  }
  "uninstall" {
    $task = Get-HomeSiteTask
    if ($task) {
      if ($task.State -eq "Running") {
        Stop-ScheduledTask -TaskName $taskName
      }
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
  }
  "start" {
    if (-not (Get-HomeSiteTask)) {
      throw "Scheduled task '$taskName' is not installed."
    }
    Start-ScheduledTask -TaskName $taskName
    Wait-HomeSiteHealthy
  }
  "stop" {
    if (Get-HomeSiteTask) {
      Stop-ScheduledTask -TaskName $taskName
      Stop-HomeSiteListener
    }
  }
}

$task = Get-HomeSiteTask
if (-not $task) {
  Write-Output ([pscustomobject]@{
    TaskName = $taskName
    Installed = $false
    State = "NotInstalled"
  })
  return
}

$taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
[pscustomobject]@{
  TaskName = $taskName
  Installed = $true
  State = $task.State
  LastRunTime = $taskInfo.LastRunTime
  LastTaskResult = $taskInfo.LastTaskResult
  NextRunTime = $taskInfo.NextRunTime
  User = $currentUser
  Runner = $runnerPath
}
