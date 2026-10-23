# glab 命令参考（工作项）

> 由 `ai-gitlab-issue-workflow` 按需加载。参数以当前安装版本的 `glab <命令> --help` 为准。

```powershell
$host = 'gitlab.k8s.ai.com.cn'
$repo = 'eic/software-architecture/ai-platform'
```

## 环境与身份

```powershell
glab auth status --hostname $host
# 若未登录：
glab auth login --hostname $host
glab api --hostname $host user
glab --version
```

## 查询

```powershell
glab issue view <IID> --comments -R $repo
glab issue list -R $repo --label 'status::ready'
```

## 创建

```powershell
glab issue create -R $repo --title "<标题>" --description "<正文>"
```

长正文建议先写入临时文件再 `--description-file`，避免 shell 转义破坏 Markdown。

## 更新标签与状态

```powershell
glab issue update <IID> -R $repo --label '<新标签>' --unlabel '<旧标签>'
```

一次只保留一个 `status::*`：加新状态前先摘旧状态。

## 评论

```powershell
glab issue note <IID> -R $repo --message '<进展评论>'
```

## 原生能力兜底

`glab issue` 不提供原生 Task 类型、父子层级或有向依赖时：

```powershell
glab work-items --help
glab work-items create --help
glab api --hostname $host projects/<URL-encoded-path>/issues/<IID>
```

这些接口可能是实验性的；执行前看 `--help`，写入后必须回读。

## 回读清单

写入后逐项回读并记录：

1. `IID` 与 `URL`
2. 工作项类型（Issue / Task）与父项
3. 标签（含唯一 `status::*`）
4. 里程碑（仅使用项目真实存在的）
5. 依赖关系（`Blocked by` 实际值）
6. 描述正文与评论 ID

任何一项无法回读时，按“未确认”报告，不能写成“已同步”。
