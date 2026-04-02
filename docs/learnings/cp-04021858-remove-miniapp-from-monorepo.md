---
branch: cp-04021858-remove-miniapp-from-monorepo
created: 2026-04-02
type: learning
---

# 从 monorepo 移除 miniapp — 独立仓库迁移

## 做了什么
将微信小程序从 zenithjoy monorepo (`apps/miniapp/`) 移除，代码已独立为 `perfectuser21/zenithjoy-miniapp` 仓库。

同时处理了西安 Mac mini M4 上 Codex 做的前端设计代码：
- 西安 repo 的 remote 从本地 `/tmp/` 改为 GitHub
- 14 张 UI 设计图 + 1222 行前端代码改动已推送到 GitHub

## 踩的坑
1. `npm install --prefer-offline` 不会自动清理已删除 workspace 的 lock 条目，需要删除 `package-lock.json` 后重新 `npm install`
2. 西安 Codex 创建的 repo remote 指向 `/tmp/zjoy-miniapp.git`（本地 bare repo），不是 GitHub

### 根本原因
- npm 的 lock 机制不会主动清理已不存在的 workspace 条目
- Codex 在西安机器上初始化 repo 时使用了本地 bare repo 作为 remote

### 下次预防
- [x] 删除 workspace 后先删 package-lock.json 再 npm install
- [x] Codex 新建 repo 时确保 remote 指向 GitHub 而非本地路径
