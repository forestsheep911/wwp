param(
    [string]$ExpectedSubscriptionId = "e9219db7-f600-43c5-8d42-9c63aae09138",
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$Location = "eastasia",
    [string]$Suffix = "e9219db7"
)

$ErrorActionPreference = "Stop"

$Names = [ordered]@{
    StorageAccount = "stwwcache$Suffix"
    Acr            = "acrwwcache$Suffix"
    KeyVault       = "kv-wwcache-$Suffix"
    Identity       = "id-ww-player-cache-dev"
    Workspace      = "log-ww-player-cache-dev"
    ContainerEnv   = "cae-ww-player-cache-dev"
    BlobContainer  = "cached-videos"
    Queue          = "cache-jobs"
    CacheIndex     = "cacheindex"
    CacheJobs      = "cachejobs"
}

$Tags = @(
    "project=ww-player-cache",
    "env=dev",
    "managedBy=infra-script"
)

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LifecyclePolicyPath = Join-Path $ScriptRoot "storage-lifecycle.json"

function Invoke-Az2 {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$AzArgs
    )

    $displayArgs = @($AzArgs)
    for ($i = 0; $i -lt $displayArgs.Count; $i++) {
        if ($displayArgs[$i] -in @("--logs-workspace-key", "--account-key", "--sas-token", "--connection-string", "--value")) {
            if ($i + 1 -lt $displayArgs.Count) {
                $displayArgs[$i + 1] = "<redacted>"
            }
        }
    }

    Write-Host "az2 $($displayArgs -join ' ')"
    & az2 @AzArgs
    if ($LASTEXITCODE -ne 0) {
        throw "az2 command failed: $($AzArgs -join ' ')"
    }
}

function Get-Az2Json {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$AzArgs
    )

    $output = & az2 @AzArgs
    if ($LASTEXITCODE -ne 0) {
        throw "az2 command failed: $($AzArgs -join ' ')"
    }

    return $output | ConvertFrom-Json
}

function Get-Az2Text {
    param(
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$AzArgs
    )

    $output = & az2 @AzArgs
    if ($LASTEXITCODE -ne 0) {
        throw "az2 command failed: $($AzArgs -join ' ')"
    }

    return (($output | Out-String).Trim())
}

function Test-Az2 {
    param(
        [string[]]$AzArgs
    )

    & az2 @AzArgs 1>$null 2>$null
    return $LASTEXITCODE -eq 0
}

function Ensure-RoleAssignment {
    param(
        [string]$AssigneeObjectId,
        [string]$PrincipalType,
        [string]$Role,
        [string]$Scope
    )

    $existing = Get-Az2Text role assignment list `
        --assignee-object-id $AssigneeObjectId `
        --role $Role `
        --scope $Scope `
        --fill-principal-name false `
        --query "[0].id" `
        --output tsv

    if ($existing) {
        Write-Host "Role already assigned: $Role"
        return
    }

    Invoke-Az2 role assignment create `
        --assignee-object-id $AssigneeObjectId `
        --assignee-principal-type $PrincipalType `
        --role $Role `
        --scope $Scope `
        --output none
}

if (-not (Get-Command az2 -ErrorAction SilentlyContinue)) {
    throw "az2 was not found on PATH."
}

$account = Get-Az2Json account show --output json
if ($account.id -ne $ExpectedSubscriptionId) {
    throw "az2 is using subscription $($account.name) ($($account.id)); expected $ExpectedSubscriptionId."
}

Write-Host "Using subscription: $($account.name) ($($account.id))"

Invoke-Az2 group create `
    --name $ResourceGroup `
    --location $Location `
    --tags @Tags `
    --output none

if (-not (Test-Az2 @("storage", "account", "show", "--name", $Names.StorageAccount, "--resource-group", $ResourceGroup))) {
    Invoke-Az2 storage account create `
        --name $Names.StorageAccount `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Standard_LRS `
        --kind StorageV2 `
        --min-tls-version TLS1_2 `
        --https-only true `
        --allow-blob-public-access false `
        --tags @Tags `
        --output none
} else {
    Invoke-Az2 storage account update `
        --name $Names.StorageAccount `
        --resource-group $ResourceGroup `
        --min-tls-version TLS1_2 `
        --https-only true `
        --allow-blob-public-access false `
        --output none
}

Invoke-Az2 storage container create `
    --account-name $Names.StorageAccount `
    --name $Names.BlobContainer `
    --public-access off `
    --output none

Invoke-Az2 storage queue create `
    --account-name $Names.StorageAccount `
    --name $Names.Queue `
    --output none

Invoke-Az2 storage table create `
    --account-name $Names.StorageAccount `
    --name $Names.CacheIndex `
    --output none

Invoke-Az2 storage table create `
    --account-name $Names.StorageAccount `
    --name $Names.CacheJobs `
    --output none

Invoke-Az2 storage account management-policy create `
    --account-name $Names.StorageAccount `
    --resource-group $ResourceGroup `
    --policy "@$LifecyclePolicyPath" `
    --output none

if (-not (Test-Az2 @("acr", "show", "--name", $Names.Acr, "--resource-group", $ResourceGroup))) {
    Invoke-Az2 acr create `
        --name $Names.Acr `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku Basic `
        --admin-enabled false `
        --tags @Tags `
        --output none
}

if (-not (Test-Az2 @("monitor", "log-analytics", "workspace", "show", "--workspace-name", $Names.Workspace, "--resource-group", $ResourceGroup))) {
    Invoke-Az2 monitor log-analytics workspace create `
        --workspace-name $Names.Workspace `
        --resource-group $ResourceGroup `
        --location $Location `
        --tags @Tags `
        --output none
}

if (-not (Test-Az2 @("containerapp", "env", "show", "--name", $Names.ContainerEnv, "--resource-group", $ResourceGroup))) {
    $workspaceId = Get-Az2Text monitor log-analytics workspace show `
        --workspace-name $Names.Workspace `
        --resource-group $ResourceGroup `
        --query customerId `
        --output tsv

    $workspaceKey = Get-Az2Text monitor log-analytics workspace get-shared-keys `
        --workspace-name $Names.Workspace `
        --resource-group $ResourceGroup `
        --query primarySharedKey `
        --output tsv

    Invoke-Az2 containerapp env create `
        --name $Names.ContainerEnv `
        --resource-group $ResourceGroup `
        --location $Location `
        --logs-workspace-id $workspaceId `
        --logs-workspace-key $workspaceKey `
        --tags @Tags `
        --output none
}

if (-not (Test-Az2 @("keyvault", "show", "--name", $Names.KeyVault, "--resource-group", $ResourceGroup))) {
    Invoke-Az2 keyvault create `
        --name $Names.KeyVault `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku standard `
        --enable-rbac-authorization true `
        --retention-days 7 `
        --tags @Tags `
        --output none
} else {
    Invoke-Az2 keyvault update `
        --name $Names.KeyVault `
        --resource-group $ResourceGroup `
        --enable-rbac-authorization true `
        --output none
}

if (-not (Test-Az2 @("identity", "show", "--name", $Names.Identity, "--resource-group", $ResourceGroup))) {
    Invoke-Az2 identity create `
        --name $Names.Identity `
        --resource-group $ResourceGroup `
        --location $Location `
        --tags @Tags `
        --output none
}

$identity = Get-Az2Json identity show `
    --name $Names.Identity `
    --resource-group $ResourceGroup `
    --output json

$storageId = Get-Az2Text storage account show `
    --name $Names.StorageAccount `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv

$acrId = Get-Az2Text acr show `
    --name $Names.Acr `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv

$keyVaultId = Get-Az2Text keyvault show `
    --name $Names.KeyVault `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv

Ensure-RoleAssignment `
    -AssigneeObjectId $identity.principalId `
    -PrincipalType ServicePrincipal `
    -Role "Storage Blob Data Contributor" `
    -Scope $storageId

Ensure-RoleAssignment `
    -AssigneeObjectId $identity.principalId `
    -PrincipalType ServicePrincipal `
    -Role "Storage Queue Data Contributor" `
    -Scope $storageId

Ensure-RoleAssignment `
    -AssigneeObjectId $identity.principalId `
    -PrincipalType ServicePrincipal `
    -Role "Storage Table Data Contributor" `
    -Scope $storageId

Ensure-RoleAssignment `
    -AssigneeObjectId $identity.principalId `
    -PrincipalType ServicePrincipal `
    -Role "Key Vault Secrets User" `
    -Scope $keyVaultId

Ensure-RoleAssignment `
    -AssigneeObjectId $identity.principalId `
    -PrincipalType ServicePrincipal `
    -Role "AcrPull" `
    -Scope $acrId

try {
    $signedInUser = Get-Az2Json ad signed-in-user show --output json
    Ensure-RoleAssignment `
        -AssigneeObjectId $signedInUser.id `
        -PrincipalType User `
        -Role "Key Vault Secrets Officer" `
        -Scope $keyVaultId
} catch {
    Write-Warning "Could not assign Key Vault Secrets Officer to the signed-in user: $($_.Exception.Message)"
}

$summary = [ordered]@{
    resourceGroup        = $ResourceGroup
    location             = $Location
    storageAccount       = $Names.StorageAccount
    blobContainer        = $Names.BlobContainer
    queue                = $Names.Queue
    tables               = @($Names.CacheIndex, $Names.CacheJobs)
    acr                  = $Names.Acr
    keyVault             = $Names.KeyVault
    managedIdentity      = $Names.Identity
    logAnalytics         = $Names.Workspace
    containerAppsEnv     = $Names.ContainerEnv
    managedIdentityId    = $identity.id
    managedIdentityAppId = $identity.clientId
}

Write-Host "Provisioned infrastructure:"
$summary | ConvertTo-Json -Depth 4
