# Sprint PRD — 快手 publisher 三模式对齐 + GHA 自动验证（WS2+WS3 续）

## OKR 对齐

- **对应 KR**：Line 01（智能发布）— 多平台发布链路 CI 可验
- **当前进度**：WS1（image-dryrun 三模式）已在 PR #493 合并
- **本次推进预期**：快手 video-dryrun 新建 + GHA E2E workflow 上线，链路 CI 全绿

## 背景

WS1 已完成（PR #493）：`publish-kuaishou-image-dryrun.cjs` 升级三模式（KUAISHOU_COOKIES / KUAISHOU_PROFILE_DIR / CDP 兜底）。

本次续跑 WS2 + WS3：
- 缺少 `publish-kuaishou-video-dryrun.cjs`（视频发布页 dryrun）
- 无 GHA workflow，快手发布链路无自动化验证

## Golden Path（核心场景）

GitHub Actions 触发 → windows-latest VM 注入 KUAISHOU_COOKIES → 分别执行 image-dryrun 和 video-dryrun → 两者均导航到快手创作者后台对应页面 + 截图为证 → CI PASS

具体：
1. GHA workflow 读取 `KUAISHOU_COOKIES` secret，写入环境变量
2. `publish-kuaishou-image-dryrun.cjs`（WS1 已完成）执行：注入 cookie → 导航到图文发布页 → 截图 → exit 0
3. `publish-kuaishou-video-dryrun.cjs`（WS2 新建）执行：同三模式逻辑 → 导航到 `https://cp.kuaishou.com/article/publish/video` → 截图 → exit 0
4. 两个步骤均 exit 0 → GHA PASS → screenshots artifact 可下载审查

## Response Schema（脚本 stdout JSON）

### publish-kuaishou-image-dryrun.cjs（WS1 已完成）

**Success (exit 0)**:
```json
{"ok": true, "dryRun": true, "url": "<string>", "title": "<string>", "imagesCount": <number>}
```

---

### publish-kuaishou-video-dryrun.cjs — stdout 最后一行

**Success (exit 0)**:
```json
{"ok": true, "dryRun": true, "url": "<string>", "title": "<string>"}
```
- `ok` (boolean, 必填): 固定 `true`
- `dryRun` (boolean, 必填): 固定 `true`
- `url` (string, 必填): 最终停留的页面 URL（视频发布页）
- `title` (string, 必填): 队列标题
- **无 `imagesCount` 字段**（video 只有 4 字段，区别于 image 的 5 字段）

**Failure**: exit code 非 0，stderr 含错误描述

**禁用响应字段名**: `result`/`status`/`data`/`payload`

---

### kuaishou-e2e.yml — 无 HTTP 响应

N/A — workflow 通过 GHA job exit code 判断成功/失败；截图 artifact 为可视证据

## 边界情况

- KUAISHOU_COOKIES 无效/过期 → 导航后 URL 含 `login` 或 `passport` → 脚本 exit 1 含明确错误信息
- 快手发布 API 被意外触发（`/rest/cp/works/`）→ 脚本立即 exit 1 报 "dry-run 失守"
- CDP 端口 19223 不可用（GHA 环境，正常）→ 若已设 KUAISHOU_COOKIES 则不走 CDP 路径，不报错

## 范围限定

**在范围内**：
- 新建 `publish-kuaishou-video-dryrun.cjs`（三模式：KUAISHOU_COOKIES / KUAISHOU_PROFILE_DIR / CDP 兜底）
- 新建 `.github/workflows/kuaishou-e2e.yml`（windows-latest，image + video 两步，上传 screenshots artifact）

**不在范围内**：
- `publish-kuaishou-image-dryrun.cjs` — WS1 已完成，不再修改
- `kuaishou-publish.ts` handler — 已完整，不修改
- 单元测试 — 已存在于 `sprints/zj-kuaishou-three-mode/tests/`，不修改
- 真实发布脚本（`publish-kuaishou-image.cjs` / `publish-kuaishou-video.cjs`）

## 假设

- [ASSUMPTION: KUAISHOU_COOKIES 已作为 GHA Secret 上传至 zenithjoy-workspace repo]
- [ASSUMPTION: 快手 CDP 端口为 19223，与抖音 19222 严格隔离]
- [ASSUMPTION: video dryrun 只需导航到视频发布页并截图，不需要上传真实视频文件]
- [ASSUMPTION: 快手视频发布页 URL 为 https://cp.kuaishou.com/article/publish/video]

## 预期受影响文件

- `services/agent/publishers/kuaishou-publisher/publish-kuaishou-video-dryrun.cjs`: 新建（三模式）
- `.github/workflows/kuaishou-e2e.yml`: 新建（GHA windows-latest E2E）

## journey_type: autonomous
## journey_type_reason: ZenithJoy Agent 驱动的平台发布自动化，无 dashboard UI 介入，属 agent 侧脚本 + CI
## target_environment: windows_cloud
## target_environment_reason: 快手 publisher 需要 Windows Playwright + Chromium，GHA windows-latest runner 是唯一 CI 验证环境（GitHub Actions，公共 repo 免费）
