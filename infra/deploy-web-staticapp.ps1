param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$StaticAppName = "stapp-ww-player-dev",
    [string]$Location = "eastasia",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$ApiBaseUrl = "",
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$HomeCacheContainer = "web-cache",
    [string]$MemberTable = "membercodes",
    [string]$KeyVaultName = "kv-wwcache-e9219db7",
    [string]$AdminKeyVaultSecretName = "WWPDW-ADMIN-KEY",
    [string]$AdminKey = $env:WWPDW_ADMIN_KEY,
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command $AzCli -ErrorAction SilentlyContinue)) {
    throw "Azure CLI command was not found on PATH: $AzCli"
}
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Get-DotEnvValue {
    param(
        [string[]]$Names
    )

    $envPath = Join-Path $repoRoot ".env"
    if (-not (Test-Path $envPath)) {
        return $null
    }

    foreach ($line in Get-Content $envPath) {
        if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$") {
            continue
        }

        $name = $matches[1]
        if ($Names -notcontains $name) {
            continue
        }

        return $matches[2].Trim().Trim('"').Trim("'")
    }

    return $null
}

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

if (-not $AdminKey) {
    $AdminKey = Get-DotEnvValue -Names @("WWPDW_ADMIN_KEY")
}

$existingAppName = & $AzCli staticwebapp list `
    --resource-group $ResourceGroup `
    --query "[?name=='$StaticAppName'].name | [0]" `
    --output tsv

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
} else {
    Write-Host "Static Web App already exists: $StaticAppName"
}

$storageConnectionString = & $AzCli storage account show-connection-string `
    --name $StorageAccount `
    --resource-group $ResourceGroup `
    --query connectionString `
    --output tsv

if (-not $storageConnectionString) {
    throw "Could not read storage connection string for $StorageAccount."
}

& $AzCli storage container create `
    --name $HomeCacheContainer `
    --connection-string $storageConnectionString `
    --public-access off `
    --output none

$appSettings = @(
    "WWPDW_ORIGIN_API_BASE_URL=$ApiBaseUrl",
    "WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING=$storageConnectionString",
    "WWPDW_HOME_CACHE_CONTAINER=$HomeCacheContainer",
    "AZURE_STORAGE_MEMBER_TABLE=$MemberTable",
    "WWPDW_HOME_BROWSE_FRESH_SECONDS=600",
    "WWPDW_HOME_BROWSE_STALE_SECONDS=604800",
    "WWPDW_HOME_BROWSE_ORIGIN_TIMEOUT_MS=25000",
    "WWPDW_HOME_BROWSE_STALE_REFRESH_TIMEOUT_MS=1800"
)

if (-not $AdminKey) {
    $AdminKey = & $AzCli keyvault secret show `
        --vault-name $KeyVaultName `
        --name $AdminKeyVaultSecretName `
        --query value `
        --output tsv 2>$null
}

if ($AdminKey) {
    $appSettings += "WWPDW_ADMIN_KEY=$AdminKey"
} else {
    Write-Host "WWPDW admin key was not found; Static Web App home-browse Function will validate member passes only."
}

& $AzCli staticwebapp appsettings set `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --setting-names $appSettings `
    --output none

$previousApiBaseUrl = $env:VITE_API_BASE_URL

try {
    $env:VITE_API_BASE_URL = $ApiBaseUrl

    Push-Location $repoRoot
    try {
        npm run build --workspace @wwpdw/web
        $builtIndexPath = Join-Path $repoRoot "apps\web\dist\index.html"
        $builtIndex = Get-Content $builtIndexPath -Raw
        $builtScriptMatch = [regex]::Match($builtIndex, "/assets/[^`"']+\.js")
        if (-not $builtScriptMatch.Success) {
            throw "Could not find built web JavaScript asset in $builtIndexPath."
        }

        $builtScriptPath = Join-Path (Join-Path $repoRoot "apps\web\dist") ($builtScriptMatch.Value.TrimStart("/") -replace "/", "\")
        $builtScript = Get-Content $builtScriptPath -Raw
        if (-not $builtScript.Contains($ApiBaseUrl)) {
            throw "Built web asset does not contain API base URL $ApiBaseUrl."
        }
    } finally {
        Pop-Location
    }
} finally {
    $env:VITE_API_BASE_URL = $previousApiBaseUrl
}

$deploymentToken = & $AzCli staticwebapp secrets list `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "properties.apiKey" `
    --output tsv

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

$hostName = & $AzCli staticwebapp show `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "defaultHostname" `
    --output tsv

[pscustomobject]@{
    name = $StaticAppName
    url = "https://$hostName"
    apiBaseUrl = $ApiBaseUrl
    apiLocation = Join-Path $repoRoot "api"
    homeCacheContainer = $HomeCacheContainer
} | ConvertTo-Json
