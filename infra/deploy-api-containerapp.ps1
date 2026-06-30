param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$ContainerEnv = "cae-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/api",
    [string]$ImageTag = "latest",
    [string]$IdentityName = "id-ww-player-cache-dev",
    [string]$WorkerJobName = "job-ww-cache-worker",
    [string]$KeyVaultName = "kv-wwcache-e9219db7",
    [string]$NotionKeyVaultSecretName = "NOTION-READ-ONLY-TOKEN",
    [string]$NotionContainerSecretName = "notion-token",
    [string]$AccessKeyVaultSecretName = "WWPDW-ACCESS-KEY",
    [string]$AccessContainerSecretName = "wwpdw-access-key",
    [string]$AccessKey = $env:WWPDW_ACCESS_KEY,
    [string]$NotionLibraryRootPageId = $env:NOTION_LIBRARY_ROOT_PAGE_ID,
    [string]$NotionLibraryDatabaseId = $env:NOTION_LIBRARY_DATABASE_ID,
    [string]$NotionLibraryDataSourceId = $env:NOTION_LIBRARY_DATA_SOURCE_ID,
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$BlobContainer = "cached-videos",
    [string]$QueueName = "cache-jobs",
    [string]$AssetTable = "cacheindex",
    [string]$JobTable = "cachejobs",
    [string]$MemberTable = "membercodes"
)

$ErrorActionPreference = "Stop"

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

if (-not $AccessKey) {
    $AccessKey = Get-DotEnvValue -Names @("WWPDW_ACCESS_KEY", "VITE_ACCESS_CODE")
}

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
    "SEARCH_RESULT_CACHE_TTL_SECONDS=600",
    "SEARCH_RESULT_CACHE_LIMIT=100",
    "MEMBER_DEFAULT_CREDITS=20",
    "MEMBER_CACHE_CREDIT_COST=1",
    "NOTION_SEARCH_PAGE_SIZE=8",
    "NOTION_PARSE_MAX_PAGES=6",
    "NOTION_PARSE_BLOCK_DEPTH=2",
    "NOTION_PARSE_BLOCK_LIMIT=120",
    "NOTION_TITLE_SCAN_LIMIT=120",
    "NOTION_TITLE_MATCH_LIMIT=6",
    "NOTION_LIBRARY_QUERY_LIMIT=300",
    "NOTION_VARIANT_LIMIT=8",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_QUEUE_NAME=$QueueName",
    "AZURE_STORAGE_ASSET_TABLE=$AssetTable",
    "AZURE_STORAGE_JOB_TABLE=$JobTable",
    "AZURE_STORAGE_MEMBER_TABLE=$MemberTable",
    "AZURE_STORAGE_PLAYBACK_SAS_MINUTES=60",
    "AZURE_SUBSCRIPTION_ID=$subscriptionId",
    "AZURE_RESOURCE_GROUP=$ResourceGroup",
    "AZURE_CONTAINER_APP_JOB_NAME=$WorkerJobName",
    "AZURE_CONTAINER_APP_JOB_API_VERSION=2024-03-01"
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

$notionSecretId = az2 keyvault secret show `
    --vault-name $KeyVaultName `
    --name $NotionKeyVaultSecretName `
    --query id `
    --output tsv 2>$null

if ($notionSecretId) {
    $notionSecretUri = $notionSecretId -replace "/[0-9a-fA-F]{32}$", ""
    Write-Host "Attaching Notion read-only token secret reference."

    az2 containerapp secret set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --secrets "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)" `
        --output none

    az2 containerapp update `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --set-env-vars "NOTION_READ_ONLY_TOKEN=secretref:$NotionContainerSecretName" `
        --output none
} else {
    Write-Host "Notion Key Vault secret was not found; API will use mock search unless NOTION_READ_ONLY_TOKEN is set another way."
}

$accessSecretId = az2 keyvault secret show `
    --vault-name $KeyVaultName `
    --name $AccessKeyVaultSecretName `
    --query id `
    --output tsv 2>$null

if (-not $accessSecretId -and $AccessKey) {
    Write-Host "Creating WWPDW access key secret reference in Key Vault."
    $tempSecretPath = New-TemporaryFile
    try {
        Set-Content -Path $tempSecretPath -Value $AccessKey -NoNewline
        az2 keyvault secret set `
            --vault-name $KeyVaultName `
            --name $AccessKeyVaultSecretName `
            --file $tempSecretPath `
            --output none
    } finally {
        Remove-Item -LiteralPath $tempSecretPath -Force -ErrorAction SilentlyContinue
    }

    $accessSecretId = az2 keyvault secret show `
        --vault-name $KeyVaultName `
        --name $AccessKeyVaultSecretName `
        --query id `
        --output tsv
}

if ($accessSecretId) {
    $accessSecretUri = $accessSecretId -replace "/[0-9a-fA-F]{32}$", ""
    Write-Host "Attaching WWPDW access key secret reference."

    az2 containerapp secret set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --secrets "$AccessContainerSecretName=keyvaultref:$accessSecretUri,identityref:$($identity.id)" `
        --output none

    az2 containerapp update `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --set-env-vars "WWPDW_ACCESS_KEY=secretref:$AccessContainerSecretName" `
        --output none
} else {
    Write-Host "WWPDW access key secret was not found; protected API routes will reject requests until WWPDW_ACCESS_KEY is set."
}
