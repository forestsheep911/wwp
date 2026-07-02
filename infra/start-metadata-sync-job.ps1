param(
    [ValidateSet("full", "incremental")]
    [string]$Mode = "full",
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "",
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command $AzCli -ErrorAction SilentlyContinue)) {
    throw "Azure CLI command was not found on PATH: $AzCli"
}
if (-not $JobName) {
    $JobName = if ($Mode -eq "full") { "job-ww-meta-index-full" } else { "job-ww-meta-index-incremental" }
}

& $AzCli containerapp job start `
    --name $JobName `
    --resource-group $ResourceGroup `
    --output json
