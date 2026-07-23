param(
    [ValidateSet("full", "incremental")]
    [string]$Mode = "incremental",
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "",
    [string]$ContainerEnv = "cae-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/api",
    [string]$ImageTag = "latest",
    [string]$IdentityName = "id-ww-player-cache-dev",
    [string]$KeyVaultName = "kv-wwcache-e9219db7",
    [string]$NotionKeyVaultSecretName = "NOTION-READ-ONLY-TOKEN",
    [string]$NotionContainerSecretName = "notion-token",
    [string]$NotionLibraryRootPageId = $env:NOTION_LIBRARY_ROOT_PAGE_ID,
    [string]$NotionLibraryDatabaseId = $env:NOTION_LIBRARY_DATABASE_ID,
    [string]$NotionLibraryDataSourceId = $env:NOTION_LIBRARY_DATA_SOURCE_ID,
    [string]$NotionMediaAssetsDatabaseId = $env:NOTION_MEDIA_ASSETS_DATABASE_ID,
    [string]$NotionMediaAssetsDataSourceId = $env:NOTION_MEDIA_ASSETS_DATA_SOURCE_ID,
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$BlobContainer = "cached-videos",
    [string]$SearchIndexTable = "movieindex",
    [string]$TspdtBrowseTable = "tspdtbrowse",
    [string]$CronExpression = "*/30 * * * *",
    [int]$DelayMs = -1,
    [int]$PageSize = 25,
    [int]$Limit = 0,
    [int]$NotionRequestTimeoutMs = 120000,
    [int]$NotionScanPageParseTimeoutMs = 120000,
    [int]$NotionScanPageParseRetries = 3,
    [int]$NotionScanPageParseRetryDelayMs = 60000,
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

$DefaultNotionLibraryDatabaseId = "f47ef878-8acb-4e12-b604-011e95fb1738"
$DefaultNotionMediaAssetsDatabaseId = "9bacb469-eff7-4c92-80bd-8db16838f2e2"

if (-not (Get-Command $AzCli -ErrorAction SilentlyContinue)) {
    throw "Azure CLI command was not found on PATH: $AzCli"
}
function Get-DotEnvValue {
    param(
        [string[]]$Names
    )

    $envPath = Join-Path (Get-Location) ".env"
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

if (-not $JobName) {
    $JobName = if ($Mode -eq "full") { "job-ww-meta-index-full" } else { "job-ww-meta-index-incremental" }
}

if ($DelayMs -lt 0) {
    $DelayMs = if ($Mode -eq "full") { 2500 } else { 500 }
}

if (-not $NotionLibraryRootPageId -and $env:PAGE_ID) {
    $NotionLibraryRootPageId = $env:PAGE_ID
}

if (-not $NotionLibraryRootPageId) {
    $NotionLibraryRootPageId = Get-DotEnvValue -Names @("NOTION_LIBRARY_ROOT_PAGE_ID", "PAGE_ID")
}

if (-not $NotionLibraryDatabaseId) {
    $NotionLibraryDatabaseId = Get-DotEnvValue -Names @("NOTION_LIBRARY_DATABASE_ID", "NOTION_MEDIA_DATABASE_ID")
}

if (-not $NotionLibraryDataSourceId) {
    $NotionLibraryDataSourceId = Get-DotEnvValue -Names @("NOTION_LIBRARY_DATA_SOURCE_ID", "NOTION_DATA_SOURCE_ID")
}

if (-not $NotionMediaAssetsDatabaseId) {
    $NotionMediaAssetsDatabaseId = Get-DotEnvValue -Names @("NOTION_MEDIA_ASSETS_DATABASE_ID")
}

if (-not $NotionMediaAssetsDataSourceId) {
    $NotionMediaAssetsDataSourceId = Get-DotEnvValue -Names @("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID")
}

if (-not $NotionLibraryDatabaseId -and -not $NotionLibraryDataSourceId) {
    $NotionLibraryDatabaseId = $DefaultNotionLibraryDatabaseId
}

if (-not $NotionMediaAssetsDatabaseId -and -not $NotionMediaAssetsDataSourceId) {
    $NotionMediaAssetsDatabaseId = $DefaultNotionMediaAssetsDatabaseId
}

$loginServer = & $AzCli acr show `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

$identity = & $AzCli identity show `
    --name $IdentityName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$notionSecretId = & $AzCli keyvault secret show `
    --vault-name $KeyVaultName `
    --name $NotionKeyVaultSecretName `
    --query id `
    --output tsv

if (-not $notionSecretId) {
    throw "Notion Key Vault secret was not found: $NotionKeyVaultSecretName"
}

$notionSecretUri = $notionSecretId -replace "/[0-9a-fA-F]{32}$", ""
$image = "$loginServer/$ImageName`:$ImageTag"
$triggerType = if ($Mode -eq "full") { "Manual" } else { "Schedule" }

$envVars = @(
    "CACHE_BACKEND=azure",
    "WWPDW_SEARCH_SOURCE=auto",
    "META_SYNC_MODE=$Mode",
    "SEARCH_INDEX_ENABLED=true",
    "SEARCH_INDEX_SYNC_LIMIT=$Limit",
    "SEARCH_INDEX_SYNC_DELAY_MS=$DelayMs",
    "SEARCH_INDEX_SYNC_PAGE_SIZE=$PageSize",
    "SEARCH_INDEX_SYNC_PROGRESS_EVERY=10",
    "SEARCH_INDEX_INCREMENTAL_OVERLAP_MINUTES=10",
    "SEARCH_INDEX_INCREMENTAL_BOOTSTRAP_LIMIT=200",
    "SEARCH_INDEX_FULL_DELETE_MISSING=true",
    "TSPDT_BROWSE_SYNC_ENABLED=true",
    "TSPDT_BROWSE_SYNC_LIMIT=100000",
    "POSTER_CACHE_ENABLED=true",
    "POSTER_CACHE_MAX_BYTES=8388608",
    "POSTER_CACHE_MAX_PER_MOVIE=0",
    "NOTION_REQUEST_TIMEOUT_MS=$NotionRequestTimeoutMs",
    "NOTION_SCAN_PAGE_PARSE_TIMEOUT_MS=$NotionScanPageParseTimeoutMs",
    "NOTION_SCAN_PAGE_PARSE_RETRIES=$NotionScanPageParseRetries",
    "NOTION_SCAN_PAGE_PARSE_RETRY_DELAY_MS=$NotionScanPageParseRetryDelayMs",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_SEARCH_INDEX_TABLE=$SearchIndexTable",
    "AZURE_STORAGE_TSPDT_BROWSE_TABLE=$TspdtBrowseTable",
    "AZURE_STORAGE_POSTER_SAS_MINUTES=1440",
    "NOTION_READ_ONLY_TOKEN=secretref:$NotionContainerSecretName"
)

if ($NotionLibraryRootPageId) {
    $envVars += "NOTION_LIBRARY_ROOT_PAGE_ID=$NotionLibraryRootPageId"
}

if ($NotionLibraryDatabaseId) {
    $envVars += "NOTION_LIBRARY_DATABASE_ID=$NotionLibraryDatabaseId"
}

if ($NotionLibraryDataSourceId) {
    $envVars += "NOTION_LIBRARY_DATA_SOURCE_ID=$NotionLibraryDataSourceId"
}

if ($NotionMediaAssetsDatabaseId) {
    $envVars += "NOTION_MEDIA_ASSETS_DATABASE_ID=$NotionMediaAssetsDatabaseId"
}

if ($NotionMediaAssetsDataSourceId) {
    $envVars += "NOTION_MEDIA_ASSETS_DATA_SOURCE_ID=$NotionMediaAssetsDataSourceId"
}

$exists = $false
& $AzCli containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    $exists = $true
}

if (-not $exists) {
    Write-Host "Creating metadata sync Container Apps Job: $JobName ($Mode)"
    $createArgs = @(
        "containerapp", "job", "create",
        "--name", $JobName,
        "--resource-group", $ResourceGroup,
        "--environment", $ContainerEnv,
        "--trigger-type", $triggerType,
        "--replica-timeout", "14400",
        "--replica-retry-limit", "1",
        "--replica-completion-count", "1",
        "--parallelism", "1",
        "--image", $image,
        "--registry-server", $loginServer,
        "--registry-identity", $identity.id,
        "--mi-user-assigned", $identity.id,
        "--cpu", "0.5",
        "--memory", "1.0Gi",
        "--command", "node",
        "--args", "node_modules/tsx/dist/cli.mjs", "apps/api/src/meta-sync.ts",
        "--secrets", "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)",
        "--env-vars"
    ) + $envVars + @(
        "--tags", "project=ww-player-cache", "env=dev", "managedBy=infra-script", "component=metadata-index",
        "--output", "none"
    )

    if ($Mode -eq "incremental") {
        $createArgs += @("--cron-expression", $CronExpression)
    }

    & $AzCli @createArgs
} else {
    Write-Host "Updating metadata sync Container Apps Job: $JobName ($Mode)"
    & $AzCli containerapp job secret set `
        --name $JobName `
        --resource-group $ResourceGroup `
        --secrets "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)" `
        --output none

    $updateArgs = @(
        "containerapp", "job", "update",
        "--name", $JobName,
        "--resource-group", $ResourceGroup,
        "--image", $image,
        "--cpu", "0.5",
        "--memory", "1.0Gi",
        "--replica-timeout", "14400",
        "--replica-retry-limit", "1",
        "--command", "node",
        "--args", "node_modules/tsx/dist/cli.mjs", "apps/api/src/meta-sync.ts",
        "--replace-env-vars"
    ) + $envVars + @("--output", "none")

    if ($Mode -eq "incremental") {
        $updateArgs += @("--cron-expression", $CronExpression)
    }

    & $AzCli @updateArgs
}

if ($LASTEXITCODE -ne 0) {
    throw "Metadata sync job deployment failed."
}

& $AzCli containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,cronExpression:properties.configuration.scheduleTriggerConfig.cronExpression,image:properties.template.containers[0].image,mode:properties.template.containers[0].env[?name=='META_SYNC_MODE'].value | [0]}" `
    --output json
