# Sprint Contract Draft (Round 2) — WS2 Sprint 2.1a

**Sprint**：客户首次成功路径 thin 加固第一段（修架构 + 抖音 video 真发 + Lead 自验）
**journey_type**：user_facing
**PRD**：`sprints/sprint-c-ws2-douyin-real-publish/sprint-prd.md`（v3）

## Golden Path

[全新邮箱客户] → 注册 → 安装 + Agent → 画像 → **扫码绑抖音** → 选本地视频 → **真发到抖音公网** → 客户在手机抖音看见自己的视频

---

### Step 1: 注册（沿用 thin，本 sprint 不改）

**可观测行为**：客户用全新邮箱注册成功，自动签发 free license + free tenant，登录态可拉个人信息。

**验证命令**：
```bash
TEST_EMAIL="smoke-$(date +%s)@zenithjoy.test"
SIGNUP_RESP=$(curl -fsS -c /tmp/sk.cookies -X POST "$API_BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Smoke!Test2026\",\"name\":\"smoke\"}")
echo "$SIGNUP_RESP" | jq -e '.user.id' >/dev/null || exit 1
ME=$(curl -fsS -b /tmp/sk.cookies "$API_BASE/api/account/me")
echo "$ME" | jq -e '.license.tier == "free"' >/dev/null || exit 1
```

**硬阈值**：sign-up 返回 user.id（200 OK）+ /api/account/me 返回 license.tier=free + license_key 非空，全程 ≤ 2s。

---

### Step 2: 装客户端 + Agent 自动连中台（沿用 thin，本 sprint 不改）

**可观测行为**：Agent 进程启动后 ≤30s 调用 `/api/agent/heartbeat`，返回 200 + 任务列表。

**验证命令**：
```bash
LICENSE_KEY=$(echo "$ME" | jq -r '.license.license_key')
HB=$(curl -fsS -X POST "$API_BASE/api/agent/heartbeat" \
  -H 'content-type: application/json' \
  -H "x-license-key: $LICENSE_KEY" \
  -d '{"machine_id":"smoke-machine-001","agent_version":"0.1.8"}')
echo "$HB" | jq -e '.tasks | type == "array"' >/dev/null || exit 2
```

**硬阈值**：heartbeat 200 OK + tasks 是数组。

---

### Step 3: 画像诊断（沿用 thin，本 sprint 不改）

**可观测行为**：客户填 industry / audience / style 3 字段 → DB 写入，画像可读回。

**验证命令**：
```bash
curl -fsS -b /tmp/sk.cookies -X POST "$API_BASE/api/profile" \
  -H 'content-type: application/json' \
  -d '{"industry":"美妆","audience":"宝妈","style":"亲切"}' | jq -e '.ok' >/dev/null || exit 3
```

**硬阈值**：返回 .ok=true。

---

### Step 4: 扫码绑定抖音（**本 sprint Feature 7 新增**）

**可观测行为**：
- 客户在 Dashboard 点击「绑定抖音」→ 中台生成 `qr_bind:douyin` 任务写 publish_tasks 表
- Agent 拉到任务后启动浏览器打开抖音登录页，截屏 QR 二维码 → 通过 Agent → 中台 → Dashboard 推回客户视野
- 客户用手机抖音 App 扫码 → Agent 检测到登录成功 → cookie 落 Agent 本地工作目录（`~/.zenithjoy/cookies/douyin.json` 或类似，**不入库不上传**）
- 中台 publish_tasks 该绑定任务 status=completed

**验证命令**（CI 用 mock 浏览器；lead 自验跑真扫码）：
```bash
# CI: 模拟 Agent 上报"扫码成功"
TASK_ID=$(curl -fsS -b /tmp/sk.cookies -X POST "$API_BASE/api/publish/task" \
  -H 'content-type: application/json' \
  -d '{"platform":"qr_bind:douyin","payload":{}}' | jq -r '.task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || exit 4
# 模拟 Agent 完成任务回写
curl -fsS -X POST "$API_BASE/api/agent/task/$TASK_ID/complete" \
  -H "x-license-key: $LICENSE_KEY" \
  -H 'content-type: application/json' \
  -d '{"status":"completed","result":{"qr_login":"success","cookie_local_path":"~/.zenithjoy/cookies/douyin.json"}}' | jq -e '.ok' >/dev/null || exit 4
# 验证 result 中 cookie_local_path 字段存在（证明走的扫码路径，不是预置）
psql "$DB" -tAc "SELECT result->>'cookie_local_path' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID' AND result->>'qr_login' = 'success';" | grep -q '/cookies/douyin' || exit 4
```

**硬阈值**：
- task 创建成功（task_id 非空）
- Agent complete 端点返回 .ok
- DB 中 result JSONB 有 cookie_local_path 字段 + 值含 `/cookies/douyin`
- **CI 不接受预置 cookie 跳过 — Agent task type 必须是 `qr_bind:douyin`**

---

### Step 5: 准备视频（沿用 thin — 本地文件夹方案，本 sprint 不动）

**可观测行为**：客户在 Dashboard 指定本地视频路径 + 标题 + 标签，前端校验文件存在。

**验证命令**：
```bash
# 本步骤 thin 实现是前端表单 + 路径校验，本 sprint 无改动；smoke 直接构造数据进入 Step 6
VIDEO_PATH="/tmp/smoke-test.mp4"
[ -f "$VIDEO_PATH" ] || dd if=/dev/zero of="$VIDEO_PATH" bs=1024 count=10 2>/dev/null
[ -s "$VIDEO_PATH" ] || exit 5
```

**硬阈值**：视频文件可读（CI 中是 fixture）。

---

### Step 6: 中台派任务 + Agent 路由 + 真发抖音 video + 回执（**本 sprint 核心**）

**可观测行为**：
- 客户点 Dashboard「发布」→ 中台 createPublishTask 写 `publish_tasks {platform:douyin, type:video, payload:{video_path, title, tags}}`
- DB 表 `publish_tasks` 必有 `type` 字段（**Feature 1**），写入时**禁止 NULL**
- Agent heartbeat 拉到任务后，路由层 `resolveDouyinScriptPath()` 读 type 字段 → spawn `publish-douyin-video.cjs`（**Feature 3 修硬编码 bug**）
- video 脚本启动后检查 cookie：未登录则弹扫码窗（**Feature 5 + 6 共享扫码模块**），否则走真发流程
- CI 跑 dryrun 版（`publish-douyin-video-dryrun.cjs`）填字段到"等待发布按钮"页停下；lead 自验跑真发版到抖音公网
- 发布成功 → Agent 抓抖音视频 URL 回写 `publish_tasks.result.video_url`，status=completed
- 失败（含 type 找不到脚本、cookie 失效、视频文件不存在）→ Agent 显式回写 status=failed + reason，**严禁 fallback image**

**验证命令**：
```bash
# 1. 中台创建 type=video 抖音任务
TASK_ID=$(curl -fsS -b /tmp/sk.cookies -X POST "$API_BASE/api/publish/task" \
  -H 'content-type: application/json' \
  -d "{\"platform\":\"douyin\",\"type\":\"video\",\"payload\":{\"video_path\":\"$VIDEO_PATH\",\"title\":\"smoke-$(date +%s)\",\"tags\":[\"test\"]}}" | jq -r '.task_id')
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] || exit 6

# 2. DB 中 type 字段被持久化（防止中台吞 type）
DB_TYPE=$(psql "$DB" -tAc "SELECT type FROM zenithjoy.publish_tasks WHERE id='$TASK_ID';")
[ "$DB_TYPE" = "video" ] || { echo "FAIL: DB type='$DB_TYPE' expected 'video'"; exit 6; }

# 3. 模拟 Agent 拉任务 + 路由 + 跑 dryrun（CI 用 ZENITHJOY_AGENT_REAL_PUBLISH=0）
ZENITHJOY_AGENT_REAL_PUBLISH=0 node services/agent/dist/cli/run-task.js --task-id "$TASK_ID" 2>&1 | tee /tmp/agent.log
# 验证 stdout 含 type=video → spawn video 脚本（不是 image）
grep -E "type=video.*publish-douyin-video(-dryrun)?\.cjs" /tmp/agent.log || { echo "FAIL: agent didn't route by type"; exit 6; }
# 验证没误跑 image
! grep -E "spawn.*publish-douyin-image" /tmp/agent.log || { echo "FAIL: agent fell back to image"; exit 6; }

# 4. Agent 回写 status=completed + 创建时间窗口防造假（5 分钟内写入）
RESULT=$(psql "$DB" -tAc "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID' AND updated_at > NOW() - interval '5 minutes';")
[ "$RESULT" = "completed" ] || { echo "FAIL: status='$RESULT'"; exit 6; }

# 5. 反向测试：type=article（无脚本）必须 failed 不 fallback
ART_ID=$(curl -fsS -b /tmp/sk.cookies -X POST "$API_BASE/api/publish/task" \
  -H 'content-type: application/json' \
  -d "{\"platform\":\"douyin\",\"type\":\"article\",\"payload\":{}}" | jq -r '.task_id')
ZENITHJOY_AGENT_REAL_PUBLISH=0 node services/agent/dist/cli/run-task.js --task-id "$ART_ID" 2>&1 | tee /tmp/agent-art.log || true
ART_STATUS=$(psql "$DB" -tAc "SELECT status FROM zenithjoy.publish_tasks WHERE id='$ART_ID';")
[ "$ART_STATUS" = "failed" ] || { echo "FAIL: type=article 应 failed 实际='$ART_STATUS'"; exit 6; }
grep -qE "(no script for type|unsupported type)" /tmp/agent-art.log || { echo "FAIL: 无显式错误"; exit 6; }
! grep -E "spawn.*publish-douyin-image" /tmp/agent-art.log || { echo "FAIL: article fell back to image"; exit 6; }
```

**硬阈值**：
- 任务创建 + DB.type='video' 持久化
- agent.log 含 `type=video → publish-douyin-video*.cjs`，不含 `spawn publish-douyin-image*`
- task.status=completed（5 分钟时间窗口）
- type=article 反向测试：status=failed + 错误信息含 unsupported / no script，**不能 fallback image**

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**：
```bash
#!/bin/bash
set -e

export API_BASE="${API_BASE:-http://localhost:3001}"
export DB="${DB:-postgresql://localhost/zenithjoy}"
export VIDEO_PATH="${VIDEO_PATH:-/tmp/smoke-test.mp4}"

# 跑升级后的 smoke（本 sprint 必须更新 golden-path-1-smoke.sh 让它支持 type=video Step 6）
bash .github/workflows/scripts/smoke/golden-path-1-smoke.sh
SMOKE_EXIT=$?
[ "$SMOKE_EXIT" -eq 0 ] || { echo "smoke failed at step $SMOKE_EXIT"; exit 1; }

# 加固：直接对 DB 反查防 smoke 自欺
psql "$DB" -tAc "SELECT count(*) FROM zenithjoy.publish_tasks WHERE type='video' AND platform='douyin' AND status='completed' AND created_at > NOW() - interval '15 minutes';" | awk '$1 < 1 {exit 1}'

# 加固：验证 type=article 反向用例没 fallback
psql "$DB" -tAc "SELECT count(*) FROM zenithjoy.publish_tasks WHERE type='article' AND platform='douyin' AND status='failed' AND result->>'reason' ILIKE '%unsupported%' AND created_at > NOW() - interval '15 minutes';" | awk '$1 < 1 {exit 1}'

echo "✅ Golden Path 端到端验证通过（含 type=video 真路由 + type=article 不 fallback）"
```

**通过标准**：脚本 exit 0；DB 反查 video completed ≥ 1 + article failed-with-reason ≥ 1。

**Lead 自验补充**（Evaluator 必须验证 evidence 文件存在）：
```bash
[ -f .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md ] || exit 1
grep -qE "https?://(www\.)?(douyin|iesdouyin)\.com/" .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md || exit 1
grep -qE "扫码|qr|QR" .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md || exit 1
# 严禁预置 cookie 痕迹
! grep -qiE "preset.*cookie|预置.*cookie|cookie.*preloaded" .agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md || { echo "FAIL: evidence 含预置 cookie 痕迹"; exit 1; }
```

---

## Workstreams

workstream_count: 5

### Workstream 1: DB migration + 中台 createPublishTask 加 type 字段

**范围**：
- 新建 migration `apps/api/db/migrations/2026MMDDHHMMSS_publish_tasks_add_type.sql`：加 `type TEXT NOT NULL CHECK (type IN ('video','image','article'))` 字段（已有数据 default 'image' 单独 backfill 步骤）
- 修改 `apps/api/src/services/walking-skeleton.service.ts:223` `createPublishTask()`：接 `type` 参数，写入 DB
- 修改 `apps/api/src/routes/publish.ts`（或 publish-task.ts，由 Generator 定位）：API payload 接 type，做白名单校验
- 后端 zod / 类型定义同步加 type

**大小**：M（150-200 行）
**依赖**：无

**BEHAVIOR 覆盖测试文件**：`tests/ws1/publish-task-type.test.ts`

---

### Workstream 2: Agent 路由按 type 重写 + 错误回写

**范围**：
- 重写 `services/agent/src/handlers/douyin-publish.ts:55` `resolveDouyinScriptPath()`：接 type 参数 → 拼接 `publish-douyin-${type}{,-dryrun}.cjs` → 检查文件存在 → 不存在抛 `Error('no script for type ${type} on platform douyin')`
- 修改 `services/agent/src/handlers/douyin-publish.ts:292+` `handleDouyinPublishTask()`：从 task.type 读取（不再硬编码）+ 失败时通过 onTaskComplete 回写 status=failed + reason
- 4 环节日志：在 createPublishTask（中台）、heartbeat onTask（Agent 拉到时）、resolveDouyinScriptPath、spawn 处各打 `console.log("[type-route] type=${type}")`，便于排查

**大小**：M（120-180 行）
**依赖**：WS1（需要 publish_tasks.type 字段写入存在）

**BEHAVIOR 覆盖测试文件**：`tests/ws2/douyin-route.test.ts`

---

### Workstream 3: 抖音 video dryrun + 真发脚本 + image 加扫码

**范围**：
- 新建 `services/agent/publishers/douyin-publisher/lib/qr-login.cjs`：扫码登录共享模块（`requireLogin(page) → if(!loggedIn) showQrAndWait()`）
- 新建 `services/agent/publishers/douyin-publisher/publish-douyin-video.cjs`：真发视频，调 qr-login 模块
- 新建 `services/agent/publishers/douyin-publisher/publish-douyin-video-dryrun.cjs`：真填字段、点到"等待发布按钮"页 stop
- 修改 `services/agent/publishers/douyin-publisher/publish-douyin-image.cjs`：改用 qr-login 模块（替换原"假设已登录"代码段，必填 `replaces_old_thin`）

**大小**：L（300-400 行 + Playwright 选择器）
**依赖**：WS2（需要路由能 spawn 这些脚本，否则脚本永远跑不到）

**BEHAVIOR 覆盖测试文件**：
- `tests/ws3/qr-login.test.cjs`（mock browser）
- `tests/ws3/publish-douyin-video-dryrun.test.cjs`（spawn 验 stdout）

---

### Workstream 4: 抖音首次扫码绑定 UI + 任务路由

**范围**：
- Dashboard 加「绑定抖音」按钮 + 状态展示组件（待 Generator 定位 apps/dashboard 路径）
- 触发后调 `POST /api/publish/task {platform: "qr_bind:douyin"}` → 中台写任务 → Agent 拉到走 qr-login.cjs 弹码 → 截屏 QR 通过 task.result 推回 Dashboard 显示
- Dashboard 轮询 task status，扫码成功后绿勾 + 隐藏 QR

**大小**：M（150-250 行 React + 后端路由扩展）
**依赖**：WS3（需要 qr-login 模块 + agent task type `qr_bind:douyin` 路由）

**BEHAVIOR 覆盖测试文件**：`tests/ws4/qr-bind-douyin-flow.test.ts`（vitest + supertest，验后端流程；UI 由 lead 自验覆盖）

---

### Workstream 5: smoke 升级 + Lead 自验 template + evidence 模板

**范围**：
- 升级 `.github/workflows/scripts/smoke/golden-path-1-smoke.sh`：Step 4 用 qr_bind:douyin、Step 6 用 type=video，加 type=article 反向测试
- 新建 `.agent-knowledge/golden-path-1/lead-acceptance-template.md`：通用 lead 自验模板（后续 sprint 复用）
- 新建 `.agent-knowledge/golden-path-1/lead-acceptance-sprint-2.1a.md`：本 sprint evidence 占位模板（lead 自验后 fill in 真实 stdout / URL / 截图路径）
- 新建 `.github/workflows/lead-acceptance-check.yml`（或加到现有 CI）：CI 校验 evidence 文件存在 + 含抖音 URL + 含扫码痕迹 + 不含预置 cookie 字眼

**大小**：S（80-150 行 bash + markdown + yaml）
**依赖**：WS4（lead 自验需要全链路通才能跑）

**BEHAVIOR 覆盖测试文件**：`tests/ws5/lead-acceptance-validator.test.ts`（vitest 测 evidence 校验逻辑）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据（commit 1 的 Red） |
|---|---|---|---|
| WS1 | `tests/ws1/publish-task-type.test.ts` | (a) DB migration 后 publish_tasks 有 type 字段 not null check IN (video/image/article) (b) createPublishTask({type:'video'}) 持久化 type='video' (c) 缺 type 参数 → 422 / 缺省 image (d) type='banana' → 422 invalid value | 4 个 it block 全 fail（migration 不存在、createPublishTask 不接 type） |
| WS2 | `tests/ws2/douyin-route.test.ts` | (a) resolveDouyinScriptPath({type:'video',real:false}) → 'publish-douyin-video-dryrun.cjs' 路径 (b) resolveDouyinScriptPath({type:'video',real:true}) → 'publish-douyin-video.cjs' (c) resolveDouyinScriptPath({type:'article'}) 抛 Error 含 'no script for type article' (d) handleDouyinPublishTask 失败时调用 onTaskComplete({status:'failed', reason:...}) | 4 个 it block fail（函数仍硬编码 image） |
| WS3 | `tests/ws3/qr-login.test.cjs` + `tests/ws3/publish-douyin-video-dryrun.test.cjs` | (a) qr-login 未登录时 throw 'NEED_QR' + 截屏 QR (b) 已登录直接 return (c) video-dryrun spawn 后 stdout 含"等待发布按钮"+ exit 0 (d) video-dryrun 不真点发布按钮 | 4 个 it block fail（脚本不存在） |
| WS4 | `tests/ws4/qr-bind-douyin-flow.test.ts` | (a) POST /api/publish/task {platform:'qr_bind:douyin'} 写入任务 status=queued (b) Agent complete 时 result 含 cookie_local_path → DB 更新 (c) Dashboard 轮询能拿到 result.qr_screenshot 字段 | 3 个 it block fail（路由 / 字段未实现） |
| WS5 | `tests/ws5/lead-acceptance-validator.test.ts` | (a) evidence 文件不存在 → exit 1 (b) 文件含抖音 URL + 扫码字眼 → exit 0 (c) 文件含 'preset cookie' 字眼 → exit 1 (d) smoke step 6 跑 type=video 不跑 image | 4 个 it block fail（validator 不存在 / smoke 仍 image） |

---

## Risks（Round 2 新增 — Reviewer feedback r1 要求）

| # | Risk | 触发概率 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | **抖音风控**：自动化发布触发账号封禁 / 登录频控 | 中 | sprint 验收 evidence 拿不到真公网 URL | (a) lead 自验只发 1 条视频，不重复跑 (b) lead 用自己的小号不用主号 (c) PRD ASSUMPTION 5 已规定 evidence 标准降级条款：风控时接受"真发布请求 + 抖音返回处理中状态"代替"真视频公网可见" |
| R2 | **xian-pc 临时离线**：lead 自验时 Tailscale 不通 | 低-中 | lead 自验跑不动，sprint 卡 | (a) Lead 自验 checklist Step 1 强制 `ssh xian-pc 'echo ok'` 健康检查，不通即停（不允许 fake pass）(b) 如果连续 24h 不通，evidence 文件标记 BLOCKED + 告知用户排查 |
| R3 | **抖音 UI 改版**：Playwright 选择器失效（class 名 hash 变 / DOM 结构调整） | 中-高（半年内必发生） | video / image 脚本静默失败或执行错位 | (a) ws3 video/image 脚本必须用 robust 选择器优先级：`data-testid > aria-label > role > text content > class`；class 选择器禁用（已知会变） (b) 选择器失败时调用 page.screenshot() 截屏存 `~/.zenithjoy/agent-fail-screenshots/<task-id>.png`，让 lead 看 (c) 失败回写 reason 含 "selector failed at <step>"，不允许吞错 |
| R4 | **lead 扫码超时**：lead 手机不在身边 / 抖音 App 没装 | 中 | qr-login 永久卡住 | (a) qr-login waitForSelector timeout = 90s（不是默认 30s 也不是无限） (b) timeout 错误信息含 "请在 90 秒内用手机抖音 App 扫码" (c) 超时后 cookie 不写盘，下次重试不会用残留 |
| R5 | **video 文件路径 Windows 兼容性**：xian-pc 是 Windows，路径含反斜杠 / 中文名 / 空格 | 中 | publish_task.payload.video_path 在 Agent 端解析失败 | (a) ws1 中台 zod schema 接受 video_path 时 normalize 到 forward slash (b) ws3 video 脚本启动前 `fs.statSync(video_path)` 检查存在 + 可读，不存在显式 failed 不静默 (c) lead 自验时用 ASCII 路径如 `C:/zenithjoy-test/sample.mp4`，不用中文目录 |

**Cascade 失败处理**：以上 5 条 risk 任一触发 → Agent 回写 publish_task.status=failed + result.reason + result.risk_id (R1-R5)，**严禁** Agent 内部 fallback 或 silent retry。Lead 自验 evidence 应明确记录哪条 risk 触发 + 截图 + 处理决定。
