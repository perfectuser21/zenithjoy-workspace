# Sprint PRD — 快手 publisher 三模式对齐 + GHA 自动验证

## OKR 对齐

- **对应 KR**：Line 01（智能发布）— 多平台发布链路 CI 可验
- **当前进度**：抖音已跑通三模式 + GHA；快手仅 CDP 单模式，无 video-dryrun，无 GHA
- **本次推进预期**：快手 image/video dryrun 全部可在 GHA windows-latest 自动验证

## 背景

抖音三模式（cookie 注入 / profile dir / CDP 兜底）已在 GHA 验证通过。快手 publisher 落后：
- `publish-kuaishou-image-dryrun.cjs` 只有 CDP 一种模式，无法在 GHA headless 环境注入 cookie
- 缺少 `publish-kuaishou-video-dryrun.cjs`
- 无 GHA workflow，快手发布链路无自动化验证

`services/agent/src/handlers/kuaishou-publish.ts` handler 已有完整架构（resolveKuaishouScriptPath + type 路由 + ZENITHJOY_AGENT_REAL_PUBLISH 开关），单元测试也已就绪，无需修改。

## Golden Path（核心场景）

GitHub Actions 触发 → windows-latest VM 注入 KUAISHOU_COOKIES → 分别执行 image-dryrun 和 video-dryrun → 两者均导航到快手创作者后台对应页面 + 截图为证 → CI PASS

具体：
1. GHA workflow 读取 `KUAISHOU_COOKIES` secret，写入环境变量
2. `publish-kuaishou-image-dryrun.cjs` 检测到 `KUAISHOU_COOKIES` → 注入 cookie → 导航到 `https://cp.kuaishou.com/article/publish/photo` → 截图 → 验证未触发 `/rest/cp/works/` 或 `/rest/cp/photo/publish`
3. `publish-kuaishou-video-dryrun.cjs` 同样三模式逻辑 → 导航到 `https://cp.kuaishou.com/article/publish/video` → 截图 → 验证未触发发布 API
4. 两个步骤均 exit 0 → GHA PASS → screenshots artifact 可下载审查

## Response Schema（脚本 stdout JSON）

### publish-kuaishou-image-dryrun.cjs — stdout 最后一行

**Success**:
```json
{"ok": true, "dryRun": true, "url": "<string>", "title": "<string>", "imagesCount": <number>}
```
- `ok` (boolean, 必填): 固定 `true`
- `dryRun` (boolean, 必填): 固定 `true`
- `url` (string, 必填): 最终停留的页面 URL
- `title` (string, 必填): 队列文件中的标题
- `imagesCount` (number, 必填): 本地图片数量

**Failure**: exit code 非 0，stderr 含错误描述

**禁用字段名**: `result`/`status`/`data`/`payload`

---

### publish-kuaishou-video-dryrun.cjs — stdout 最后一行

**Success**:
```json
{"ok": true, "dryRun": true, "url": "<string>", "title": "<string>"}
```
- `ok` (boolean, 必填): 固定 `true`
- `dryRun` (boolean, 必填): 固定 `true`
- `url` (string, 必填): 最终停留的页面 URL（视频发布页）
- `title` (string, 必填): 队列标题

**Failure**: exit code 非 0

## 边界情况

- KUAISHOU_COOKIES 无效/过期 → 导航后 URL 含 `login` 或 `passport` → 脚本 exit 1 含明确错误信息
- CDP 端口 19223 不可用且无 cookie/profile → exit 1（CDP 模式专属，不影响 GHA cookie 注入模式）
- 快手发布 API 被意外触发（`/rest/cp/works/` 或 `/rest/cp/photo/publish`）→ 脚本立即 exit 1 报 "dry-run 失守"

## 范围限定

**在范围内**：
- `publish-kuaishou-image-dryrun.cjs` 加 KUAISHOU_COOKIES + KUAISHOU_PROFILE_DIR 两种模式（保留 CDP 兜底）
- 新建 `publish-kuaishou-video-dryrun.cjs`（三模式：cookie 注入 / profile dir / CDP 兜底）
- 新建 `.github/workflows/kuaishou-e2e.yml`（windows-latest，分步跑 image + video dryrun，upload screenshots）

**不在范围内**：
- `kuaishou-publish.ts` handler — 已完整，不修改
- 单元测试 — 已存在，不修改
- 真实发布脚本（`publish-kuaishou-image.cjs` / `publish-kuaishou-video.cjs`）
- 快手扫码登录流程

## 假设

- [ASSUMPTION: KUAISHOU_COOKIES 已作为 GHA Secret 上传至 zenithjoy-workspace repo]
- [ASSUMPTION: 快手 CDP 端口为 19223，与抖音 19222 严格隔离]
- [ASSUMPTION: video dryrun 只需导航到视频发布页并截图，不需要上传真实视频文件]
- [ASSUMPTION: 快手视频发布页 URL 为 https://cp.kuaishou.com/article/publish/video]

## 预期受影响文件

- `services/agent/publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs`: 加 cookie/profile 模式
- `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs`: 新建（三模式）
- `.github/workflows/kuaishou-e2e.yml`: 新建（GHA windows-latest E2E）

## journey_type: autonomous
## journey_type_reason: ZenithJoy Agent 驱动的平台发布自动化，无 dashboard UI 介入，属 agent 侧脚本 + CI
## target_environment: windows_cloud
## target_environment_reason: 快手 publisher 需要 Windows Playwright + Chrome，GHA windows-latest runner 是唯一 CI 验证环境
