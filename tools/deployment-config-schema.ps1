# Extract literal deployment defaults only. Never evaluate expressions/env vars.
$root = Join-Path $PSScriptRoot "../infra"
$result = @{}
Get-ChildItem -LiteralPath $root -Filter '*.ps1' | Where-Object { $_.BaseName -ne 'cloud-config' } | ForEach-Object {
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "Invalid deployment script: $($_.Name)" }
    $scriptKey = $_.BaseName.ToUpperInvariant().Replace('-', '_')
    foreach ($parameter in $ast.ParamBlock.Parameters) {
        if ($null -eq $parameter.DefaultValue) { continue }
        try { $value = $parameter.DefaultValue.SafeGetValue() } catch { continue }
        if ($value -is [string] -or $value -is [int] -or $value -is [double]) {
            if ([string]$value -eq '') { continue }
            $key = 'DEPLOY_' + $scriptKey + '_' + $parameter.Name.VariablePath.UserPath.ToUpperInvariant()
            $result[$key] = [string]$value
        }
    }
}
ConvertTo-Json -InputObject $result -Compress
