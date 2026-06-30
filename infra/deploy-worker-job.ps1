param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "job-ww-cache-worker",
    [string]$ContainerEnv = "cae-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/worker",
    [string]$ImageTag = "latest",
    [string]$IdentityName = "id-ww-player-cache-dev",
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$BlobContainer = "cached-videos",
    [string]$QueueName = "cache-jobs",
    [string]$AssetTable = "cacheindex",
    [string]$JobTable = "cachejobs"
)

$ErrorActionPreference = "Stop"

$loginServer = az2 acr show `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

$identity = az2 identity show `
    --name $IdentityName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$image = "$loginServer/$ImageName`:$ImageTag"
$envVars = @(
    "CACHE_BACKEND=azure",
    "WORKER_MODE=oneshot",
    "WORKER_POLL_MS=900",
    "WORKER_MAX_CONCURRENT=1",
    "WORKER_ONESHOT_MAX_TICKS=30",
    "CACHE_ASSET_TTL_DAYS=30",
    "CACHE_ASSET_IDLE_TTL_DAYS=7",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_QUEUE_NAME=$QueueName",
    "AZURE_STORAGE_ASSET_TABLE=$AssetTable",
    "AZURE_STORAGE_JOB_TABLE=$JobTable",
    "AZURE_STORAGE_PLAYBACK_SAS_MINUTES=60"
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
    Write-Host "Creating Container Apps Job: $JobName"
    az2 containerapp job create `
        --name $JobName `
        --resource-group $ResourceGroup `
        --environment $ContainerEnv `
        --trigger-type Manual `
        --replica-timeout 3600 `
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
        --tags project=ww-player-cache env=dev managedBy=infra-script `
        --output none
} else {
    Write-Host "Updating Container Apps Job: $JobName"
    az2 containerapp job update `
        --name $JobName `
        --resource-group $ResourceGroup `
        --image $image `
        --cpu 0.5 `
        --memory 1.0Gi `
        --replica-timeout 3600 `
        --replica-retry-limit 1 `
        --replace-env-vars $envVars `
        --output none
}

if ($LASTEXITCODE -ne 0) {
    throw "Container Apps Job deployment failed."
}

az2 containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,image:properties.template.containers[0].image,identityType:identity.type}" `
    --output json
