# gh 命令参考（Issue）

> 由 `ai-github-issue-workflow` 按需加载。参数以 `gh <命令> --help` 为准。

```powershell
$repo = 'peterzhanghao/AI_ALM'
```

## 环境与身份

```powershell
gh auth status
gh auth login          # 未登录时执行，按提示选择 GitHub.com 与 HTTPS
gh api user --jq .login
```

## 查询

```powershell
gh issue view <n> -R $repo --comments
gh issue list -R $repo --label 'status::ready' --state open
gh issue view <n> -R $repo --json number,title,state,labels,assignees,milestone,url,body
```

## 创建

```powershell
gh issue create -R $repo --title "[Task] ..." --body-file body.md `
  --label 'type::task','planning::execution','status::ready' `
  --assignee '@me' `
  --parent <父编号> `
  --blocked-by <前置编号1>,<前置编号2>
```

- `--parent` 建立 sub-issue 关系（原生层级）。
- `--blocked-by` / `--blocking` 建立有向依赖。
- `--type Task|Bug|Feature` 仅在仓库/组织启用 Issue Types 时可用；否则用 `type::*` 标签。

## 更新

```powershell
gh issue edit <n> -R $repo --add-label 'status::in-progress' --remove-label 'status::ready'
gh issue edit <n> -R $repo --add-assignee '@me' --milestone 'M1'
gh issue close <n> -R $repo --comment '交付完成：PR #<n>，merge commit <sha>'
```

一次只保留一个 `status::*`：加新状态前必须摘旧状态。

## 评论

```powershell
gh issue comment <n> -R $repo --body-file comment.md
```

`gh issue comment` 成功后会输出评论 URL，可作为回读依据。

## 原生关系兜底

CLI 未覆盖的关系字段用 REST API，写入后回读：

```powershell
gh api repos/$repo/issues/<n>/sub_issues
gh api repos/$repo/issues/<n>/dependencies/blocked_by
```

接口不可用时降级为正文清单，并在台账记录降级原因。

## 回读清单

1. 编号与 URL
2. 类型（Issue Type 或 `type::*`）与父项
3. 标签（含唯一 `status::*`）
4. 指派人与里程碑
5. blocked-by / blocking 实际值
6. 关闭状态与关闭原因

任一项无法回读时，按“未确认”报告，不能写成“已同步”。
