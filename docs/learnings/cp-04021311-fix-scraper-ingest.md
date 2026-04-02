# Learning: fix-scraper-ingest — https→http + Tailscale IP + API LaunchAgent

**Branch**: cp-04021311-fix-scraper-ingest  
**PR**: #113  
**Date**: 2026-04-02

## 做了什么

修复 ZenithJoy 数据采集链路三个 blocking 问题：
1. 8个平台爬虫脚本 `https.request` → `http.request`（API 是纯 HTTP）
2. 爬虫 IP 从公网 `38.23.47.81` 改为 Tailscale 内网 `100.71.151.105`
3. 建 `apps/api/.env`（cecelia DB 配置）+ LaunchAgent 守护 API 进程

## 关键发现

### 1. verify-step.sh 需要正确的 git context
hook `branch-protect.sh` 调用 `verify-step.sh` 时使用 CWD 的 git context（总是 main）。
从 worktree 提交代码后，需要手动用正确的 `GIT_DIR`/`GIT_WORK_TREE` 运行 verify-step.sh：

```bash
GIT_DIR=/path/to/zenithjoy/.git/worktrees/cp-xxx \
GIT_WORK_TREE=/path/to/worktree \
bash hooks/verify-step.sh step2 cp-xxx /path/to/worktree
```

### 2. Stop Hook 已升级到 v14 — 使用 .dev-lock 而非 .dev-mode
stop.sh v14.0.0 只识别 `.dev-lock.<branch>`（per-branch 格式）。
旧的 `.dev-mode`（无后缀）不会触发 stop hook 循环。
新 /dev 会话应该创建 `.dev-lock.<branch>` 和 `.dev-mode.<branch>`。

### 3. API dist 需要重新构建
PR #111 合并了 snapshots 路由，但 `apps/api/dist/` 仍是旧构建。
LaunchAgent 启动的是 dist/index.js，必须先 `npm run build` 再 reload。

### 4. LaunchAgent node 路径
macOS Homebrew 安装的 node 在 `/opt/homebrew/bin/node`，不是 `/usr/local/bin/node`。
plist 中 ProgramArguments 必须用完整路径。

## 不做的事（刻意不改）

- 未加重试机制（失败静默丢数据问题留给下一步）
- 未改 API 代码逻辑
- 未做监控告警
