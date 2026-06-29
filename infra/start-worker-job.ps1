param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$JobName = "job-ww-cache-worker"
)

$ErrorActionPreference = "Stop"

$execution = az2 containerapp job start `
    --name $JobName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json

Write-Host "Started execution: $($execution.name)"

for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    $state = az2 containerapp job execution show `
        --name $JobName `
        --resource-group $ResourceGroup `
        --job-execution-name $execution.name `
        --output json | ConvertFrom-Json

    Write-Host "Execution status: $($state.properties.status)"

    if ($state.properties.status -ne "Running") {
        $state | ConvertTo-Json -Depth 8
        exit 0
    }
}

throw "Execution did not finish within the wait window: $($execution.name)"
