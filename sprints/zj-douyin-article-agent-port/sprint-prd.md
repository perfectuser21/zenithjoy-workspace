# Sprint PRD — publish-douyin-article CDP 移植 + install pack 打包

## OKR 对齐

- **对应 KR**：Path 1 Step 6 — 真实发布（图文/视频/长文）
- **当前状态**：Step 6 thin/done（dryrun），缺长文脚本 + publishers 未进 install pack
- **本次推进**：Step 6 长文发布链路打通；install pack 自包含，无需开发机

## 背景

旧 `publish-douyin-article.js` 依赖 SSH/SCP 传封面到 Windows，无法在 Agent 本机运行。
移植为 CDP 直连（`localhost:19222`）并将 `publishers/` 打入 install pack，客户解压即用。

## Golden Path

Dashboard 下发 `type=article` 任务 → Agent 写 queue 文件 → 启动 `publish-douyin-article[-dryrun].cjs` → CDP 连 Chrome :19222 → 填标题/正文/封面 → dryrun 停在发布前 → 回执成功

1. 中台下发 `{type:"article", title, content, cover}`
2. `resolveDouyinScriptPath({type:'article'})` 路由到 article 脚本（不抛"暂未实现"）
3. 脚本 CDP 连浏览器，封面用 `DOM.setFileInputFiles(backendNodeId)` 上传本地路径
4. 发布按钮用 XPath（禁用 `button:has-text`）
5. dryrun：填完停止不点发布；real：点发布并回执

## Response Schema

N/A — 无新 HTTP 端点（Agent 内部行为 + 文件系统变更）

## 边界情况

- `summary` 可选，缺省取 `content.substring(0, 30)`
- `cover` 为 Windows 本地路径，文件必须存在；不传则 fail fast
- install pack 解压后 `publishers/douyin-publisher/` 必须含所有 `.cjs`

## 范围限定

**在内**：`publish-douyin-article.cjs` + dryrun、article 路由、install pack 加 publishers/、版本 bump 1.1.25→1.1.26

**不在内**：真实发布验证（lead 线下自验）；图文/视频路由改动；其他平台

## 假设

- [ASSUMPTION: CDP 端口 19222，Chrome 已登录抖音创作者后台]
- [ASSUMPTION: cover 为 Windows 本地绝对路径，Agent 进程有读权限]

## 预期受影响文件

- `services/agent/publishers/douyin-publisher/publish-douyin-article.cjs`（新建）
- `services/agent/publishers/douyin-publisher/publish-douyin-article-dryrun.cjs`（新建）
- `services/agent/publishers/douyin-publisher/__tests__/publish-douyin-article.test.cjs`（新建）
- `services/agent/src/handlers/douyin-publish.ts`（加 article 路由）
- `services/agent/scripts/build-install-pack.sh`（加 publishers/ 打包）
- `services/agent/package.json`（版本 bump）

## journey_type: autonomous
## journey_type_reason: Agent 内部行为，无 Dashboard UI，纯后端 task dispatch + publisher 脚本
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Agent 运行于 Windows，E2E 走 GitHub Actions windows-latest（干净 VM，CDP 连 Chrome）
