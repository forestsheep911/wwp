param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$KeyVaultName = "kv-wwcache-e9219db7",
    [string]$AdminKeyVaultSecretName = "WWPDW-ADMIN-KEY",
    [string]$AdminContainerSecretName = "wwpdw-admin-key",
    [string]$AdminKey = $env:WWPDW_ADMIN_KEY,
    [switch]$NoRestart
)

$ErrorActionPreference = "Stop"

function Invoke-Az2 {
    param(
        [string[]]$Arguments
    )

    $output = & az2 @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "az2 $($Arguments -join ' ') failed."
    }

    return $output
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

if (-not $AdminKey) {
    $AdminKey = Get-DotEnvValue -Names @("WWPDW_ADMIN_KEY")
}

if (-not $AdminKey) {
    throw "WWPDW_ADMIN_KEY is not set. Pass -AdminKey or add WWPDW_ADMIN_KEY to .env."
}

$app = (Invoke-Az2 -Arguments @(
    "containerapp", "show",
    "--name", $ApiAppName,
    "--resource-group", $ResourceGroup,
    "--output", "json"
)) | ConvertFrom-Json

$identityId = ($app.identity.userAssignedIdentities.PSObject.Properties | Select-Object -First 1).Name
if (-not $identityId) {
    throw "Container App $ApiAppName does not have a user-assigned identity."
}

$tempSecretPath = New-TemporaryFile
try {
    Set-Content -Path $tempSecretPath -Value $AdminKey -NoNewline
    Invoke-Az2 -Arguments @(
        "keyvault", "secret", "set",
        "--vault-name", $KeyVaultName,
        "--name", $AdminKeyVaultSecretName,
        "--file", $tempSecretPath,
        "--output", "none"
    )
} finally {
    Remove-Item -LiteralPath $tempSecretPath -Force -ErrorAction SilentlyContinue
}

$adminSecretId = Invoke-Az2 -Arguments @(
    "keyvault", "secret", "show",
    "--vault-name", $KeyVaultName,
    "--name", $AdminKeyVaultSecretName,
    "--query", "id",
    "--output", "tsv"
)

$adminSecretUri = $adminSecretId -replace "/[0-9a-fA-F]{32}$", ""

Invoke-Az2 -Arguments @(
    "containerapp", "secret", "set",
    "--name", $ApiAppName,
    "--resource-group", $ResourceGroup,
    "--secrets", "$AdminContainerSecretName=keyvaultref:$adminSecretUri,identityref:$identityId",
    "--output", "none"
)

Invoke-Az2 -Arguments @(
    "containerapp", "update",
    "--name", $ApiAppName,
    "--resource-group", $ResourceGroup,
    "--set-env-vars", "WWPDW_ADMIN_KEY=secretref:$AdminContainerSecretName",
    "--output", "none"
)

if (-not $NoRestart) {
    $revisions = (Invoke-Az2 -Arguments @(
        "containerapp", "revision", "list",
        "--name", $ApiAppName,
        "--resource-group", $ResourceGroup,
        "--output", "json"
    )) | ConvertFrom-Json

    foreach ($revision in ($revisions | Where-Object { $_.active -or $_.properties.active })) {
        Invoke-Az2 -Arguments @(
            "containerapp", "revision", "restart",
            "--name", $ApiAppName,
            "--resource-group", $ResourceGroup,
            "--revision", $revision.name,
            "--output", "none"
        )
    }
}

Write-Host "WWPDW_ADMIN_KEY is backed by Key Vault secret $AdminKeyVaultSecretName and Container App secret $AdminContainerSecretName."
