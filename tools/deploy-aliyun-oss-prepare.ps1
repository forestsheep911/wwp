$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $repoRoot ".env"
$templatePath = Join-Path $repoRoot "infra\aliyun-oss-prepare\s.yaml"
$aliasName = "wwpdw-fc-deploy"

function Read-LastNonEmptyEnvValue([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value) { return $value.Trim() }
  if (-not (Test-Path -LiteralPath $envPath)) { return $null }
  $match = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=\s*(.+?)\s*$" } |
    Select-Object -Last 1
  if (-not $match) { return $null }
  return (($match -split "=", 2)[1].Trim() -replace '^([''"])(.*)\1$', '$2')
}

$accessKeyId = Read-LastNonEmptyEnvValue "ALIBABA_CLOUD_ACCESS_KEY_ID"
$accessKeySecret = Read-LastNonEmptyEnvValue "ALIBABA_CLOUD_ACCESS_KEY_SECRET"
if (-not $accessKeyId -or -not $accessKeySecret) {
  throw "Alibaba Cloud access key is missing from the process environment or .env."
}

Push-Location $repoRoot
try {
  node tools/provision-aliyun-fc-role.mjs
  if ($LASTEXITCODE -ne 0) { throw "RAM role provisioning failed with exit code $LASTEXITCODE." }
  npx -y @serverless-devs/s config add `
    --AccessKeyID $accessKeyId `
    --AccessKeySecret $accessKeySecret `
    --AccountID "1812145568680204" `
    --access $aliasName `
    --force `
    --silent
  if ($LASTEXITCODE -ne 0) { throw "Serverless Devs credential setup failed with exit code $LASTEXITCODE." }
  npx -y @serverless-devs/s deploy `
    --template $templatePath `
    --access $aliasName `
    --assume-yes
  if ($LASTEXITCODE -ne 0) { throw "FC3 deployment failed with exit code $LASTEXITCODE." }
} finally {
  npx -y @serverless-devs/s config delete --access $aliasName --silent 2>$null
  Pop-Location
}
