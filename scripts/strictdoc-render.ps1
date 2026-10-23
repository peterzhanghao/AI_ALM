#Requires -Version 5.1
<#
.SYNOPSIS
    生成 StrictDoc 渲染证据（REN-002 的可选输入）。

.DESCRIPTION
    在隔离 venv 中安装固定版本 strictdoc，导出样例仓库，并写入
    .alm/render/manifest.json：strictdocVersion、sourceSha、artifacts[] 与哈希。
    REN-002 只读取该清单；缺工具或产物时记 skip，不阻断门禁。

.PARAMETER Root
    资产仓库根目录，默认当前目录。

.PARAMETER StrictDocVersion
    strictdoc 版本，默认 0.30.4（与 REN-002 常量一致）。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/strictdoc-render.ps1 -Root fixtures/order-refund
#>
[CmdletBinding()]
param(
    [string]$Root = '.',
    [string]$StrictDocVersion = '0.30.4'
)

$ErrorActionPreference = 'Stop'

$rootPath = (Resolve-Path -LiteralPath $Root).Path
$venv = Join-Path $rootPath 'tmp/strictdoc-venv'
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host 'strictdoc-render: python not found; skipping render evidence (REN-002 stays skip).'
    exit 1
}

if (-not (Test-Path -LiteralPath $venv)) {
    & $python.Source -m venv $venv
    if ($LASTEXITCODE -ne 0) { Write-Host 'strictdoc-render: venv creation failed'; exit 1 }
}

$venvPython = Join-Path $venv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) { $venvPython = Join-Path $venv 'bin/python' }

& $venvPython -m pip install --quiet "strictdoc==$StrictDocVersion"
if ($LASTEXITCODE -ne 0) { Write-Host 'strictdoc-render: pip install failed'; exit 1 }

$outDir = Join-Path $rootPath '.alm/render'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$inputDir = Join-Path $rootPath 'requirements'
if (-not (Test-Path -LiteralPath $inputDir)) { $inputDir = $rootPath }

& $venvPython -m strictdoc export $inputDir --output-dir $outDir
if ($LASTEXITCODE -ne 0) { Write-Host 'strictdoc-render: export failed'; exit 1 }

$sourceSha = ''
try { $sourceSha = (git -C $rootPath rev-parse HEAD).Trim() } catch { $sourceSha = '' }

$artifacts = @()
Get-ChildItem -LiteralPath $outDir -Recurse -File |
    Where-Object { $_.Name -ne 'manifest.json' } |
    ForEach-Object {
        $relative = [System.IO.Path]::GetRelativePath($rootPath, $_.FullName) -replace '\\', '/'
        $artifacts += [ordered]@{
            path   = $relative
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

$manifest = [ordered]@{
    strictdocVersion = $StrictDocVersion
    sourceSha        = $sourceSha
    generatedAt      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    artifacts        = $artifacts
}

$manifestPath = Join-Path $outDir 'manifest.json'
$json = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "strictdoc-render: wrote $manifestPath ($($artifacts.Count) artifacts)"
