#Requires -Version 5.1
<#
.SYNOPSIS
    校验 .dsh/skills 下的技能包是否符合 DeepSeek Harness 的发现约定。

.DESCRIPTION
    DSH 会静默跳过 frontmatter 非法的技能，因此本脚本把以下问题变成可见的失败：
    目录结构、name 与目录同名、kebab-case、description 长度、相对链接、禁用词。

.PARAMETER Root
    仓库根目录，默认取 scripts 目录的上一级。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-skills.ps1
#>
[CmdletBinding()]
param(
    [string]$Root
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) {
    $scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
    $Root = Split-Path -Parent (Split-Path -Parent $scriptPath)
}

$skillsDir = Join-Path $Root '.dsh/skills'
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Add-Failure { param([string]$Message) $script:failures.Add($Message) }
function Add-Warning { param([string]$Message) $script:warnings.Add($Message) }

function Get-FrontmatterValue {
    param([string]$Frontmatter, [string]$Key)
    $m = [regex]::Match($Frontmatter, "(?m)^\s*$([regex]::Escape($Key)):\s*(?<v>.+?)\s*$")
    if (-not $m.Success) { return $null }
    $v = $m.Groups['v'].Value.Trim()
    if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) {
        $v = $v.Substring(1, $v.Length - 2)
    }
    return $v
}

Write-Host "校验目录: $skillsDir"

if (-not (Test-Path -LiteralPath $skillsDir -PathType Container)) {
    Write-Host "FAIL  缺少技能目录: $skillsDir" -ForegroundColor Red
    exit 1
}

$skillDirs = @(Get-ChildItem -LiteralPath $skillsDir -Directory | Sort-Object Name)
if ($skillDirs.Count -eq 0) {
    Write-Host "FAIL  技能目录为空: $skillsDir" -ForegroundColor Red
    exit 1
}

foreach ($dir in $skillDirs) {
    $label = $dir.Name
    $skillPath = Join-Path $dir.FullName 'SKILL.md'

    if (-not (Test-Path -LiteralPath $skillPath -PathType Leaf)) {
        Add-Failure "[$label] 缺少 SKILL.md"
        Write-Host "FAIL  $label : 缺少 SKILL.md" -ForegroundColor Red
        continue
    }

    $text = Get-Content -LiteralPath $skillPath -Raw -Encoding utf8
    $text = $text -replace '^\uFEFF', ''
    $match = [regex]::Match($text, '(?s)^---\r?\n(?<fm>.*?)\r?\n---\r?\n(?<body>.*)$')
    if (-not $match.Success) {
        Add-Failure "[$label] SKILL.md 不是合法的 YAML frontmatter 块"
        Write-Host "FAIL  $label : frontmatter 块非法" -ForegroundColor Red
        continue
    }

    $fm = $match.Groups['fm'].Value
    $body = $match.Groups['body'].Value

    $name = Get-FrontmatterValue -Frontmatter $fm -Key 'name'
    $description = Get-FrontmatterValue -Frontmatter $fm -Key 'description'
    $whenToUse = Get-FrontmatterValue -Frontmatter $fm -Key 'whenToUse'
    $version = Get-FrontmatterValue -Frontmatter $fm -Key 'version'

    $localFailures = [System.Collections.Generic.List[string]]::new()
    $localWarnings = [System.Collections.Generic.List[string]]::new()

    if ([string]::IsNullOrWhiteSpace($name)) {
        $localFailures.Add('缺少 name')
    }
    else {
        if ($name -cnotmatch '^[a-z0-9]+(-[a-z0-9]+)*$') {
            $localFailures.Add("name 不是 kebab-case: $name")
        }
        if ($name -cne $dir.Name) {
            $localFailures.Add("name 与目录名不一致: $name != $($dir.Name)")
        }
    }

    if ([string]::IsNullOrWhiteSpace($description)) {
        $localFailures.Add('缺少 description')
    }
    else {
        if ($description.Length -gt 500) {
            $localFailures.Add("description 超长: $($description.Length) > 500")
        }
        if ($description.Length -lt 20) {
            $localWarnings.Add('description 过短，可能难以触发')
        }
    }

    if ([string]::IsNullOrWhiteSpace($whenToUse)) {
        $localWarnings.Add('缺少 whenToUse，触发信息只能依赖 description')
    }

    if ($version -and $version -notmatch '^\d+\.\d+\.\d+$') {
        $localWarnings.Add("metadata.version 不是语义化版本: $version")
    }

    if ($text -match '(?i)aerok') {
        $localFailures.Add('正文仍包含禁用品牌词 aerok')
    }

    $linkMatches = [regex]::Matches($body, '!?\[[^\]]*\]\((?<target>[^)\s]+)')
    foreach ($link in $linkMatches) {
        $target = $link.Groups['target'].Value
        if ($target -match '^(https?://|mailto:|#)') { continue }
        $target = $target.Split('#')[0]
        if ([string]::IsNullOrWhiteSpace($target)) { continue }
        $resolved = Join-Path $dir.FullName $target
        if (-not (Test-Path -LiteralPath $resolved)) {
            $localFailures.Add("相对链接不存在: $target")
        }
    }

    $refs = @()
    $refDir = Join-Path $dir.FullName 'references'
    if (Test-Path -LiteralPath $refDir -PathType Container) {
        $refs = @(Get-ChildItem -LiteralPath $refDir -File)
    }
    if ($refs.Count -eq 0) {
        $localWarnings.Add('没有 references/ 资源')
    }

    foreach ($f in $localFailures) { Add-Failure "[$label] $f" }
    foreach ($w in $localWarnings) { Add-Warning "[$label] $w" }

    if ($localFailures.Count -eq 0) {
        $sizeKb = [math]::Round((Get-Item -LiteralPath $skillPath).Length / 1KB, 1)
        $refNote = if ($refs.Count -gt 0) { ", $($refs.Count) 个引用文件" } else { '' }
        Write-Host ("PASS  {0}  ({1} KB{2})" -f $label, $sizeKb, $refNote) -ForegroundColor Green
    }
    else {
        Write-Host "FAIL  $label" -ForegroundColor Red
    }
}

Write-Host ''
if ($warnings.Count -gt 0) {
    foreach ($w in $warnings) { Write-Host "WARN  $w" -ForegroundColor Yellow }
    Write-Host ''
}

if ($failures.Count -gt 0) {
    foreach ($f in $failures) { Write-Host "ERROR $f" -ForegroundColor Red }
    Write-Host ''
    Write-Host "结果: 失败（$($failures.Count) 项）" -ForegroundColor Red
    exit 1
}

Write-Host "结果: 通过（$($skillDirs.Count) 个技能，$($warnings.Count) 条警告）" -ForegroundColor Green
exit 0
