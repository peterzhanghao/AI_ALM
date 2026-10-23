[CmdletBinding()]
param(
    [string]$Source = 'fixtures/order-refund',
    [string]$Target = 'tmp/demo-order-refund',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Resolve-UnderRoot([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) { return $Path }
    return (Join-Path $repoRoot $Path)
}

$sourcePath = Resolve-UnderRoot $Source
$targetPath = Resolve-UnderRoot $Target

if (-not (Test-Path -LiteralPath $sourcePath)) {
    Write-Host "alm-demo: source not found: $sourcePath"
    Write-Host 'alm-demo: the order-refund fixture lands with ALM-02.02; pass -Source to seed from another directory.'
    exit 1
}

if (Test-Path -LiteralPath $targetPath) {
    if (-not $Force) {
        Write-Host "alm-demo: target exists: $targetPath (use -Force to replace)"
        exit 1
    }
    Remove-Item -LiteralPath $targetPath -Recurse -Force
}

New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
Get-ChildItem -LiteralPath $sourcePath -Force | Copy-Item -Destination $targetPath -Recurse -Force

if (-not (Get-ChildItem -LiteralPath $targetPath -Force)) {
    Write-Host "alm-demo: source is empty: $sourcePath"
    exit 1
}

Push-Location $targetPath
try {
    git init -q
    git add -A
    git -c user.name='alm-demo' -c user.email='alm-demo@example.invalid' commit -q -m 'chore: seed order-refund baseline'
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'alm-demo: git commit failed'
        exit 1
    }
    $sha = (git rev-parse HEAD).Trim()
} finally {
    Pop-Location
}

Write-Host "alm-demo: repo   $targetPath"
Write-Host "alm-demo: base   $sha"
