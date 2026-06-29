param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$ContainerEnv = "cae-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/api",
    [string]$ImageTag = "latest",
    [string]$IdentityName = "id-ww-player-cache-dev",
    [string]$WorkerJobName = "job-ww-cache-worker",
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$BlobContainer = "cached-videos",
    [string]$QueueName = "cache-jobs",
    [string]$AssetTable = "cacheindex",
    [string]$JobTable = "cachejobs"
)

$ErrorActionPreference = "Stop"

$subscriptionId = az2 account show --query id --output tsv
$loginServer = az2 acr show `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

$identity = az2 identity show `
    --name $IdentityName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$workerJob = az2 containerapp job show `
    --name $WorkerJobName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$assignment = az2 role assignment list `
    --assignee $identity.principalId `
    --role "Contributor" `
    --scope $workerJob.id `
    --query "[0].id" `
    --output tsv

if (-not $assignment) {
    Write-Host "Granting API identity permission to start worker job."
    az2 role assignment create `
        --assignee-object-id $identity.principalId `
        --assignee-principal-type ServicePrincipal `
        --role "Contributor" `
        --scope $workerJob.id `
        --output none
}

$image = "$loginServer/$ImageName`:$ImageTag"
$envVars = @(
    "API_PORT=8787",
    "CACHE_BACKEND=azure",
    "WWPDW_SEARCH_SOURCE=auto",
    "NOTION_SEARCH_PAGE_SIZE=8",
    "NOTION_PARSE_MAX_PAGES=6",
    "NOTION_PARSE_BLOCK_DEPTH=2",
    "NOTION_PARSE_BLOCK_LIMIT=120",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_QUEUE_NAME=$QueueName",
    "AZURE_STORAGE_ASSET_TABLE=$AssetTable",
    "AZURE_STORAGE_JOB_TABLE=$JobTable",
    "AZURE_STORAGE_PLAYBACK_SAS_MINUTES=60",
    "AZURE_SUBSCRIPTION_ID=$subscriptionId",
    "AZURE_RESOURCE_GROUP=$ResourceGroup",
    "AZURE_CONTAINER_APP_JOB_NAME=$WorkerJobName",
    "AZURE_CONTAINER_APP_JOB_API_VERSION=2024-03-01"
)

$existingAppName = az2 containerapp list `
    --resource-group $ResourceGroup `
    --query "[?name=='$ApiAppName'].name | [0]" `
    --output tsv

$exists = [bool]$existingAppName

if (-not $exists) {
    Write-Host "Creating API Container App: $ApiAppName"
    az2 containerapp create `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --environment $ContainerEnv `
        --image $image `
        --registry-server $loginServer `
        --registry-identity $identity.id `
        --user-assigned $identity.id `
        --ingress external `
        --target-port 8787 `
        --min-replicas 0 `
        --max-replicas 2 `
        --cpu 0.5 `
        --memory 1.0Gi `
        --env-vars $envVars `
        --tags project=ww-player-cache env=dev managedBy=infra-script component=api `
        --output none
} else {
    Write-Host "Updating API Container App: $ApiAppName"
    az2 containerapp identity assign `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --user-assigned $identity.id `
        --output none

    az2 containerapp registry set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --server $loginServer `
        --identity $identity.id `
        --output none

    az2 containerapp update `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --image $image `
        --cpu 0.5 `
        --memory 1.0Gi `
        --min-replicas 0 `
        --max-replicas 2 `
        --replace-env-vars $envVars `
        --output none
}

if ($LASTEXITCODE -ne 0) {
    throw "API Container App deployment failed."
}

az2 containerapp show `
    --name $ApiAppName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn,image:properties.template.containers[0].image,identityType:identity.type}" `
    --output json
