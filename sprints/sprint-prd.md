# Sprint PRD — 快手 Publisher 三模式架构对齐 + GHA windows-latest 可自动验证

## OKR 对齐

- **对应 KR**：Line 01 智能发布自动化链路完整覆盖
- **当前进度**：快手 image-dryrun 仅 CDP 模式，无 video-dryrun，handler 无 type 路由
- **本次推进预期**：快手 image/video dryrun 全链路对齐抖音三模式架构，GHA windows-latest 自动验证通过

## 背景

快手 publisher 当前仅有 `publish-kuaishou-image-dryrun.cjs`（CDP 模式，无 cookie 注入），缺少 video-dryrun，`kuaishou-publish.ts` handler 硬编码 dryrun 且无 content.type 路由。抖音已验证三模式架构（cookie注入 / profile dir / CDP兜底），快手需对齐此架构，并通过 GHA windows-latest 自动验证。

## Golden Path（核心场景）

GHA windows-latest CI runner 从 [注入 KUAISHOU_COOKIES secret] → 经过 [分别触发 image-dryrun 和 video-dryrun，验证登录状态 + 页面导航，不实际发布] → 到达 [两个 dryrun 均 PASS，截图 artifact 上传，CI 全绿]

具体：
1. GHA 注入 `KUAISHOU_COOKIES` 环境变量（来自 repo secret）
2. image-dryrun：Playwright 注入 cookie → 导航至 `https://cp.kuaishou.com/article/publish/photo` → 截图 → 验证未跳转登录页 → exit 0
3. video-dryrun：同上但导航至 `https://cp.kuaishou.com/article/publish/video` → 拦截 `/rest/cp/works/` API（命中即 dryrun 失守）→ 截图 → exit 0
4. CI 上传截图 artifact，两个 job 全绿

## Response Schema

N/A — 任务无 HTTP 响应（本 sprint 为 Playwright dryrun 脚本 + handler 路由 + GHA workflow，无 API endpoint）

## 边界情况

- `content.type` 为未知值（非 `image` / `video`）时 handler 必须显式抛错，禁止静默 fallback
- `KUAISHOU_COOKIES` 缺失时脚本降级 profile dir 模式，再降级 CDP（端口 19223）兜底
- 快手 CDP 端口 **19223**，区别于抖音 19222，禁止混用

## 范围限定

**在范围内**：
- `publish-kuaishou-image-dryrun.cjs`：加 KUAISHOU_COOKIES 注入模式（三模式首位）
- 新建 `publish-kuaishou-video-dryrun.cjs`：三模式（cookie注入 / profile dir / CDP兜底）
- 重写 `services/agent/src/handlers/kuaishou-publish.ts`：`resolveKuaishouScriptPath()` + `ZENITHJOY_AGENT_REAL_PUBLISH` 开关 + `content.type` 路由 image/video（未知 type 显式抛错）
- 新建 `.github/workflows/kuaishou-e2e.yml`：windows-latest + KUAISHOU_COOKIES secret + 分别跑两个 dryrun + 上传截图 artifact
- handler unit tests：`resolveKuaishouScriptPath()` type 路由正确性（无需浏览器）

**不在范围内**：
- 真实发布（不点发布按钮，不调 `/rest/cp/works/` 真发 API）
- KUAISHOU_COOKIES secret 的 GHA 界面上传操作（PrepPRD 前置条件，人工完成）
- 多账号 / 矩阵发布
- 快手 API 直调模式（`publish-kuaishou-api.cjs` 不在本 sprint 范围）

## 假设

- [ASSUMPTION: KUAISHOU_COOKIES 格式与抖音一致（Playwright cookies JSON 数组），可直接用 `addCookies()` 注入]
- [ASSUMPTION: 快手图文发布页 `https://cp.kuaishou.com/article/publish/photo`，视频发布页 `https://cp.kuaishou.com/article/publish/video`，与 PrepPRD 一致]
- [ASSUMPTION: CJS 格式与现有 kuaishou-publisher 脚本保持一致]

## 预期受影响文件

- `services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs`：加三模式启动逻辑
- `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs`：新建，三模式
- `services/agent/src/handlers/kuaishou-publish.ts`：重写，resolveKuaishouScriptPath + type 路由
- `services/agent/src/handlers/__tests__/kuaishou-publish.test.ts`：新建 unit tests
- `.github/workflows/kuaishou-e2e.yml`：新建，windows-latest E2E

## E2E 验收

```bash
# 在 GHA windows-latest runner 上（由 kuaishou-e2e.yml 触发）
# image-dryrun
KUAISHOU_COOKIES="$KUAISHOU_COOKIES" node services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs queue-image.json
ls screenshots/kuaishou-image-*.png  # 截图存在即 PASS

# video-dryrun
KUAISHOU_COOKIES="$KUAISHOU_COOKIES" node services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs queue-video.json
ls screenshots/kuaishou-video-*.png  # 截图存在即 PASS

echo "✅ 快手三模式 dryrun 验证通过"
```

## journey_type: agent_remote
## journey_type_reason: 涉及 services/agent/ 下的 handler 和 Playwright 发布脚本，属于 ZenithJoy Agent 远端 Windows 执行链路
## target_environment: windows_cloud
## target_environment_reason: 快手 publisher 需 Windows 浏览器环境，通过 GitHub Actions windows-latest runner 运行 Playwright（完全干净 VM，公开 repo 免费无限次）
