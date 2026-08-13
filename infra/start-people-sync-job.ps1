param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "job-ww-people-index",
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)

$ErrorActionPreference = "Stop"

$execution = & $AzCli containerapp job start `
    --name $JobName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

$executionName = $execution.name
if (-not $executionName) {
    throw "People sync job did not return an execution name."
}

Write-Output $executionName
