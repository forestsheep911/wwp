$ErrorActionPreference = 'Stop'
$srcDir = 'F:\in\成长的烦恼.Growing.Pains\Season1'
$tmp = '.local-data\growing-pains-s01-zh-work'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
New-Item -ItemType Directory -Force -Path 'E:\video_made' | Out-Null

$files = Get-ChildItem -LiteralPath $srcDir -File -Filter '*.mkv' |
  Where-Object { $_.Name -match 'S01E(\d{2})' } |
  Sort-Object Name

foreach ($file in $files) {
  $episodeMatch = [regex]::Match($file.Name, 'S01E(\d{2})')
  if (-not $episodeMatch.Success) { throw "episode number missing: $($file.Name)" }
  $episode = [int]$episodeMatch.Groups[1].Value
  $stem = 'growing.pains.1985.s01e{0:D2}.480p.h265.english.zh' -f $episode
  $allSubtitles = Join-Path $tmp ($stem + '.all.srt')
  $chineseSubtitles = Join-Path $tmp ($stem + '.srt')
  $output = Join-Path 'E:\video_made' ($stem + '.mp4')
  if (Test-Path -LiteralPath $output) {
    Write-Output ('replace incomplete local output E{0:D2}' -f $episode)
    Remove-Item -LiteralPath $output -Force
  }

  Write-Output ('encode E{0:D2}' -f $episode)
  & ffmpeg -y -loglevel error -i $file.FullName -map 0:3 -c:s srt $allSubtitles
  if ($LASTEXITCODE -ne 0) { throw "subtitle extract failed E$episode" }
  & node tools/filter-chinese-srt.mjs --input $allSubtitles --output $chineseSubtitles
  if ($LASTEXITCODE -ne 0) { throw "subtitle filter failed E$episode" }
  & node .codex/plugins/wwp-film-workflow/scripts/transcode-hevc-mp4.mjs `
    --input $file.FullName --output $output --subtitle-file $chineseSubtitles `
    --audio-stream 1 --cq 26 --max-bytes 5000000000
  if ($LASTEXITCODE -ne 0) { throw "encode failed E$episode" }
  Remove-Item -LiteralPath $allSubtitles, $chineseSubtitles -Force -ErrorAction SilentlyContinue
}
