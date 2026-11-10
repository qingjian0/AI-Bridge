# AI-Bridge GitHub 权限政策

## 用户确认的目标

所有获授权参与的 AI 尽可能拥有完整仓库管理能力；唯一禁止的是删除或转移整个 AI-Bridge 仓库。

## 推荐实现：GitHub Organization

如果要尽量精确实现“所有权限开放，但 AI 不能删除仓库”，建议将仓库放在 GitHub Organization 中，而不是继续使用个人仓库的 Collaborator 权限模型。

1. 由用户本人创建并持有 GitHub Organization Owner 身份。
2. 将 `qingjian0/AI-Bridge` 转移到该 Organization。
3. 在 Organization Settings → Member privileges / Repository deletion and transfer 中，关闭成员删除或转移仓库的权限，限制为 Organization Owners。
4. 将需要全面协作的 AI GitHub 账号加入为 Organization Member，并授予该仓库 Admin。
5. 用户本人保留 Organization Owner 身份；AI 不授予 Organization Owner。

GitHub 官方说明：组织所有者可以允许或禁止拥有仓库 Admin 权限的成员删除/转移仓库；可以将删除/转移限制为 Organization Owners。这样可以让 AI 获得仓库级 Admin 能力，同时由组织策略阻止成员删除仓库。该策略必须在迁移后实际设置并验证。

## 当前个人仓库的限制

当前仓库属于个人账号 `qingjian0`。个人仓库只有 Owner 和 Collaborator 两级权限，无法给 Collaborator 配置“Admin 全部能力但禁止删除仓库”的单独权限。

- **Collaborator Write：** 可参与代码、分支、Issue 和 PR 等主要协作，但不能管理全部仓库设置和管理功能。
- **Owner：** 拥有完整管理能力，包括删除仓库。
- 不能把 Write 描述成全部权限，也不能把个人仓库 Owner 权限授予 AI 来规避限制。

## 安全边界与操作要求

- 不得授予 AI Organization Owner 身份。
- 允许拥有仓库 Admin 权限的 AI 执行仓库级日常管理操作，但不得删除或转移仓库。
- 禁止删除仓库的策略由 Organization 层设置，而不是依赖 AI 自律。
- Pages、仓库文件和消息链接不得存放 GitHub Token。
- 邀请协作者、变更权限、调整 Secrets 和安全配置均应保留 GitHub 审计记录。
- 迁移前核对 Actions、Pages、自定义域名、Issues、Discussions、Secrets、分支保护和现有协作者的迁移影响。

## 状态

- 当前仓库仍在个人账号下。
- 尚未创建 Organization、转移仓库或设置组织级删除限制。
- 在完成迁移和验证之前，不得宣称“所有 AI 已获得 Admin 且不能删除仓库”。
