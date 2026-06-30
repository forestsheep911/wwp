param(
    [ValidateSet("full", "incremental")]
    [string]$Mode = "full",
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = ""
)

$ErrorActionPreference = "Stop"

if (-not $JobName) {
    $JobName = if ($Mode -eq "full") { "job-ww-meta-index-full" } else { "job-ww-meta-index-incremental" }
}

az2 containerapp job start `
    --name $JobName `
    --resource-group $ResourceGroup `
    --output json
