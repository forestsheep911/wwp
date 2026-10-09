$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $repoRoot "infra/cloud-config.ps1")
$templatePath = Join-Path $repoRoot "infra\aliyun-oss-prepare\s.yaml"
$aliasName = "wwpdw-fc-deploy"

$accessKeyId = Get-CloudSecretValue -Name "ALIBABA_CLOUD_ACCESS_KEY_ID"
$accessKeySecret = Get-CloudSecretValue -Name "ALIBABA_CLOUD_ACCESS_KEY_SECRET"
if (-not $accessKeyId -or -not $accessKeySecret) {
  throw "Alibaba Cloud access key is missing from App Configuration / Key Vault."
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
