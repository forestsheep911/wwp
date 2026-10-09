# Shared loader. Output is captured; no secret values are logged.
function Get-CloudConfigValue {
    param([string[]]$Names)
    if ($null -eq $script:WwpCloudConfig) {
        $loader = Join-Path $PSScriptRoot "../tools/cloud-config.mjs"
        $json = & node $loader export
        if ($LASTEXITCODE -ne 0) { throw "Cloud configuration load failed. Run az login and npm run config:check." }
        $script:WwpCloudConfig = $json | ConvertFrom-Json
    }
    foreach ($name in $Names) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { return $value }
        $property = $script:WwpCloudConfig.PSObject.Properties[$name]
        if ($property -and $property.Value -ne '') { return [string]$property.Value }
    }
    return $null
}

function Get-CloudSecretValue {
    param([string]$Name)
    $injected = [Environment]::GetEnvironmentVariable($Name)
    if ($null -ne $injected) { return $injected }
    $value = Get-CloudConfigValue -Names @($Name)
    if ($value) { return $value }
    $reference = Get-CloudConfigValue -Names @("${Name}__KEY_VAULT")
    if ($reference -notmatch '^([a-zA-Z0-9-]+)/([a-zA-Z0-9-]+)$') { throw "Missing or invalid Vault reference for $Name" }
    $vaultName = $matches[1]; $secretName = $matches[2]
    $json = & az keyvault secret show --vault-name $vaultName --name $secretName --query value -o json --only-show-errors 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Vault read failed for $Name; check az login and secret-read permission." }
    return ($json | ConvertFrom-Json)
}

function Initialize-CloudParameters {
    param([string]$ScriptName, [System.Collections.IDictionary]$BoundParameters)
    $scriptKey = [IO.Path]::GetFileNameWithoutExtension($ScriptName).ToUpperInvariant().Replace('-', '_')
    # Literal deployment defaults are centralized in cloud; explicit arguments win.
    $null = Get-CloudConfigValue -Names @('AZURE_RESOURCE_GROUP')
    $prefix = "DEPLOY_${scriptKey}_"
    foreach ($entry in $script:WwpCloudConfig.PSObject.Properties) {
        if (-not $entry.Name.StartsWith($prefix)) { continue }
        $parameterName = $entry.Name.Substring($prefix.Length)
        if ($BoundParameters.Keys -contains $parameterName) { continue }
        $variable = Get-Variable -Name $parameterName -Scope 1 -ErrorAction SilentlyContinue
        if ($variable) { Set-Variable -Name $variable.Name -Value $entry.Value -Scope 1 }
    }
}
