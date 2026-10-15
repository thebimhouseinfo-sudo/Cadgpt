# CadGPT-only HKCU Run value operations.
# Reusable in isolated Registry sandboxes for regression tests.
# Never recreate or overwrite an existing Run key: it can hold other apps.
function Install-CadGptStartupValue {
    param(
        [Parameter(Mandatory = $true)][string]$RegistryKey,
        [Parameter(Mandatory = $true)][string]$ValueName,
        [Parameter(Mandatory = $true)][string]$Command
    )
    if (-not (Test-Path -LiteralPath $RegistryKey)) {
        New-Item -Path $RegistryKey -ErrorAction Stop | Out-Null
    }
    New-ItemProperty -Path $RegistryKey -Name $ValueName -Value $Command -PropertyType String -Force -ErrorAction Stop | Out-Null
    $actual = (Get-ItemProperty -LiteralPath $RegistryKey -Name $ValueName -ErrorAction Stop).$ValueName
    if ($actual -cne $Command) {
        throw "CadGPT startup value readback mismatch."
    }
}
function Remove-CadGptStartupValue {
    param(
        [Parameter(Mandatory = $true)][string]$RegistryKey,
        [Parameter(Mandatory = $true)][string]$ValueName
    )
    if (Test-Path -LiteralPath $RegistryKey) {
        Remove-ItemProperty -Path $RegistryKey -Name $ValueName -ErrorAction SilentlyContinue
    }
}
