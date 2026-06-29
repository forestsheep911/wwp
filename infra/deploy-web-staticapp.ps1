param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$StaticAppName = "stapp-ww-player-dev",
    [string]$Location = "eastasia",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$ApiBaseUrl = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $ApiBaseUrl) {
    $apiFqdn = az2 containerapp show `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --query "properties.configuration.ingress.fqdn" `
        --output tsv

    if (-not $apiFqdn) {
        throw "Could not find API Container App FQDN."
    }

    $ApiBaseUrl = "https://$apiFqdn"
}

$existingAppName = az2 staticwebapp list `
    --resource-group $ResourceGroup `
    --query "[?name=='$StaticAppName'].name | [0]" `
    --output tsv

$exists = [bool]$existingAppName

if (-not $exists) {
    Write-Host "Creating Static Web App: $StaticAppName"
    az2 staticwebapp create `
        --name $StaticAppName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Free `
        --tags project=ww-player-cache env=dev managedBy=infra-script component=web `
        --output none
} else {
    Write-Host "Static Web App already exists: $StaticAppName"
}

$previousApiBaseUrl = $env:VITE_API_BASE_URL

try {
    $env:VITE_API_BASE_URL = $ApiBaseUrl

    Push-Location $repoRoot
    try {
        npm run build --workspace @wwpdw/web
    } finally {
        Pop-Location
    }
} finally {
    $env:VITE_API_BASE_URL = $previousApiBaseUrl
}

$deploymentToken = az2 staticwebapp secrets list `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" `
    --output tsv

if (-not $deploymentToken) {
    throw "Could not read Static Web App deployment token."
}

npx -y @azure/static-web-apps-cli deploy `
    (Join-Path $repoRoot "apps\web\dist") `
    --deployment-token $deploymentToken `
    --env production

if ($LASTEXITCODE -ne 0) {
    throw "Static Web App deployment failed."
}

$hostName = az2 staticwebapp show `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "defaultHostname" `
    --output tsv

[pscustomobject]@{
    name = $StaticAppName
    url = "https://$hostName"
    apiBaseUrl = $ApiBaseUrl
} | ConvertTo-Json
