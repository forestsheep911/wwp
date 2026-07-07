param(
  [Alias("Input")]
  [string]$InputPath,
  [string]$Output,
  [int]$Columns = 4,
  [int]$Rows = 3,
  [int]$Width = 320,
  [string]$Ffprobe = "ffprobe",
  [string]$Ffmpeg = "ffmpeg",
  [switch]$Help
)

function Show-Usage {
  @"
Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-qc-contact-sheet.ps1 -InputPath <media> -Output <png> [-Columns 4] [-Rows 3] [-Width 320]

Creates a single PNG contact sheet with evenly spaced frames. Requires ffprobe and ffmpeg.
"@
}

if ($Help) {
  Show-Usage
  exit 0
}

if (-not $InputPath -or -not $Output) {
  Show-Usage
  exit 2
}

$resolvedInput = Resolve-Path -LiteralPath $InputPath -ErrorAction Stop
$durationText = & $Ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $resolvedInput.Path
if ($LASTEXITCODE -ne 0) {
  throw "ffprobe failed for $($resolvedInput.Path)"
}

$duration = [double]::Parse($durationText.Trim(), [Globalization.CultureInfo]::InvariantCulture)
$frameCount = [Math]::Max(1, $Columns * $Rows)
$interval = [Math]::Max(1.0, $duration / $frameCount)
$intervalText = $interval.ToString("0.###", [Globalization.CultureInfo]::InvariantCulture)
$filter = "fps=1/$intervalText,scale=$($Width):-1:flags=lanczos,tile=$($Columns)x$($Rows)"

$resolvedOutput = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Output)
$parent = Split-Path -Parent $resolvedOutput
if ($parent) {
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
}

& $Ffmpeg -hide_banner -loglevel warning -y -i $resolvedInput.Path -vf $filter -frames:v 1 -update 1 $resolvedOutput
if ($LASTEXITCODE -ne 0) {
  throw "ffmpeg failed while creating contact sheet: $resolvedOutput"
}

Write-Output $resolvedOutput
