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
    [string]$JobTable = "cachejobs",
    [string]$KeyVaultName = "kv-wwcache-e9219db7",
    [string]$OpenAiKeyVaultSecretName = "OPENAI-API-KEY",
    [string]$OpenAiContainerSecretName = "openai-api-key",
    [string]$BailianKeyVaultSecretName = "BAILIAN-API-KEY",
    [string]$BailianContainerSecretName = "bailian-api-key",
    [string]$OpenAiApiKey = $env:OPENAI_API_KEY,
    [string]$BailianApiKey = $env:BAILIAN_API_KEY,
    [string]$AiResolverModelPreset = $env:WWPDW_AI_RESOLVER_MODEL_PRESET,
    [string]$AiResolverModel = $env:WWPDW_AI_RESOLVER_MODEL,
    [string]$AiResolverApiKind = $env:WWPDW_AI_RESOLVER_API_KIND,
    [string]$OpenAiBaseUrl = $env:OPENAI_BASE_URL,
    [string]$BailianBaseUrl = $env:BAILIAN_BASE_URL,
    [string]$AiResolverApiUrl = $env:WWPDW_AI_RESOLVER_API_URL,
    [string]$AiResolverAuthHeader = $env:WWPDW_AI_RESOLVER_AUTH_HEADER,
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

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

if (-not $OpenAiApiKey) {
    $OpenAiApiKey = Get-DotEnvValue -Names @("OPENAI_API_KEY")
}

if (-not $BailianApiKey) {
    $BailianApiKey = Get-DotEnvValue -Names @("BAILIAN_API_KEY", "DASHSCOPE_API_KEY")
}

if (-not $AiResolverModel) {
    $AiResolverModel = Get-DotEnvValue -Names @("WWPDW_AI_RESOLVER_MODEL", "OPENAI_MODEL", "BAILIAN_MODEL", "DASHSCOPE_MODEL")
}

if (-not $AiResolverModelPreset) {
    $AiResolverModelPreset = Get-DotEnvValue -Names @("WWPDW_AI_RESOLVER_MODEL_PRESET")
}

if (-not $AiResolverApiKind) {
    $AiResolverApiKind = Get-DotEnvValue -Names @("WWPDW_AI_RESOLVER_API_KIND")
}

if (-not $OpenAiBaseUrl) {
    $OpenAiBaseUrl = Get-DotEnvValue -Names @("OPENAI_BASE_URL")
}

if (-not $BailianBaseUrl) {
    $BailianBaseUrl = Get-DotEnvValue -Names @("BAILIAN_BASE_URL", "DASHSCOPE_BASE_URL")
}

if (-not $AiResolverApiUrl) {
    $AiResolverApiUrl = Get-DotEnvValue -Names @("WWPDW_AI_RESOLVER_API_URL")
}

if (-not $AiResolverAuthHeader) {
    $AiResolverAuthHeader = Get-DotEnvValue -Names @("WWPDW_AI_RESOLVER_AUTH_HEADER")
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
    "WORKER_MODE=oneshot",
    "WORKER_POLL_MS=900",
    "WORKER_MAX_CONCURRENT=2",
    "WORKER_ONESHOT_MAX_TICKS=30",
    "CACHE_ASSET_IDLE_TTL_DAYS=7",
    "WWPDW_AI_RESOLVER_ENABLED=auto",
    "WWPDW_AI_RESOLVER_MODEL_PRESET=compass",
    "WWPDW_AI_RESOLVER_TIMEOUT_MS=25000",
    "WWPDW_AI_RESOLVER_FETCH_TIMEOUT_MS=10000",
    "WWPDW_AI_RESOLVER_FETCH_MAX_BYTES=120000",
    "AZURE_CLIENT_ID=$($identity.clientId)",
    "AZURE_STORAGE_ACCOUNT_NAME=$StorageAccount",
    "AZURE_STORAGE_BLOB_CONTAINER=$BlobContainer",
    "AZURE_STORAGE_QUEUE_NAME=$QueueName",
    "AZURE_STORAGE_ASSET_TABLE=$AssetTable",
    "AZURE_STORAGE_JOB_TABLE=$JobTable",
    "AZURE_STORAGE_PLAYBACK_SAS_MINUTES=720"
)

if ($AiResolverModelPreset) {
    $envVars += "WWPDW_AI_RESOLVER_MODEL_PRESET=$AiResolverModelPreset"
}

if ($AiResolverModel) {
    $envVars += "WWPDW_AI_RESOLVER_MODEL=$AiResolverModel"
}

if ($AiResolverApiKind) {
    $envVars += "WWPDW_AI_RESOLVER_API_KIND=$AiResolverApiKind"
}

if ($OpenAiBaseUrl) {
    $envVars += "OPENAI_BASE_URL=$OpenAiBaseUrl"
}

if ($BailianBaseUrl) {
    $envVars += "BAILIAN_BASE_URL=$BailianBaseUrl"
}

if ($AiResolverApiUrl) {
    $envVars += "WWPDW_AI_RESOLVER_API_URL=$AiResolverApiUrl"
}

if ($AiResolverAuthHeader) {
    $envVars += "WWPDW_AI_RESOLVER_AUTH_HEADER=$AiResolverAuthHeader"
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
    Write-Host "Creating Container Apps Job: $JobName"
    & $AzCli containerapp job create `
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
    & $AzCli containerapp job update `
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

& $AzCli containerapp job show `
    --name $JobName `
    --resource-group $ResourceGroup `
    --query "{name:name,provisioningState:properties.provisioningState,triggerType:properties.configuration.triggerType,image:properties.template.containers[0].image,identityType:identity.type}" `
    --output json

$openAiSecretId = & $AzCli keyvault secret show `
    --vault-name $KeyVaultName `
    --name $OpenAiKeyVaultSecretName `
    --query id `
    --output tsv 2>$null

if (-not $openAiSecretId -and $OpenAiApiKey) {
    Write-Host "Creating OpenAI API key secret reference in Key Vault."
    $tempSecretPath = New-TemporaryFile
    try {
        Set-Content -Path $tempSecretPath -Value $OpenAiApiKey -NoNewline
        & $AzCli keyvault secret set `
            --vault-name $KeyVaultName `
            --name $OpenAiKeyVaultSecretName `
            --file $tempSecretPath `
            --output none
    } finally {
        Remove-Item -LiteralPath $tempSecretPath -Force -ErrorAction SilentlyContinue
    }

    $openAiSecretId = & $AzCli keyvault secret show `
        --vault-name $KeyVaultName `
        --name $OpenAiKeyVaultSecretName `
        --query id `
        --output tsv
}

if ($openAiSecretId) {
    $openAiSecretUri = $openAiSecretId -replace "/[0-9a-fA-F]{32}$", ""
    Write-Host "Attaching OpenAI API key secret reference."

    & $AzCli containerapp job secret set `
        --name $JobName `
        --resource-group $ResourceGroup `
        --secrets "$OpenAiContainerSecretName=keyvaultref:$openAiSecretUri,identityref:$($identity.id)" `
        --output none

    & $AzCli containerapp job update `
        --name $JobName `
        --resource-group $ResourceGroup `
        --set-env-vars "OPENAI_API_KEY=secretref:$OpenAiContainerSecretName" `
        --output none
} else {
    Write-Host "OpenAI API key secret was not found; worker may still use Bailian or another configured AI provider."
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

    & $AzCli containerapp job secret set `
        --name $JobName `
        --resource-group $ResourceGroup `
        --secrets "$BailianContainerSecretName=keyvaultref:$bailianSecretUri,identityref:$($identity.id)" `
        --output none

    & $AzCli containerapp job update `
        --name $JobName `
        --resource-group $ResourceGroup `
        --set-env-vars "BAILIAN_API_KEY=secretref:$BailianContainerSecretName" `
        --output none
} else {
    Write-Host "Bailian API key secret was not found; worker will use another configured AI provider if available."
}
