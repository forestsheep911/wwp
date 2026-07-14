param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$StaticAppName = "stapp-ww-player-dev",
    [string]$Location = "eastasia",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$ApiBaseUrl = "",
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command $AzCli -ErrorAction SilentlyContinue)) {
    throw "Azure CLI command was not found on PATH: $AzCli"
}
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $ApiBaseUrl) {
    $apiFqdn = & $AzCli containerapp show `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --query "properties.configuration.ingress.fqdn" `
        --output tsv

    if (-not $apiFqdn) {
        throw "Could not find API Container App FQDN."
    }

    $ApiBaseUrl = "https://$apiFqdn"
}

$existingAppName = & $AzCli staticwebapp list `
    --resource-group $ResourceGroup `
    --query "[?name=='$StaticAppName'].name | [0]" `
    --output tsv

if ($LASTEXITCODE -ne 0) {
    throw "Could not list Static Web Apps."
}

$exists = [bool]$existingAppName

if (-not $exists) {
    Write-Host "Creating Static Web App: $StaticAppName"
    & $AzCli staticwebapp create `
        --name $StaticAppName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Free `
        --tags project=ww-player-cache env=dev managedBy=infra-script component=web `
        --output none

    if ($LASTEXITCODE -ne 0) {
        throw "Could not create Static Web App."
    }
} else {
    Write-Host "Static Web App already exists: $StaticAppName"
}

$hostName = & $AzCli staticwebapp show `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "defaultHostname" `
    --output tsv

if (-not $hostName) {
    throw "Could not find Static Web App hostname."
}

$publicWebOrigin = "https://$hostName"
$appSettings = @(
    "WWPDW_ORIGIN_API_BASE_URL=$ApiBaseUrl",
    "WWPDW_PUBLIC_WEB_ORIGIN=$publicWebOrigin",
    "WWPDW_BFF_TIMEOUT_MS=90000"
)
$legacySettingNames = @(
    "WWPDW_ADMIN_KEY",
    "AZURE_STORAGE_MEMBER_TABLE",
    "WWPDW_HOME_BROWSE_FRESH_SECONDS",
    "WWPDW_HOME_BROWSE_ORIGIN_TIMEOUT_MS",
    "WWPDW_HOME_BROWSE_STALE_REFRESH_TIMEOUT_MS",
    "WWPDW_HOME_BROWSE_STALE_SECONDS",
    "WWPDW_HOME_CACHE_CONTAINER",
    "WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING"
)

$previousApiBaseUrl = $env:VITE_API_BASE_URL

try {
    $env:VITE_API_BASE_URL = ""

    Push-Location $repoRoot
    try {
        npm run build --workspace @wwpdw/web
        if ($LASTEXITCODE -ne 0) {
            throw "Web build failed."
        }

        $builtDistPath = Join-Path $repoRoot "apps\web\dist"
        $builtScriptFiles = @(Get-ChildItem -LiteralPath $builtDistPath -Filter "*.js" -File -Recurse)
        if ($builtScriptFiles.Count -eq 0) {
            throw "Could not find built web JavaScript assets in $builtDistPath."
        }

        $foundSameOriginLoginRoute = $false
        foreach ($builtScriptFile in $builtScriptFiles) {
            $builtScript = Get-Content -LiteralPath $builtScriptFile.FullName -Raw
            if ($builtScript.Contains($ApiBaseUrl)) {
                throw "Built web asset still contains cross-site API base URL $ApiBaseUrl`: $($builtScriptFile.FullName)."
            }
            if ($builtScript.Contains("/api/auth/login")) {
                $foundSameOriginLoginRoute = $true
            }
        }

        if (-not $foundSameOriginLoginRoute) {
            throw "Built web asset does not contain the same-origin login route."
        }
    } finally {
        Pop-Location
    }
} finally {
    $env:VITE_API_BASE_URL = $previousApiBaseUrl
}

& $AzCli staticwebapp appsettings set `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --setting-names $appSettings `
    --output none

if ($LASTEXITCODE -ne 0) {
    throw "Could not configure Static Web App BFF settings."
}

$deploymentToken = & $AzCli staticwebapp secrets list `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" `
    --output tsv

if ($LASTEXITCODE -ne 0) {
    throw "Could not read Static Web App deployment token."
}

if (-not $deploymentToken) {
    throw "Could not read Static Web App deployment token."
}

npx -y @azure/static-web-apps-cli deploy `
    (Join-Path $repoRoot "apps\web\dist") `
    --api-location (Join-Path $repoRoot "api") `
    --api-language node `
    --api-version 20 `
    --deployment-token $deploymentToken `
    --env production

if ($LASTEXITCODE -ne 0) {
    throw "Static Web App deployment failed."
}

$existingSettingsJson = & $AzCli staticwebapp appsettings list `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --output json
if ($LASTEXITCODE -ne 0) {
    throw "Could not read Static Web App settings."
}

$existingSettings = ($existingSettingsJson | ConvertFrom-Json).properties
$settingsToDelete = @($legacySettingNames | Where-Object { $existingSettings.PSObject.Properties.Name -contains $_ })
if ($settingsToDelete.Count -gt 0) {
    & $AzCli staticwebapp appsettings delete `
        --name $StaticAppName `
        --resource-group $ResourceGroup `
        --setting-names $settingsToDelete `
        --output none

    if ($LASTEXITCODE -ne 0) {
        throw "Could not delete legacy Static Web App settings."
    }
}

[pscustomobject]@{
    name = $StaticAppName
    url = $publicWebOrigin
    apiBaseUrl = $ApiBaseUrl
    apiLocation = Join-Path $repoRoot "api"
} | ConvertTo-Json
