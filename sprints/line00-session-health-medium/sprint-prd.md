# Sprint PRD — 运营中枢 Session 一键登录 + 真实健康巡检（thin→medium）

## OKR 对齐

- **对应 KR**：KR-OPS1（运营自动化基础设施）
- **当前进度**：~15%（抖音单平台 thin 已有，GHA 存在 missing=ok bug 和 Secret 命名错位）
- **本次推进预期**：~55%

## 背景

现有 zj-ops1-session-health 存在两个 blocking 问题：GHA 的 check-health.js 把 `missing` 状态当 `ok` 处理（掉线无告警）；Secret 命名混用 `*_MAIN` 而非标准 `{PLATFORM}_COOKIES`。本次升级 medium：新增一键登录（Dashboard → xian-pc Agent 扫码 → cookie 自动写入 GitHub Secrets）+ GHA 真实 HTTP 验证 4x/日 + 飞书过期告警 + Dashboard 状态矩阵。

## Golden Path

入口：运营员打开 Dashboard 运营中枢页，看到 8 平台主号状态矩阵

**首次绑定**：

1. 点「抖音主号 → 登录」→ Dashboard POST `/api/operator/sessions/trigger-bind {platform:"douyin"}` → 202 + taskId
2. 中台推 task `qr_bind/douyin` 给 xian-pc Agent（现有 Agent WS 协议）
3. Agent CDP 连本地 Chrome(19222) → 导航 creator.douyin.com → 等待扫码
4. 运营员手机扫码 → 登录成功 → Agent 检测 URL 离开 /login
5. Agent 抓 storageState → POST `/api/operator/sessions/upload-cookies {platform, cookies}` → 200
6. 后端调 GitHub Octokit 写 `DOUYIN_COOKIES` Secret → DB 写 active
7. Dashboard 状态轮询 GET `/api/operator/sessions` → 展示 ✅ 绿色

出口：`DOUYIN_COOKIES` Secret 更新 + Dashboard 该行状态变为 active

**GHA 日常巡检**（4x/日，cron）：

1. 读 `*_COOKIES` Secrets → 真实 HTTP 调各平台 creator API
2. 有效 → active；401/重定向 → expired
3. POST `/api/operator/sessions/status` 批量回写 DB
4. expired 条目 → 飞书 Bot webhook 推送告警

**过期恢复**：Dashboard 展示 🔴 + lastValidAt → 点「重新登录」→ 重复首次绑定 Step 1–7

## Response Schema

### POST /api/operator/sessions/trigger-bind

**Body**: `{"platform": "douyin"|"kuaishou"|"xiaohongshu"|"shipinhao"|"toutiao"|"weibo"|"zhihu"|"gongzhonghao"}`

**Success (HTTP 202)**:
```json
{"ok": true, "taskId": "<string>", "platform": "<string>"}
```
- `taskId`：Agent 任务 ID，**禁用** `id`/`task`/`jobId`/`requestId`
- 顶层 keys 完全等于 `["ok","platform","taskId"]`

**Error (HTTP 400)**:
```json
{"error": "<string>"}
```
禁用 `message`/`msg`/`reason`

---

### POST /api/operator/sessions/upload-cookies

**Body**: `{"platform": "<string>", "cookies": <object>}`

**Success (HTTP 200)**:
```json
{"ok": true, "secretName": "DOUYIN_COOKIES", "platform": "douyin"}
```
- `secretName` 命名规则：`{PLATFORM_UPPER}_COOKIES`，**禁用** `*_MAIN`/`*_SESSION`/`*_TOKEN`
- 顶层 keys 完全等于 `["ok","platform","secretName"]`

**Error (HTTP 400/403)**:
```json
{"error": "<string>"}
```

---

### GET /api/operator/sessions

**Success (HTTP 200)** — JSON array：
```json
[
  {
    "platform": "douyin",
    "secretName": "DOUYIN_COOKIES",
    "status": "active",
    "lastCheckedAt": "2026-05-27T10:00:00Z",
    "lastValidAt": "2026-05-27T10:00:00Z"
  }
]
```
- `status` 枚举：`active`/`expired`/`missing`，**禁用** `ok`/`healthy`/`valid`/`inactive`/`error`
- 顶层 array，每项 keys 完全等于 `["lastCheckedAt","lastValidAt","platform","secretName","status"]`
- 固定返回 8 条（8 个平台主号），无数据时 `lastCheckedAt`/`lastValidAt` 为 `null`

---

### POST /api/operator/sessions/status（GHA 回写专用，internal-auth 守卫）

**Body**: `{"updates": [{"platform":"<string>","status":"active"|"expired","checkedAt":"<ISO8601>"}]}`

**Success (HTTP 200)**:
```json
{"ok": true, "updated": <number>}
```
- 顶层 keys 完全等于 `["ok","updated"]`

## 边界情况

- `GH_SECRETS_WRITE_PAT` scope 不足 → upload-cookies 返 HTTP 403 `{"error":"PAT scope insufficient"}`
- Agent 扫码超时（>5min）→ task 标 failed，Dashboard 不变状态，运营员需手动重试
- 飞书 webhook 超时（>3s）→ `Promise.race` catch，log + continue，不阻塞 GHA 主流程
- Agent 上传 cookies 时 API 不可达 → Agent 本地 fallback 写 `~/.zenithjoy-agent/sessions/{platform}/default.json`，任务标 partial

## 范围限定

**在范围内**：8 平台主号（抖音/快手/小红书/视频号/头条/微博/知乎/公众号）；Secret 命名修正（*_MAIN → *_COOKIES）；Dashboard 状态矩阵 + 登录按钮；Agent 8 平台 qr-bind handler；GHA 真实 HTTP 验证；飞书告警

**不在范围内**：4 个小号绑定；Bark 推送；视频号/公众号微信 OAuth 特殊处理；Session 自动续期；多 Agent 并发扫码

## 假设

- [ASSUMPTION: GH_SECRETS_WRITE_PAT 含 secrets write scope — 需前置手动配置并存入 GHA Secrets]
- [ASSUMPTION: xian-pc Agent 在线并可接收 task `qr_bind/*`（WS 协议已就绪）]
- [ASSUMPTION: FEISHU_BOT_WEBHOOK 已存在于 GHA Secrets]
- [ASSUMPTION: operator_sessions 表需新建 DB migration（现无此表）]
- [ASSUMPTION: 各平台 creator URL 用于 CDP 导航的路径参考 qr-bind-douyin.ts 现有实现]

## 预期受影响文件

- `apps/api/src/routes/operator-sessions.ts`: 新建（4 端点）
- `apps/api/src/app.ts`: 注册 operator-sessions 路由
- `db/migrations/YYYYMMDD_operator_sessions.sql`: 新建表
- `apps/dashboard/src/pages/OperatorPage.tsx`: 新建状态矩阵页
- `apps/dashboard/src/config/navigation.config.ts`: 注册 /operator 路由
- `services/agent/src/handlers/qr-bind-operator.ts`: 新建（8 平台统一 handler）
- `services/agent/src/index.ts`: 注册新 handler 到 dispatcher
- `.github/workflows/session-health-check.yml`: 修正 *_MAIN → *_COOKIES + 真实 HTTP + 飞书告警
- `scripts/sessions/check-health.js`: missing≠ok bug 修正 + expired 触发飞书

## journey_type: user_facing
## journey_type_reason: 核心入口是 apps/dashboard/ 运营中枢页，运营员通过 UI 触发一键登录和查看状态矩阵
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard E2E 规则 — GitHub Actions windows-latest runner 干净 VM，PrepPRD 已显式指定 windows_cloud
