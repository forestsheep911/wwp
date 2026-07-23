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
    [string]$AdminKeyVaultSecretName = "WWPDW-ADMIN-KEY",
    [string]$AdminContainerSecretName = "wwpdw-admin-key",
    [string]$BailianKeyVaultSecretName = "BAILIAN-API-KEY",
    [string]$BailianContainerSecretName = "bailian-api-key",
    [string]$AdminKey = $env:WWPDW_ADMIN_KEY,
    [string]$AllowedWebOrigins = $env:WWPDW_ALLOWED_WEB_ORIGINS,
    [string]$BailianApiKey = $env:BAILIAN_API_KEY,
    [string]$AiSummaryModelPreset = $env:WWPDW_AI_SUMMARY_MODEL_PRESET,
    [string]$AiSummaryModel = $env:WWPDW_AI_SUMMARY_MODEL,
    [string]$BailianBaseUrl = $env:BAILIAN_BASE_URL,
    [string]$NotionLibraryRootPageId = $env:NOTION_LIBRARY_ROOT_PAGE_ID,
    [string]$NotionLibraryDatabaseId = $env:NOTION_LIBRARY_DATABASE_ID,
    [string]$NotionLibraryDataSourceId = $env:NOTION_LIBRARY_DATA_SOURCE_ID,
    [string]$NotionMediaAssetsDatabaseId = $env:NOTION_MEDIA_ASSETS_DATABASE_ID,
    [string]$NotionMediaAssetsDataSourceId = $env:NOTION_MEDIA_ASSETS_DATA_SOURCE_ID,
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$BlobContainer = "cached-videos",
    [string]$QueueName = "cache-jobs",
    [string]$AssetTable = "cacheindex",
    [string]$JobTable = "cachejobs",
    [string]$MemberTable = "membercodes",
    [string]$SearchIndexTable = "movieindex",
    [string]$TspdtBrowseTable = "tspdtbrowse",
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

$subscriptionId = & $AzCli account show --query id --output tsv
$loginServer = & $AzCli acr show `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --query loginServer `
    --output tsv

$identity = & $AzCli identity show `
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

if (-not $AdminKey) {
    $AdminKey = Get-DotEnvValue -Names @("WWPDW_ADMIN_KEY")
}

if (-not $BailianApiKey) {
    $BailianApiKey = Get-DotEnvValue -Names @("BAILIAN_API_KEY", "DASHSCOPE_API_KEY")
}

if (-not $AiSummaryModelPreset) {
    $AiSummaryModelPreset = Get-DotEnvValue -Names @("WWPDW_AI_SUMMARY_MODEL_PRESET")
}

if (-not $AiSummaryModel) {
    $AiSummaryModel = Get-DotEnvValue -Names @("WWPDW_AI_SUMMARY_MODEL")
}

if (-not $BailianBaseUrl) {
    $BailianBaseUrl = Get-DotEnvValue -Names @("BAILIAN_BASE_URL", "DASHSCOPE_BASE_URL")
}

$OmdbApiKey = Get-DotEnvValue -Names @("OMDB_API_KEY")

$workerJob = & $AzCli containerapp job show `
    --name $WorkerJobName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$assignment = & $AzCli role assignment list `
    --assignee $identity.principalId `
    --role "Contributor" `
    --scope $workerJob.id `
    --query "[0].id" `
    --output tsv

if (-not $assignment) {
    Write-Host "Granting API identity permission to start worker job."
    & $AzCli role assignment create `
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
    "SEARCH_INDEX_ENABLED=true",
    "SEARCH_INDEX_WRITE_THROUGH=true",
    "SEARCH_INDEX_REFRESH_ON_CACHE=true",
    "SEARCH_INDEX_RESULT_LIMIT=8",
    "SEARCH_INDEX_ENTRY_CACHE_TTL_SECONDS=300",
    "TSPDT_BROWSE_CACHE_TTL_SECONDS=300",
    "OMDB_REQUEST_TIMEOUT_MS=5000",
    "OMDB_LIVE_ENRICH_ENABLED=false",
    "WWPDW_AI_SUMMARY_MODEL_PRESET=spark",
    "WWPDW_AI_SUMMARY_TIMEOUT_MS=45000",
    "POSTER_CACHE_ENABLED=true",
    "POSTER_CACHE_MAX_BYTES=8388608",
    "POSTER_CACHE_MAX_PER_MOVIE=0",
    "MEMBER_DEFAULT_CREDITS=200",
    "MEMBER_CACHE_CREDIT_COST=10",
    "MEMBER_PLAYBACK_REPLAY_FREE_HOURS=24",
    "MEMBER_PLAYBACK_CREDIT_BYTES=100000000",
    "NOTION_SEARCH_PAGE_SIZE=8",
    "NOTION_PARSE_MAX_PAGES=6",
    "NOTION_PARSE_BLOCK_DEPTH=2",
    "NOTION_PARSE_BLOCK_LIMIT=120",
    "NOTION_TITLE_SCAN_LIMIT=120",
    "NOTION_TITLE_MATCH_LIMIT=6",
    "NOTION_LIBRARY_QUERY_LIMIT=300",
    "NOTION_VARIANT_LIMIT=8",
    "NOTION_REQUEST_TIMEOUT_MS=30000",
    "NOTION_SCAN_PAGE_PARSE_TIMEOUT_MS=60000",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_QUEUE_NAME=$QueueName",
    "AZURE_STORAGE_ASSET_TABLE=$AssetTable",
    "AZURE_STORAGE_JOB_TABLE=$JobTable",
    "AZURE_STORAGE_MEMBER_TABLE=$MemberTable",
    "AZURE_STORAGE_SEARCH_INDEX_TABLE=$SearchIndexTable",
    "AZURE_STORAGE_TSPDT_BROWSE_TABLE=$TspdtBrowseTable",
    "CACHE_ASSET_LOOKUP_CACHE_TTL_SECONDS=30",
    "AZURE_STORAGE_PLAYBACK_SAS_MINUTES=720",
    "AZURE_STORAGE_POSTER_SAS_MINUTES=1440",
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

if ($NotionMediaAssetsDatabaseId) {
    $envVars += "NOTION_MEDIA_ASSETS_DATABASE_ID=$NotionMediaAssetsDatabaseId"
}

if ($NotionMediaAssetsDataSourceId) {
    $envVars += "NOTION_MEDIA_ASSETS_DATA_SOURCE_ID=$NotionMediaAssetsDataSourceId"
}

if ($OmdbApiKey) {
    $envVars += "OMDB_API_KEY=$OmdbApiKey"
}

if ($AllowedWebOrigins) {
    $envVars += "WWPDW_ALLOWED_WEB_ORIGINS=$AllowedWebOrigins"
} else {
    Write-Warning "WWPDW_ALLOWED_WEB_ORIGINS is empty; browser cookie authentication will fail closed. Set it to the Static Web App origin before deployment."
}
$envVars += "WWPDW_SESSION_IDLE_SECONDS=2592000"
$envVars += "WWPDW_SESSION_ABSOLUTE_SECONDS=7776000"
$envVars += "WWPDW_SESSION_RENEWAL_SECONDS=86400"

if ($AiSummaryModelPreset) {
    $envVars += "WWPDW_AI_SUMMARY_MODEL_PRESET=$AiSummaryModelPreset"
}

if ($AiSummaryModel) {
    $envVars += "WWPDW_AI_SUMMARY_MODEL=$AiSummaryModel"
}

if ($BailianBaseUrl) {
    $envVars += "BAILIAN_BASE_URL=$BailianBaseUrl"
}

$existingAppName = & $AzCli containerapp list `
    --resource-group $ResourceGroup `
    --query "[?name=='$ApiAppName'].name | [0]" `
    --output tsv

$exists = [bool]$existingAppName

if (-not $exists) {
    Write-Host "Creating API Container App: $ApiAppName"
    & $AzCli containerapp create `
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
    & $AzCli containerapp identity assign `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --user-assigned $identity.id `
        --output none

    & $AzCli containerapp registry set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --server $loginServer `
        --identity $identity.id `
        --output none

    & $AzCli containerapp update `
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

& $AzCli containerapp show `
    --name $ApiAppName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,fqdn:properties.configuration.ingress.fqdn,image:properties.template.containers[0].image,identityType:identity.type}" `
    --output json

$notionSecretId = & $AzCli keyvault secret show `
    --vault-name $KeyVaultName `
    --name $NotionKeyVaultSecretName `
    --query id `
    --output tsv 2>$null

if ($notionSecretId) {
    $notionSecretUri = $notionSecretId -replace "/[0-9a-fA-F]{32}$", ""
    Write-Host "Attaching Notion read-only token secret reference."

    & $AzCli containerapp secret set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --secrets "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)" `
        --output none

    & $AzCli containerapp update `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --set-env-vars "NOTION_READ_ONLY_TOKEN=secretref:$NotionContainerSecretName" `
        --output none
} else {
    Write-Host "Notion Key Vault secret was not found; API will use mock search unless NOTION_READ_ONLY_TOKEN is set another way."
}

$bailianSecretId = & $AzCli keyvault secret show `
    --vault-name $KeyVaultName `
    --name $BailianKeyVaultSecretName `
    --query id `
    --output tsv 2>$null

if (-not $bailianSecretId -and $BailianApiKey) {
    Write-Host "Creating Bailian API key secret reference in Key Vault."
    $tempSecretPath = New-TemporaryFile
    try {
        Set-Content -Path $tempSecretPath -Value $BailianApiKey -NoNewline
        & $AzCli keyvault secret set `
            --vault-name $KeyVaultName `
            --name $BailianKeyVaultSecretName `
            --file $tempSecretPath `
            --output none
    } finally {
        Remove-Item -LiteralPath $tempSecretPath -Force -ErrorAction SilentlyContinue
    }

    $bailianSecretId = & $AzCli keyvault secret show `
        --vault-name $KeyVaultName `
        --name $BailianKeyVaultSecretName `
        --query id `
        --output tsv
}

if ($bailianSecretId) {
    $bailianSecretUri = $bailianSecretId -replace "/[0-9a-fA-F]{32}$", ""
    Write-Host "Attaching Bailian API key secret reference."

    & $AzCli containerapp secret set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --secrets "$BailianContainerSecretName=keyvaultref:$bailianSecretUri,identityref:$($identity.id)" `
        --output none

    & $AzCli containerapp update `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --set-env-vars "BAILIAN_API_KEY=secretref:$BailianContainerSecretName" `
        --output none
} else {
    Write-Host "Bailian API key secret was not found; AI movie summaries will stay disabled until an AI key is set."
}

$adminSecretId = & $AzCli keyvault secret show `
    --vault-name $KeyVaultName `
    --name $AdminKeyVaultSecretName `
    --query id `
    --output tsv 2>$null

if (-not $adminSecretId -and $AdminKey) {
    Write-Host "Creating WWPDW admin key secret reference in Key Vault."
    $tempSecretPath = New-TemporaryFile
    try {
        Set-Content -Path $tempSecretPath -Value $AdminKey -NoNewline
        & $AzCli keyvault secret set `
            --vault-name $KeyVaultName `
            --name $AdminKeyVaultSecretName `
            --file $tempSecretPath `
            --output none
    } finally {
        Remove-Item -LiteralPath $tempSecretPath -Force -ErrorAction SilentlyContinue
    }

    $adminSecretId = & $AzCli keyvault secret show `
        --vault-name $KeyVaultName `
        --name $AdminKeyVaultSecretName `
        --query id `
        --output tsv
}

if ($adminSecretId) {
    $adminSecretUri = $adminSecretId -replace "/[0-9a-fA-F]{32}$", ""
    Write-Host "Attaching WWPDW admin key secret reference."

    & $AzCli containerapp secret set `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --secrets "$AdminContainerSecretName=keyvaultref:$adminSecretUri,identityref:$($identity.id)" `
        --output none

    & $AzCli containerapp update `
        --name $ApiAppName `
        --resource-group $ResourceGroup `
        --set-env-vars "WWPDW_ADMIN_KEY=secretref:$AdminContainerSecretName" `
        --output none
} else {
    Write-Host "WWPDW admin key secret was not found; administrator login will reject requests until WWPDW_ADMIN_KEY is set."
}
