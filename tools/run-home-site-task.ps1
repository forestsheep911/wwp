param()

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $repositoryRoot ".local-data"
$stdoutPath = Join-Path $logDirectory "home-site.stdout.log"
$stderrPath = Join-Path $logDirectory "home-site.stderr.log"
$maximumLogBytes = 20MB

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

foreach ($logPath in @($stdoutPath, $stderrPath)) {
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -ge $maximumLogBytes) {
    $archivePath = "$logPath.1"
    if (Test-Path -LiteralPath $archivePath) {
      Remove-Item -LiteralPath $archivePath -Force
    }
    Move-Item -LiteralPath $logPath -Destination $archivePath
  }
}

$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Set-Location -LiteralPath $repositoryRoot

& $nodePath --import tsx tools/start-home-site.mjs 1>> $stdoutPath 2>> $stderrPath
exit $LASTEXITCODE
