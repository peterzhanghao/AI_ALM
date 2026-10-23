#Requires -Version 5.1
<#
.SYNOPSIS
    初始化 GitHub 仓库的标签、develop 分支与分支保护。

.DESCRIPTION
    在首次推送 main 之后运行一次。重复运行是安全的：标签使用 --force 更新，
    已存在的分支与保护规则会被跳过或覆盖。

.PARAMETER Repo
    目标仓库，默认 peterzhanghao/AI_ALM。

.PARAMETER SkipProtection
    只创建标签与分支，不设置分支保护。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-github.ps1
#>
[CmdletBinding()]
param(
    [string]$Repo = 'peterzhanghao/AI_ALM',
    [switch]$SkipProtection
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

Write-Step "检查 gh 认证"
$null = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "未登录，请先运行: gh auth login" -ForegroundColor Red
    exit 1
}
Write-Ok "已登录: $((gh api user --jq .login) 2>$null)"

Write-Step "创建或更新标签"
$labels = @(
    @{ Name = 'type::tracking'; Color = '5319E7'; Description = '总控或领域跟踪 Issue' },
    @{ Name = 'type::task'; Color = '1D76DB'; Description = '可独立交付的执行任务' },
    @{ Name = 'type::bug'; Color = 'D73A4A'; Description = '缺陷' },
    @{ Name = 'type::feature'; Color = '0E8A16'; Description = '新能力' },
    @{ Name = 'planning::execution'; Color = '006B75'; Description = '已进入执行阶段的规划项' },
    @{ Name = 'status::backlog'; Color = 'EDEDED'; Description = '已登记未排期' },
    @{ Name = 'status::blocked'; Color = 'B60205'; Description = '被前置阻塞' },
    @{ Name = 'status::ready'; Color = 'FBCA04'; Description = '前置解除，可开始' },
    @{ Name = 'status::in-progress'; Color = '0E8A16'; Description = '开发中' },
    @{ Name = 'status::review'; Color = '1D76DB'; Description = 'PR 评审中' },
    @{ Name = 'status::done'; Color = '5319E7'; Description = '已交付' },
    @{ Name = 'priority::P0'; Color = 'B60205'; Description = '最高优先级' },
    @{ Name = 'priority::P1'; Color = 'D93F0B'; Description = '高优先级' },
    @{ Name = 'priority::P2'; Color = 'FBCA04'; Description = '普通优先级' }
)

foreach ($label in $labels) {
    gh label create $label.Name --color $label.Color --description $label.Description --force -R $Repo 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok $label.Name }
    else { Write-Warn "创建失败: $($label.Name)" }
}

Write-Step "确保 develop 分支存在"
$branches = @(gh api "repos/$Repo/branches" --paginate --jq '.[].name' 2>$null)
if ($branches -contains 'develop') {
    Write-Ok 'develop 已存在'
}
else {
    $mainSha = gh api "repos/$Repo/git/ref/heads/main" --jq '.object.sha' 2>$null
    if (-not $mainSha) {
        Write-Warn '找不到 main，先推送首次提交后再运行本脚本'
        exit 1
    }
    gh api -X POST "repos/$Repo/git/refs" -f ref='refs/heads/develop' -f sha=$mainSha 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok "develop 已创建（基于 main $($mainSha.Substring(0,7))）" }
    else { Write-Warn 'develop 创建失败，请检查权限' }
}

if ($SkipProtection) {
    Write-Step '跳过分支保护'
    exit 0
}

Write-Step "设置 develop 分支保护"
$protection = @{
    required_status_checks        = $null
    enforce_admins               = $false
    required_pull_request_reviews = @{
        required_approving_review_count = 1
        dismiss_stale_reviews           = $true
    }
    restrictions                 = $null
    allow_force_pushes           = $false
    allow_deletions              = $false
} | ConvertTo-Json -Depth 5

$temp = [System.IO.Path]::GetTempFileName()
try {
    [System.IO.File]::WriteAllText($temp, $protection, (New-Object System.Text.UTF8Encoding($false)))
    gh api -X PUT "repos/$Repo/branches/develop/protection" --input $temp 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Ok '保护已启用：必须 PR、1 位审批、禁止强推与删除' }
    else { Write-Warn '保护设置失败（私有仓库可能需要 Team/Pro 计划），可在网页 Settings → Branches 手动配置' }
}
finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}

Write-Step '完成'
Write-Host "仓库: https://github.com/$Repo"
