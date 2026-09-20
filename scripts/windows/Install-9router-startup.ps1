$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$dataDir = Join-Path $env:APPDATA '9router'
$startupFile = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\9router.vbs'
$trayScript = Join-Path $repoRoot 'cli\src\cli\tray\trayOnly.js'
$serviceScript = Join-Path $PSScriptRoot 'Start-9router-service.ps1'
$node = 'C:\Program Files\nodejs\node.exe'
$taskName = '9router-service'
$port = 20128

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this installer in an elevated PowerShell window'
}
foreach ($file in @($trayScript, $serviceScript, $node)) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file not found: $file" }
}
if (-not (Test-Path -LiteralPath $dataDir -PathType Container)) { throw "9Router data directory not found: $dataDir" }

$runtimeDir = Join-Path $dataDir 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$backup = Join-Path $runtimeDir ('9router-startup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.vbs')
if (Test-Path -LiteralPath $startupFile) { Copy-Item -LiteralPath $startupFile -Destination $backup -ErrorAction Stop }

$argument = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -DataDir "{1}" -Port {2}' -f $serviceScript, $dataDir, $port
$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument $argument -WorkingDirectory (Join-Path $repoRoot 'cli\app')
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

$oldServerStopped = $false
try {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $serverPath = Join-Path $repoRoot 'cli\app\custom-server.js'
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (-not $process -or $process.CommandLine -notlike "*$serverPath*") {
      throw "Port $port belongs to another process. Existing process was not stopped."
    }
    Stop-Process -Id $listener.OwningProcess -ErrorAction Stop
    $oldServerStopped = $true
    for ($i = 0; $i -lt 30 -and (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue); $i++) {
      Start-Sleep -Milliseconds 500
    }
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is still occupied" }
  }

  Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
  $healthy = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch [System.Net.WebException] {
      # Wait for the server to finish booting.
    }
  }
  if (-not $healthy) { throw '9Router did not become healthy after the scheduled task started' }
} catch {
  $failure = $_
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  if ($oldServerStopped -and $backup -and (Test-Path -LiteralPath $backup)) {
    Start-Process -FilePath 'C:\Windows\System32\wscript.exe' -ArgumentList ('"' + $backup + '"') -WindowStyle Hidden
  }
  throw $failure
}

$startup = @'
Set WshShell = CreateObject("WScript.Shell")
Set ProcessEnv = WshShell.Environment("Process")
ProcessEnv("PORT") = "20128"
WshShell.CurrentDirectory = "__REPO__"
WshShell.Run """__NODE__"" ""__TRAY__""", 0, False
'@
$startup = $startup.Replace('__REPO__', $repoRoot).Replace('__NODE__', $node).Replace('__TRAY__', $trayScript)
Set-Content -LiteralPath $startupFile -Value $startup -Encoding ASCII
Write-Output "9Router service task installed and healthy. Startup script backup: $backup"
