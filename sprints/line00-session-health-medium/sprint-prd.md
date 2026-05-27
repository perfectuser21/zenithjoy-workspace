# Sprint PRD — Session 一键登录 + 真实健康巡检（thin→medium）

## OKR 对齐

- **对应 KR**：KR-OPS1（运营自动化基础设施）
- **当前进度**：~35%（前 sprint 完成状态矩阵 UI + check-health.js + GHA 4x/日）
- **本次推进预期**：~70%

## 背景

前 sprint（zj-ops1-session-health）建立了 OperatorPage 8×4 状态矩阵 + check-health.js + session-health-check.yml，但存在两个阻塞问题：（1）Secret 命名用 `*_MAIN`，实际应为 `{PLATFORM}_COOKIES`，命名错位导致巡检无法读到正确 secret；（2）Secret 为空时被误标为 `ok`（missing=ok bug），掩盖了未配置状态。此外运营员还没有"一键登录"流程——目前无法从 Dashboard 触发 xian-pc Chrome 扫码并自动写入 GitHub Secrets。

## Golden Path（核心场景）

**首次使用 — 主号扫码绑定**：

1. 管理员打开 `/operator` → 看到 8 主号行，每行"登录"按钮（灰色未配置状态）
2. 点"抖音主号 → 登录" → Dashboard 调用 `POST /api/operator/sessions/bind-start` `{platform: "douyin"}`
3. 后端下发 `qr_bind/douyin` task 给 xian-pc Agent（通过现有 Agent task dispatch 机制）
4. xian-pc Agent CDP 连接 Chrome（port 19222）→ 导航 `creator.douyin.com` → 等待用户扫码
5. URL 离开 `/login` → Agent 抓取 `storageState` → `POST /api/operator/sessions/upload-cookies` `{platform: "douyin", cookies: {...}}`
6. 后端 Octokit 调用 GitHub REST API 写入 `DOUYIN_COOKIES` Secret → 返回 `{ok: true, secretName: "DOUYIN_COOKIES", updatedAt: "..."}`
7. Dashboard 格子变绿 ✅，显示最后更新时间

**日常巡检（现有 GHA 升级）**：

1. `session-health-check.yml` 4x/日触发
2. 读 `*_COOKIES`（修正自 `*_MAIN`）secrets → 真实 HTTP 调用平台 creator API
3. Secret 值为空 → `status: "missing"`（修复原误判为 `ok`）
4. 任意主号 `expired` → 飞书 Bot 推送告警 + Dashboard 标红

**Cookie 过期恢复**：

1. 巡检标记 `DOUYIN_COOKIES` 过期 → 飞书推送"抖音主号 cookie 过期，请重新登录"
2. 管理员打开 Dashboard `/operator` → 点"重新登录" → 重复首次使用 Step 2–7

## Response Schema

### POST /api/operator/sessions/bind-start

**Request Body**:
```json
{"platform": "douyin"}
```
- `platform` (string, 必填): 枚举 `douyin`/`kuaishou`/`xiaohongshu`/`shipinhao`/`toutiao`/`weibo`/`zhihu`/`gongzhonghao`

**Success (HTTP 200)**:
```json
{"ok": true, "taskId": "<uuid>"}
```
- `ok` (boolean, 必填): `true`
- `taskId` (string, 必填): Agent task ID，**禁用** `id`/`task`/`result`/`data`

**Error (HTTP 503)**:
```json
{"error": "Agent 不在线"}
```

### POST /api/operator/sessions/upload-cookies

**Request Body**:
```json
{"platform": "douyin", "cookies": {"cookies": [...], "origins": [...]}}
```
- `platform` (string, 必填): 同 bind-start 枚举
- `cookies` (object, 必填): Playwright `storageState()` 完整输出

**Success (HTTP 200)**:
```json
{"ok": true, "secretName": "DOUYIN_COOKIES", "updatedAt": "2026-05-27T12:00:00Z"}
```
- `ok` (boolean, 必填): `true`
- `secretName` (string, 必填): 格式 `{PLATFORM_UPPER}_COOKIES`，**禁用** `secret`/`key`/`name`/`result`
- `updatedAt` (ISO string, 必填): **禁用** `timestamp`/`time`/`updated`/`at`

**Error (HTTP 400/500)**:
```json
{"error": "<string>"}
```
**禁用响应 key**: `message`/`msg`/`reason`/`detail`

**Schema 完整性**: success 顶层 keys 完全等于 `["ok", "secretName", "updatedAt"]`

### GET /api/operator/sessions/status（Dashboard 轮询用）

**Success (HTTP 200)**:
```json
[{"platform": "douyin", "secretName": "DOUYIN_COOKIES", "status": "ok", "checkedAt": "2026-05-27T12:00:00Z"}]
```
- `status` 枚举：`ok`/`expired`/`missing`，**禁用** `healthy`/`active`/`inactive`/`good`

## 边界情况

- `GH_SECRETS_WRITE_PAT` 未配置 → `upload-cookies` 返回 HTTP 500 + `{error: "GH_SECRETS_WRITE_PAT 未配置"}`
- xian-pc Agent 不在线 → `bind-start` 返回 HTTP 503 + `{error: "Agent 不在线"}`
- 扫码超时（3 分钟无 URL 跳转）→ Agent 返回 error，`upload-cookies` 不调用，Dashboard 显示"登录超时，请重试"
- 飞书 webhook 超时（>3s）→ `Promise.race` catch log+continue，不阻塞 Bark 告警
- Secret 值为空字符串 → `check-health.js` 标记 `status: "missing"`（修复原 `ok` 漏判）
- 视频号/公众号特殊 OAuth → 排除本次，按普通 cookie 流程处理，失败时 `status: "missing"`

## 范围限定

**在范围内**：
- 8 个平台**主号**（MAIN）"登录"按钮 + Agent `qr-bind` handler（快手/小红书/视频号/头条/微博/知乎/公众号 7 个新增，抖音已有）
- `POST /api/operator/sessions/upload-cookies`（Octokit 写 `{PLATFORM}_COOKIES` GitHub Secret）
- `POST /api/operator/sessions/bind-start`（分发 qr_bind task 到 xian-pc Agent）
- `GET /api/operator/sessions/status`（Dashboard 轮询用）
- `check-health.js`：`missing=ok` bug 修复 + `secretEnv` 从 `DOUYIN_MAIN` 改为 `DOUYIN_COOKIES`
- `session-health-check.yml`：Secret 引用从 `*_MAIN` 改为 `*_COOKIES`
- OperatorPage.tsx：主号行添加"登录"/"重新登录"按钮，展示最后更新时间

**不在范围内**：
- 4 个小号的登录流程
- Bark push 改动（已有，不动）
- 视频号/公众号特殊 OAuth
- `GH_SECRETS_WRITE_PAT` 创建（前置工作，需人工在 GitHub UI 完成）

## 假设

- [ASSUMPTION: GH_SECRETS_WRITE_PAT 已存为 GitHub Secret，含 `secrets` write scope；前置工作由管理员完成]
- [ASSUMPTION: xian-pc Agent 在线状态通过 `POST /api/operator/sessions/bind-start` 返回值判断，不需要额外在线检测 UI]
- [ASSUMPTION: `upload-cookies` API 由 Agent 主动回调后端，不需要 Dashboard 轮询等待扫码结果]
- [ASSUMPTION: 平台代号 → Secret 名映射固定：`douyin`→`DOUYIN_COOKIES`，`kuaishou`→`KUAISHOU_COOKIES`，以此类推]
- [ASSUMPTION: 7 个新增平台 qr-bind handler 的登录成功检测均以"URL 离开 /login"为准，与 qr-bind-douyin.ts 模式一致]

## 预期受影响文件

- `apps/dashboard/src/pages/OperatorPage.tsx`：主号行添加"登录"按钮 + 调 /bind-start + 展示 updatedAt
- `apps/api/src/routes/operator-sessions.ts`（新建）：upload-cookies + bind-start + status 三个端点
- `scripts/sessions/check-health.js`：`secretEnv` 从 `*_MAIN` → `*_COOKIES` + missing=ok 修复
- `.github/workflows/session-health-check.yml`：Secret 引用 `*_MAIN` → `*_COOKIES`
- `services/agent/src/handlers/qr-bind-kuaishou.ts`（新建）
- `services/agent/src/handlers/qr-bind-xiaohongshu.ts`（新建）
- `services/agent/src/handlers/qr-bind-shipinhao.ts`（新建）
- `services/agent/src/handlers/qr-bind-toutiao.ts`（新建）
- `services/agent/src/handlers/qr-bind-weibo.ts`（新建）
- `services/agent/src/handlers/qr-bind-zhihu.ts`（新建）
- `services/agent/src/handlers/qr-bind-gongzhonghao.ts`（新建）
- `.github/workflows/scripts/smoke/session-health-medium-smoke.sh`（新建）

## journey_type: user_facing
## journey_type_reason: 核心路径从 Dashboard `/operator` 页面"登录"按钮触发，含用户可见 UI 交互
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E → GitHub Actions windows-latest runner（ZenithJoy E2E 死规则）
