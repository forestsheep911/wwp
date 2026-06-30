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
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$SearchIndexTable = "movieindex",
    [string]$CronExpression = "0 */6 * * *",
    [int]$DelayMs = -1,
    [int]$PageSize = 25,
    [int]$Limit = 0
)

$ErrorActionPreference = "Stop"

if (-not $JobName) {
    $JobName = if ($Mode -eq "full") { "job-ww-meta-index-full" } else { "job-ww-meta-index-incremental" }
}

if ($DelayMs -lt 0) {
    $DelayMs = if ($Mode -eq "full") { 1500 } else { 500 }
}

$loginServer = az2 acr show `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

$identity = az2 identity show `
    --name $IdentityName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$notionSecretId = az2 keyvault secret show `
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
    "NOTION_REQUEST_TIMEOUT_MS=30000",
    "NOTION_SCAN_PAGE_PARSE_TIMEOUT_MS=60000",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_SEARCH_INDEX_TABLE=$SearchIndexTable",
    "NOTION_READ_ONLY_TOKEN=secretref:$NotionContainerSecretName"
)

$exists = $false
az2 containerapp job show `
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
        "--args", "--import", "tsx", "apps/api/src/meta-sync.ts",
        "--secrets", "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)",
        "--env-vars"
    ) + $envVars + @(
        "--tags", "project=ww-player-cache", "env=dev", "managedBy=infra-script", "component=metadata-index",
        "--output", "none"
    )

    if ($Mode -eq "incremental") {
        $createArgs += @("--cron-expression", $CronExpression)
    }

    az2 @createArgs
} else {
    Write-Host "Updating metadata sync Container Apps Job: $JobName ($Mode)"
    az2 containerapp job secret set `
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
        "--replace-env-vars"
    ) + $envVars + @("--output", "none")

    if ($Mode -eq "incremental") {
        $updateArgs += @("--cron-expression", $CronExpression)
    }

    az2 @updateArgs
}

if ($LASTEXITCODE -ne 0) {
    throw "Metadata sync job deployment failed."
}

az2 containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,cronExpression:properties.configuration.scheduleTriggerConfig.cronExpression,image:properties.template.containers[0].image,mode:properties.template.containers[0].env[?name=='META_SYNC_MODE'].value | [0]}" `
    --output json
