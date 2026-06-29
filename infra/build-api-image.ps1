param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/api",
    [string]$ImageTag = (Get-Date -Format "yyyyMMddHHmmss")
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$image = "$ImageName`:$ImageTag"
$latest = "$ImageName`:latest"

Write-Host "Building API image in ACR: $RegistryName"
Write-Host "Tags: $image, $latest"

az2 acr build `
    --resource-group $ResourceGroup `
    --registry $RegistryName `
    --file Dockerfile.api `
    --image $image `
    --image $latest `
    --platform linux/amd64 `
    $repoRoot

if ($LASTEXITCODE -ne 0) {
    throw "ACR build failed."
}

$loginServer = az2 acr show `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

[pscustomobject]@{
    registry = $RegistryName
    loginServer = $loginServer
    image = "$loginServer/$image"
    latest = "$loginServer/$latest"
} | ConvertTo-Json
