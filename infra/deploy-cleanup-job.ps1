param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "job-ww-cache-cleanup",
    [string]$ContainerEnv = "cae-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/worker",
    [string]$ImageTag = "latest",
    [string]$IdentityName = "id-ww-player-cache-dev",
    [string]$CronExpression = "0 19 * * *",
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$BlobContainer = "cached-videos",
    [string]$QueueName = "cache-jobs",
    [string]$AssetTable = "cacheindex",
    [string]$JobTable = "cachejobs",
    [int]$CacheAssetIdleTtlDays = 7,
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command $AzCli -ErrorAction SilentlyContinue)) {
    throw "Azure CLI command was not found on PATH: $AzCli"
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

$image = "$loginServer/$ImageName`:$ImageTag"
$envVars = @(
    "CACHE_BACKEND=azure",
    "WORKER_MODE=cleanup",
    "CACHE_ASSET_IDLE_TTL_DAYS=$CacheAssetIdleTtlDays",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_QUEUE_NAME=$QueueName",
    "AZURE_STORAGE_ASSET_TABLE=$AssetTable",
    "AZURE_STORAGE_JOB_TABLE=$JobTable",
    "AZURE_STORAGE_PLAYBACK_SAS_MINUTES=720"
)

$exists = $false
& $AzCli containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --output none 2>$null
if ($LASTEXITCODE -eq 0) {
    $exists = $true
}

if (-not $exists) {
    Write-Host "Creating cleanup Container Apps Job: $JobName"
    & $AzCli containerapp job create `
        --name $JobName `
        --resource-group $ResourceGroup `
        --environment $ContainerEnv `
        --trigger-type Schedule `
        --cron-expression $CronExpression `
        --replica-timeout 900 `
        --replica-retry-limit 1 `
        --replica-completion-count 1 `
        --parallelism 1 `
        --image $image `
        --registry-server $loginServer `
        --registry-identity $identity.id `
        --mi-user-assigned $identity.id `
        --cpu 0.5 `
        --memory 1.0Gi `
        --env-vars $envVars `
        --tags project=ww-player-cache env=dev managedBy=infra-script component=cleanup `
        --output none
} else {
    Write-Host "Updating cleanup Container Apps Job: $JobName"
    & $AzCli containerapp job update `
        --name $JobName `
        --resource-group $ResourceGroup `
        --cron-expression $CronExpression `
        --image $image `
        --cpu 0.5 `
        --memory 1.0Gi `
        --replica-timeout 900 `
        --replica-retry-limit 1 `
        --replace-env-vars $envVars `
        --output none
}

if ($LASTEXITCODE -ne 0) {
    throw "Cleanup Container Apps Job deployment failed."
}

& $AzCli containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,cronExpression:properties.configuration.scheduleTriggerConfig.cronExpression,image:properties.template.containers[0].image,identityType:identity.type}" `
    --output json
