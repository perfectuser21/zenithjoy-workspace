# Learning: L1 CI 强制前端 DoD 浏览器验证检查

**Branch**: cp-04010843-l1-frontend-browser-check
**Date**: 2026-04-01

---

### 根本原因

ZenithJoy CI L1 只检查 PR 标题格式，L3 只做 Lint/TypeCheck/Build。没有任何机制要求开发者在浏览器里真实验证过功能，导致每次前端功能合并后频繁出现手测 bug。

### 下次预防

- [ ] 所有前端 PR 的 DoD 必须包含 `manual:chrome:` 或 `localhost:3001` 关键词的 `[BEHAVIOR]` 条目
- [ ] L1 `frontend-browser-dod-check` job 强制检查，缺失则 CI 拒绝合并
- [ ] ZenithJoy dashboard 端口为 3001（不同于 Cecelia 的 5211）

### 实现要点

- job 内置变更检测（无 changes job 依赖），直接 git diff 判断前端文件是否改动
- DoD 文件查找：.task-{branch}.md → .dod-{branch}.md → .dod.md
- 加入 `l1-passed` 的 `needs` 数组，硬性阻断
