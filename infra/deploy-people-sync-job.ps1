param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "job-ww-people-index",
    [string]$ContainerEnv = "cae-ww-player-cache-dev",
    [string]$RegistryName = "acrwwcachee9219db7",
    [string]$ImageName = "wwpdw/api",
    [string]$ImageTag = "latest",
    [string]$IdentityName = "id-ww-player-cache-dev",
    [string]$KeyVaultName = "kv-wwcache-e9219db7",
    [string]$NotionKeyVaultSecretName = "NOTION-READ-ONLY-TOKEN",
    [string]$NotionContainerSecretName = "notion-token",
    [string]$NotionPeopleDataSourceId = $env:NOTION_PEOPLE_DATA_SOURCE_ID,
    [string]$StorageAccount = "stwwcachee9219db7",
    [string]$PersonCatalogTable = "peoplecatalog",
    [string]$CronExpression = "10 */2 * * *",
    [int]$PageSize = 100,
    [int]$OverlapMinutes = 10,
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command $AzCli -ErrorAction SilentlyContinue)) {
    throw "Azure CLI command was not found on PATH: $AzCli"
}

function Get-DotEnvValue {
    param([string]$Name)

    $envPath = Join-Path (Get-Location) ".env"
    if (-not (Test-Path -LiteralPath $envPath)) {
        return $null
    }
    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$") {
            return $matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return $null
}

if (-not $NotionPeopleDataSourceId) {
    $NotionPeopleDataSourceId = Get-DotEnvValue -Name "NOTION_PEOPLE_DATA_SOURCE_ID"
}
if (-not $NotionPeopleDataSourceId) {
    throw "NOTION_PEOPLE_DATA_SOURCE_ID is required to deploy the People sync job."
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
$envVars = @(
    "CACHE_BACKEND=azure",
    "PERSON_CATALOG_BACKEND=azure",
    "SEARCH_INDEX_BACKEND=azure",
    "WWPDW_PEOPLE_NOTION_SYNC_ENABLED=true",
    "WWPDW_PEOPLE_SYNC_STATE_BACKEND=azure",
    "WWPDW_PEOPLE_NOTION_SYNC_PAGE_SIZE=$PageSize",
    "WWPDW_PEOPLE_NOTION_SYNC_OVERLAP_MINUTES=$OverlapMinutes",
    "NOTION_PEOPLE_DATA_SOURCE_ID=$NotionPeopleDataSourceId",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_PERSON_CATALOG_TABLE=$PersonCatalogTable",
    "NOTION_READ_ONLY_TOKEN=secretref:$NotionContainerSecretName"
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
    & $AzCli containerapp job create `
        --name $JobName `
        --resource-group $ResourceGroup `
        --environment $ContainerEnv `
        --trigger-type Schedule `
        --cron-expression $CronExpression `
        --replica-timeout 1800 `
        --replica-retry-limit 1 `
        --replica-completion-count 1 `
        --parallelism 1 `
        --image $image `
        --registry-server $loginServer `
        --registry-identity $identity.id `
        --mi-user-assigned $identity.id `
        --cpu 0.25 `
        --memory 0.5Gi `
        --command node `
        --args node_modules/tsx/dist/cli.mjs apps/api/src/people-sync.ts `
        --secrets "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)" `
        --env-vars $envVars `
        --tags project=ww-player-cache env=dev managedBy=infra-script component=people-index `
        --output none
} else {
    & $AzCli containerapp job secret set `
        --name $JobName `
        --resource-group $ResourceGroup `
        --secrets "$NotionContainerSecretName=keyvaultref:$notionSecretUri,identityref:$($identity.id)" `
        --output none

    & $AzCli containerapp job update `
        --name $JobName `
        --resource-group $ResourceGroup `
        --image $image `
        --cpu 0.25 `
        --memory 0.5Gi `
        --replica-timeout 1800 `
        --replica-retry-limit 1 `
        --cron-expression $CronExpression `
        --command node `
        --args node_modules/tsx/dist/cli.mjs apps/api/src/people-sync.ts `
        --replace-env-vars $envVars `
        --output none
}

if ($LASTEXITCODE -ne 0) {
    throw "People sync job deployment failed."
}

& $AzCli containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,cronExpression:properties.configuration.scheduleTriggerConfig.cronExpression,image:properties.template.containers[0].image,stateBackend:properties.template.containers[0].env[?name=='WWPDW_PEOPLE_SYNC_STATE_BACKEND'].value | [0]}" `
    --output json
