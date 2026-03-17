---
branch: cp-03171042-publish-by-content-id
created: 2026-03-17
task: feat(publisher): 新增 publish-by-content-id.sh
---

# Learning: publish-by-content-id.sh 路径适配

## 背景
Brain 将任务派发到 cecelia worktree，但实际代码在 zenithjoy 仓库。
需要在 zenithjoy 创建额外 worktree 来完成开发。

### 根本原因
- PRD 中的路径 `workflows/platform-data/workflows/publisher/scripts/` 属于 zenithjoy repo
- Brain 任务调度将 growth 域任务路由到了 cecelia worktree（两个仓库的边界不够清晰）
- 同时 branch-protect.sh hook 需要 `.dev-mode` + `tasks_created: true` 才允许写文件

### 下次预防
- [ ] Brain 任务注册时，growth 域任务应指向 zenithjoy repo，不是 cecelia
- [ ] 当在 cecelia worktree 发现 PRD 路径匹配 zenithjoy 结构时，立即在 zenithjoy 创建 worktree
- [ ] branch-protect.sh 在 zenithjoy worktree 中同样生效，需要提前准备 `.dev-mode` + `tasks_created: true`
- [ ] 已有原型脚本（`zenithjoy/scripts/publish-by-content-id.sh`）应在 PRD 中标注，避免重复开发

## 关键发现
- `SCRIPT_DIR/../../../../..` 正确解析：publisher/scripts → publisher → workflows → platform-data → workflows → 仓库根（共5级）
- zenithjoy publisher 统一通过 `PLATFORM_POST_ID:<id>` stdout 输出 post id，grep 解析稳定
