# Sprint Contract Draft (Round 1) — Path 2 客户智能获客 · Sprint B-1 抖音小号绑定 + 评论区抓取

**Sprint**: Path 2 Sprint B-1 抖音小号 + 评论抓取
**Branch**: cp-05101622-path2-sprint-b1-prd
**Journey Type**: user_facing
**Walking Skeleton Path**: Path 2 客户智能获客 (Notion `35ac40c2-ba63-81ed-8df4-f3fa0b64f5bf`)
**推进**: Path 2 Step 5（抖音小号绑定）+ Step 6 part 1（评论抓取写飞书 Lead 表）→ thin done；Path 2 6 步全部 thin done → Maturity `not_started → skeleton`

---

## 架构决策（合同 GAN 必须 APPROVE 才能进 Phase 2）

**决策 A: 抖音公开评论必须 Agent CDP 抓，不能用 open API**
- 抖音 open platform（developer.open-douyin.com）面向第三方应用只开放：用户授权后的视频列表 / 视频统计 / 私信 / 客服。**评论列表 API 仅对认证企业号开放**（且需用户授权该号），ZenithJoy 走 burner 小号场景拿不到。
- 抖音创作者后台（creator.douyin.com）也无 app credentials flow（不像飞书）。
- 结论：**Agent 端 Playwright + CDP 加载视频页 + 解析 DOM** 抓评论，跟 Path 1 publisher 同模式。

**决策 B: `agent_platform_sessions` 加 `role` 字段（main/burner），不新建 `burner_sessions` 表**
- 现有 unique constraint `(agent_id, platform, account_label)` 已支持多 account_label。加 `role TEXT DEFAULT 'main'` 字段最小破坏。
- 客户在 dashboard 给小号起名（account_label），role 字段后端透明赋 `'burner'`。
- 新建 `burner_sessions` 表会破坏 Sprint A `_smoke-feishu-seed` 等已经 SELECT 该表的 query，且 schema 切换需迁移老数据。

**决策 C: Agent 端绑小号脚本——新建 `qr-bind-douyin-burner.ts`，不修改 `qr-bind-douyin.ts`**
- Path 1 主号绑定 `qr-bind-douyin.ts` 已稳定运行，**改动会撞 Path 1 既定行为**（既有 `task_type='qr_bind/douyin'` 不带 role 默认走 main）。
- 新建 `qr-bind-douyin-burner.ts` 处理新 task_type=`qr_bind/douyin_burner`，物理隔离 user-data-dir + sessionPath（`burner/<account_label>.json`）+ 写 DB role='burner'。
- 优点：Path 1 一行不动；CI grep 断言"Path 1 文件未改"可强校验。

**决策 D: Lead 表写飞书 Bitable，不写 ZenithJoy DB**
- 复用 Sprint A `feishu-bitable-multitenant.writeRecord(tenantId, table_id_leads, fields)`，不改 service 一字。
- 数据归客户（PRD 既定）。中台只做编排，不留数据。

**决策 E: 评论抓取在 Agent 端做 + 上报中台 + 中台写飞书**
- Agent 抓 5 条评论结构化（commenter_id / text / time）→ POST `/api/agent/burner/crawl-comments-result` 上报中台 → 中台 `lead-writer.ts` 调 multitenant Bitable writeRecord 5 次写飞书 Lead 表。
- 不让 Agent 直接调飞书 API（飞书 token 在中台，不暴露给 Agent；且 Agent 不知道客户飞书 binding）。

---

## Golden Path

```
[客户已完成 Sprint A 飞书绑定 + 在飞书填好对标视频 URL 1 行]
  → [Step 1: 客户在 dashboard 看到「绑抖音小号」入口（DouyinBurnerBindPage）]
  → [Step 2: 客户填小号 account_label + 点「开始绑定」→ 中台派 task `qr_bind/douyin_burner`]
  → [Step 3: Agent 弹独立 Chrome（user-data-dir 隔离）+ 跳抖音创作者后台扫码页]
  → [Step 4: 客户用专用小号手机扫码 → Agent 检测登录成功 → cookie 存 burner sessionPath]
  → [Step 5: 中台 agent_platform_sessions 写一行 platform=douyin role=burner status=active]
  → [Step 6: dashboard 显示「抖音小号已绑定 ✓」+ 「开始抓取评论」按钮可用]
  → [Step 7: 客户点「开始抓取评论」→ 中台 POST /api/agent/burner/crawl-comments → 派 task `crawl_comments/douyin`]
  → [Step 8: Agent 用 burner session 加载视频页 → 抓评论区前 5 条 → 上报中台]
  → [Step 9: 中台 lead-writer 调 Sprint A multitenant Bitable writeRecord 5 次写客户飞书 Lead 表]
  → [Step 10: dashboard 显示「抓取完成 5 条 → 看飞书 Lead 表」+ 飞书 Bitable 链接]
[出口: 客户飞书 Lead 表新增 5 行潜客记录]
```

---

### Step 1: 客户在 dashboard 看到「绑抖音小号」入口

**可观测行为**:
- 客户已完成 Sprint A 飞书绑定（`tenant_feishu_bindings.app_token` 非空）→ dashboard `/dashboard/douyin-burner-bind` 页可访问 + 「开始绑定」按钮 enabled。
- 未完成飞书绑定 → 同页面「开始绑定」按钮 disabled + 提示「请先完成飞书绑定」。

**验证命令**:
```bash
# 前置：建 tenant + 飞书 binding（_smoke-feishu-seed helper）
TENANT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-b1-${RANDOM}', 'smoke-b1-key-${RANDOM}', 'free') RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at) VALUES ('$TENANT_ID', 'fake_t_b1', NOW()+interval'1 hour', 'bascn_b1_app', 'tbl_b1_profile', 'tbl_b1_videos', 'tbl_b1_leads', NOW())"

# dashboard 渲染由 Playwright 测试覆盖；smoke 仅验后端 GET 返绑定状态
RESP=$(curl -fsS -X GET "$API_BASE/api/feishu/oauth/status" -H "X-Tenant-Id: $TENANT_ID")
echo "$RESP" | jq -e '.success == true and .data.bound == true' >/dev/null \
  || { echo "FAIL: 飞书绑定状态查询未返 bound=true"; exit 1; }
```

**硬阈值**:
- HTTP 200
- `data.bound = true`（前置 binding 写入后，dashboard 才允许访问绑小号入口）
- BEHAVIOR 测试 `tests/ws5/douyin-burner-bind-page.test.tsx` 覆盖 disabled / enabled 两态渲染

---

### Step 2: 客户提交 account_label → 中台派 task `qr_bind/douyin_burner`

**可观测行为**:
- POST `/api/agent/burner/qr-bind` body `{tenant_id, agent_id, account_label}` → 中台 `tasks` 表新增一行 `task_type='qr_bind/douyin_burner', payload={agent_id, account_label}, status='queued'`。
- 缺 `account_label` → 400 `{error:{code:'MISSING_ACCOUNT_LABEL'}}`。
- 同 `(agent_id, account_label)` 已存在 active burner session → 400 `{error:{code:'BURNER_ALREADY_BOUND'}}`（防重复绑）。

**验证命令**:
```bash
# 前置：注册一个 agent
AGENT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$TENANT_ID', 'mac-b1-${RANDOM}', 'rog-test', 'online') RETURNING id" | tr -d ' ')

# 触发绑定
RESP=$(curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\"}")

# 期望返回 task_id
TASK_ID_NEW=$(echo "$RESP" | jq -r '.data.task_id')
[ -n "$TASK_ID_NEW" ] && [ "$TASK_ID_NEW" != "null" ] || { echo "FAIL: 未返 task_id"; exit 1; }

# 验证 tasks 表写入（带时间窗口防造假）
COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE task_type='qr_bind/douyin_burner' AND created_at > NOW() - interval '60 seconds'")
[ "$COUNT" -ge "1" ] || { echo "FAIL: tasks 表未写入 (count=$COUNT)"; exit 1; }

# 缺 account_label 错误路径
ERR=$(curl -s -o /tmp/err.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\"}")
[ "$ERR" = "400" ] || { echo "FAIL: 缺 account_label 应返 400 got $ERR"; exit 1; }
jq -e '.error.code == "MISSING_ACCOUNT_LABEL"' /tmp/err.json >/dev/null \
  || { echo "FAIL: 错码非 MISSING_ACCOUNT_LABEL"; exit 1; }
```

**硬阈值**:
- HTTP 200 + `data.task_id` 非空 UUID
- `publish_tasks` 行 `task_type='qr_bind/douyin_burner'` 且 `created_at` 在最近 60s 内
- 错误路径返 400 + 正确错码
- 整步耗时 < 3s

---

### Step 3: Agent 弹独立 Chrome 跳抖音扫码页（user-data-dir 隔离）

**可观测行为** (Lead 客户机自验，CI 用 fake-agent stub):
- Agent 收 task `qr_bind/douyin_burner` → 调 `qr-bind-douyin-burner.ts` handler → 用 `launchPersistentContext` 启 Chrome（channel `msedge`，headless `true`），user-data-dir = Windows `C:\Temp\zj-douyin-burner-v1\<account_label>` 或 mac `~/.zenithjoy-agent/chrome-profile/douyin-burner/<account_label>` （**与 Path 1 主号 user-data-dir 物理隔离**）。
- Chrome 自动 `goto('https://creator.douyin.com/')` → 显示扫码登录页。

**验证命令** (CI 用 fake-agent stub 模拟 handler 调用):
```bash
# CI 不真启 Chrome；fake-agent 模拟 handler 行为：
# 1. 创建 user-data-dir 标识文件
# 2. 上报中台 task 进度 status='in_progress' + chrome_url='creator.douyin.com'

# 手动调 fake-agent helper 触发模拟绑定流程（CI 模式）
curl -fsS -X POST "$API_BASE/api/_smoke/fake-agent-burner-progress" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"phase\":\"chrome_launched\",\"user_data_dir\":\"/tmp/zj-burner-test/$AGENT_ID-装修小号1\",\"current_url\":\"https://creator.douyin.com/login\"}"

# 验证 task 进度写入
PHASE=$(psql "$DB" -t -A -c "SELECT response->>'phase' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW' AND updated_at > NOW() - interval '60 seconds'")
[ "$PHASE" = "chrome_launched" ] || { echo "FAIL: task phase != chrome_launched got '$PHASE'"; exit 1; }

# 验证 user-data-dir 与 Path 1 路径不同（grep handler 源代码断言）
grep -E "burner|burner-v1|chrome-profile/douyin-burner" services/agent/src/handlers/qr-bind-douyin-burner.ts \
  || { echo "FAIL: qr-bind-douyin-burner.ts 未含 burner 隔离路径"; exit 1; }
grep -E "qr-bind-douyin\.ts" services/agent/src/handlers/qr-bind-douyin-burner.ts \
  && { echo "FAIL: burner 不应 import 主号 handler"; exit 1; } || true
```

**硬阈值**:
- task `response.phase` = `chrome_launched`
- handler 源码含 burner 隔离路径
- handler 不引用 Path 1 主号 handler

---

### Step 4: 客户扫码 → cookie 存 burner sessionPath

**可观测行为** (Lead 客户机自验):
- 客户用专用小号手机扫码 → Playwright `waitForURL(url => !url.includes('/login'), {timeout: 10*60*1000})` 等跳转完成 → `context.storageState()` 拿 cookies → 写 `~/.zenithjoy-agent/sessions/douyin/burner/<account_label>.json`（**路径含 `/burner/` 子目录与 Path 1 main 隔离**）。
- 上报中台：POST `/api/agent/burner/qr-bind-result` body `{task_id, qr_login:'success', cookie_local_path}`。

**验证命令** (CI 用 fake-agent stub 模拟扫码完成):
```bash
# fake-agent 上报扫码完成
curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"agent_id\":\"$AGENT_ID\",\"qr_login\":\"success\",\"cookie_local_path\":\"/tmp/zj-burner-test/sessions/douyin/burner/装修小号1.json\",\"account_nickname\":\"装修达人小号\"}"

# 验证 task 完成
STATUS=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW' AND updated_at > NOW() - interval '60 seconds'")
[ "$STATUS" = "done" ] || { echo "FAIL: task 未 done, got '$STATUS'"; exit 1; }

# 验证 cookie 路径含 /burner/ 子目录（防与 main 混路径）
COOKIE_PATH=$(psql "$DB" -t -A -c "SELECT response->>'cookie_local_path' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID_NEW'")
echo "$COOKIE_PATH" | grep -q "/burner/" || { echo "FAIL: cookie path 未含 /burner/ 子目录: $COOKIE_PATH"; exit 1; }
```

**硬阈值**:
- task status = `done`
- `response.cookie_local_path` 含 `/burner/` 子目录
- handler 源码含 `waitForURL` 超时 ≥ 5min（实际客户去找手机时间）

**Lead 客户机自验段** (`lead-acceptance-sprint-b1.md`):
- xian-rog 真启 Chrome (channel msedge headless: true)
- 真扫码（user 物理操作）
- 截图二维码 + 扫码完成跳转 + cookie 文件落地

---

### Step 5: 中台 `agent_platform_sessions` 写一行 role=burner status=active

**可观测行为**:
- Step 4 上报后，中台同步在 `agent_platform_sessions` 表 INSERT 一行：`agent_id=$AGENT_ID, platform='douyin', account_label='装修小号1', role='burner', status='active', bound_at=NOW()`。
- migration 已加 `role TEXT NOT NULL DEFAULT 'main'` 列 + CHECK 约束 `role IN ('main','burner')`。
- unique constraint `(agent_id, platform, account_label)` 仍生效（不破坏 Path 1 main 行）。

**验证命令**:
```bash
# 验证 migration 列存在 + 默认值
ROLE_DEFAULT=$(psql "$DB" -t -A -c "SELECT column_default FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='agent_platform_sessions' AND column_name='role'")
echo "$ROLE_DEFAULT" | grep -q "'main'" || { echo "FAIL: role column 默认值非 'main', got '$ROLE_DEFAULT'"; exit 1; }

# 验证 burner session 写入
SESSION_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND platform='douyin' AND account_label='装修小号1' AND role='burner' AND status='active' AND created_at > NOW() - interval '60 seconds'")
[ "$SESSION_COUNT" = "1" ] || { echo "FAIL: agent_platform_sessions 未写入 burner 行 (count=$SESSION_COUNT)"; exit 1; }

# 验证 Path 1 main 行不撞 unique constraint（同 agent_id + platform + 不同 account_label 可共存）
psql "$DB" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status) VALUES ('$AGENT_ID', 'douyin', 'main_default', 'main', 'active')" >/dev/null
MAIN_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND platform='douyin'")
[ "$MAIN_COUNT" = "2" ] || { echo "FAIL: 同 agent 同平台 main + burner 应共存 (count=$MAIN_COUNT)"; exit 1; }
```

**硬阈值**:
- `role` 列存在 + 默认值 `'main'`
- burner session 行写入 < 60s 内
- 同 agent 同 platform 的 main + burner 行可共存（不撞 unique constraint）
- CHECK 约束拒绝 role NOT IN ('main','burner')（BEHAVIOR 测试覆盖）

---

### Step 6: dashboard 显示「抖音小号已绑定 ✓」+「开始抓取评论」按钮可用

**可观测行为**:
- GET `/api/agent/burner/sessions?tenant_id=$TENANT_ID` 返 `{success:true, data:{sessions:[{account_label,role:'burner',status:'active',account_nickname,bound_at}]}}`
- dashboard `DouyinBurnerBindPage` 渲染绑定列表 + 显示昵称
- dashboard 「开始抓取评论」按钮：客户飞书有对标视频（`fetchLeadConfig().target_videos.length > 0`）+ 至少 1 个 active burner session → enabled；否则 disabled + 提示。

**验证命令**:
```bash
RESP=$(curl -fsS "$API_BASE/api/agent/burner/sessions?tenant_id=$TENANT_ID")
echo "$RESP" | jq -e '.data.sessions | length >= 1' >/dev/null \
  || { echo "FAIL: 无 burner sessions"; exit 1; }
echo "$RESP" | jq -e '.data.sessions[0].role == "burner"' >/dev/null \
  || { echo "FAIL: session role 非 burner"; exit 1; }
echo "$RESP" | jq -e '.data.sessions[0].account_label == "装修小号1"' >/dev/null \
  || { echo "FAIL: session account_label 不匹配"; exit 1; }
```

**硬阈值**:
- HTTP 200
- `data.sessions[0]` 含 `role='burner'`, `status='active'`, `account_label`, `account_nickname`, `bound_at`
- BEHAVIOR 测试 `tests/ws5/douyin-burner-bind-page.test.tsx` 覆盖按钮 enabled/disabled

---

### Step 7: 客户点「开始抓取评论」→ 中台派 task `crawl_comments/douyin`

**可观测行为**:
- POST `/api/agent/burner/crawl-comments` body `{tenant_id, agent_id, account_label, video_url}` → 中台 `publish_tasks` INSERT `task_type='crawl_comments/douyin', payload={agent_id, account_label, video_url, tenant_id}, status='queued'`。
- 缺 `video_url` → 400 `MISSING_VIDEO_URL`。
- 客户该 agent 无 active burner session → 400 `NO_BURNER_SESSION`。
- 客户飞书未绑定（`tenant_feishu_bindings` 无行或 `app_token` 为空）→ 400 `FEISHU_NOT_BOUND`。

**验证命令**:
```bash
RESP=$(curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\",\"video_url\":\"https://www.douyin.com/video/7000000000000000001\"}")

CRAWL_TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')
[ -n "$CRAWL_TASK_ID" ] && [ "$CRAWL_TASK_ID" != "null" ] || { echo "FAIL: 未返 crawl task_id"; exit 1; }

# 验证 task 写入
COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE id='$CRAWL_TASK_ID' AND task_type='crawl_comments/douyin' AND status='queued' AND created_at > NOW() - interval '60 seconds'")
[ "$COUNT" = "1" ] || { echo "FAIL: crawl task 未写入"; exit 1; }

# 错误路径：缺 video_url
ERR=$(curl -s -o /tmp/err.json -w '%{http_code}' -X POST "$API_BASE/api/agent/burner/crawl-comments" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\"}")
[ "$ERR" = "400" ] || { echo "FAIL: 缺 video_url 应返 400 got $ERR"; exit 1; }
jq -e '.error.code == "MISSING_VIDEO_URL"' /tmp/err.json >/dev/null \
  || { echo "FAIL: 错码非 MISSING_VIDEO_URL"; exit 1; }
```

**硬阈值**:
- HTTP 200 + `data.task_id` 非空
- `publish_tasks` 行 `task_type='crawl_comments/douyin'` 且 `status='queued'`
- 3 个错误路径分别返 400 + 对应错码

---

### Step 8: Agent 用 burner session 抓评论区前 5 条 + 上报中台

**可观测行为** (Lead 客户机自验，CI 用 fake-agent stub):
- Agent 收 task → 调 `services/agent/scripts/douyin-comment-crawl.cjs` → `launchPersistentContext` 用 burner user-data-dir → `goto(video_url)` → 等评论区加载（`waitForSelector('[data-e2e="comment-item"]', {timeout: 30000})`）→ 解析 DOM 取前 5 条（commenter_id / text / publish_time）。
- 上报：POST `/api/agent/burner/crawl-comments-result` body `{task_id, comments:[{commenter_id, text, publish_time}], video_url}`。
- 边界：评论区为空 → `comments:[]` + 中台不写 Lead 表 + dashboard 显示"该视频暂无评论"。
- 边界：burner session 失效（页面跳登录）→ `error_code:'BURNER_SESSION_EXPIRED'` 上报。

**验证命令** (CI fake-agent 模拟):
```bash
# fake-agent 上报 5 条评论
curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$CRAWL_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"video_url\":\"https://www.douyin.com/video/7000000000000000001\",\"comments\":[{\"commenter_id\":\"@douyin_user_001\",\"text\":\"求联系方式\",\"publish_time\":\"2026-05-10T10:00:00Z\"},{\"commenter_id\":\"@douyin_user_002\",\"text\":\"装修预算多少\",\"publish_time\":\"2026-05-10T10:01:00Z\"},{\"commenter_id\":\"@douyin_user_003\",\"text\":\"小户型适用吗\",\"publish_time\":\"2026-05-10T10:02:00Z\"},{\"commenter_id\":\"@douyin_user_004\",\"text\":\"想看完整方案\",\"publish_time\":\"2026-05-10T10:03:00Z\"},{\"commenter_id\":\"@douyin_user_005\",\"text\":\"在哪个城市\",\"publish_time\":\"2026-05-10T10:04:00Z\"}]}"

# 验证 task done
STATUS=$(psql "$DB" -t -A -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$CRAWL_TASK_ID' AND updated_at > NOW() - interval '60 seconds'")
[ "$STATUS" = "done" ] || { echo "FAIL: crawl task 未 done, got '$STATUS'"; exit 1; }

# 验证脚本 SSOT 文件存在 + 含关键 selector
[ -f services/agent/scripts/douyin-comment-crawl.cjs ] || { echo "FAIL: crawl 脚本不存在"; exit 1; }
grep -E "data-e2e=\"comment-item\"|comment-item" services/agent/scripts/douyin-comment-crawl.cjs \
  || { echo "FAIL: crawl 脚本缺 selector"; exit 1; }
grep "launchPersistentContext" services/agent/scripts/douyin-comment-crawl.cjs \
  || { echo "FAIL: crawl 脚本未用 launchPersistentContext"; exit 1; }
```

**硬阈值**:
- task status = `done`
- crawl 脚本存在 + 含 `comment-item` selector + `launchPersistentContext`
- 上报含 5 条结构化评论（commenter_id / text / publish_time 三字段必填）

**Lead 客户机自验段**:
- xian-rog 真访问抖音视频 URL（user 提供真实链接）
- 真抓 5 条 + 截图证据

---

### Step 9: 中台 lead-writer 调 multitenant Bitable writeRecord 5 次写客户飞书 Lead 表

**可观测行为**:
- Step 8 上报触发中台 `lead-writer.ts` 服务（**复用 Sprint A `feishu-bitable-multitenant.writeRecord(tenantId, table_id_leads, fields)` 不重写**）。
- 5 条评论 → 5 次 writeRecord 调用 → 飞书 Lead 表 5 行（按 PRD 数据模型 5 个字段：评论者抖音 ID / 评论内容 / 来源视频 URL / 抓取时间 / 状态='已抓取'）。
- 任一 writeRecord 失败（飞书 token 过期 / API 超时）→ 中台按 Sprint A `getValidToken` 自动续 token + 重试（**复用 Sprint A 已有重试逻辑，本 sprint 不实现新重试**）。
- 重试 2 次后仍失败 → 上报 dashboard `lead_write_status='failed'`。
- 评论数 = 0 → lead-writer 不调 writeRecord（早 return） → 中台标记 `comment_count=0` → dashboard 显示"该视频暂无评论"。

**验证命令** (CI 验飞书 fake-server 收到 5 次 records POST):
```bash
# Step 8 已上报 5 条 → lead-writer 触发 → fake-feishu-server 应收 5 次 records POST
# fake-feishu-server 暴露 /__test/seen-records?table_id=tbl_b1_leads helper 返回收到的 records 数

SEEN=$(curl -fsS "http://localhost:3099/__test/seen-records?table_id=tbl_b1_leads" | jq -r '.count')
[ "$SEEN" -ge "5" ] || { echo "FAIL: fake-feishu-server 收到 records 数 $SEEN < 5"; exit 1; }

# 验证写入字段含必需 5 列
RECORDS=$(curl -fsS "http://localhost:3099/__test/seen-records?table_id=tbl_b1_leads" | jq -c '.records')
echo "$RECORDS" | jq -e '.[0] | has("评论者抖音 ID") and has("评论内容") and has("来源视频 URL") and has("抓取时间") and has("状态")' >/dev/null \
  || { echo "FAIL: 飞书 record 字段缺失"; exit 1; }

# 验证 lead-writer 复用 Sprint A service（grep 断言）
grep -E "from.*feishu-bitable-multitenant|writeRecord" apps/api/src/services/lead-writer.ts \
  || { echo "FAIL: lead-writer 未复用 Sprint A multitenant service"; exit 1; }

# 验证 lead-writer 不直接 axios 飞书域名（防绕过 service 重写）
grep -E "axios.*open\.feishu\.cn|axios.*open-apis" apps/api/src/services/lead-writer.ts \
  && { echo "FAIL: lead-writer 直调飞书 API 绕过 multitenant service"; exit 1; } || true
```

**硬阈值**:
- fake-feishu-server 收到 ≥ 5 次 records POST
- 每条 record 含 5 个必需字段（评论者抖音 ID / 评论内容 / 来源视频 URL / 抓取时间 / 状态）
- `lead-writer.ts` 必须 import 自 `feishu-bitable-multitenant`
- `lead-writer.ts` 不得直接 axios 飞书域名

---

### Step 10: dashboard 显示「抓取完成 5 条」+ 飞书 Bitable 链接

**可观测行为**:
- GET `/api/agent/burner/crawl-tasks/$CRAWL_TASK_ID` 返 `{success:true, data:{status:'done', comment_count:5, lead_write_status:'success', feishu_bitable_url:'https://feishu.cn/base/bascn_b1_app'}}`
- dashboard `DouyinBurnerBindPage`（或独立 CommentCrawlPage）展示「抓取完成 5 条 → 看飞书 Lead 表」+ Bitable 链接（点开新窗口打开飞书）。
- 边界：`lead_write_status='failed'` → 显示重试按钮。
- 边界：`comment_count=0` → 显示"该视频暂无评论"。

**验证命令**:
```bash
RESP=$(curl -fsS "$API_BASE/api/agent/burner/crawl-tasks/$CRAWL_TASK_ID")
echo "$RESP" | jq -e '.data.status == "done"' >/dev/null \
  || { echo "FAIL: crawl task status 非 done"; exit 1; }
echo "$RESP" | jq -e '.data.comment_count == 5' >/dev/null \
  || { echo "FAIL: comment_count != 5"; exit 1; }
echo "$RESP" | jq -e '.data.lead_write_status == "success"' >/dev/null \
  || { echo "FAIL: lead_write_status 非 success"; exit 1; }
echo "$RESP" | jq -e '.data.feishu_bitable_url | test("feishu.cn/base/")' >/dev/null \
  || { echo "FAIL: feishu_bitable_url 格式错误"; exit 1; }
```

**硬阈值**:
- HTTP 200
- `data.status='done'` + `comment_count=5` + `lead_write_status='success'`
- `feishu_bitable_url` 含 `feishu.cn/base/`
- BEHAVIOR 测试 `tests/ws5/comment-crawl-page.test.tsx` 覆盖 3 态渲染

---

## E2E 验收（最终 Evaluator 跑）

**journey_type**: user_facing

**完整验证脚本**: `.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh`

```bash
#!/bin/bash
set -euo pipefail

# 自检前置 ENV
[ -z "${API_BASE:-}" ] && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ] && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: 未设置 FEISHU_API_BASE，CI 模式必须指向 fake server"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ] && { echo "FAIL: SMOKE_TOKEN 未设置（_smoke helper 必需）"; exit 99; }

echo "=== Step 1: 建 tenant + 飞书 binding seed ==="
TENANT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-b1-${RANDOM}', 'smoke-b1-key-${RANDOM}', 'free') RETURNING id" | tr -d ' ')
psql "$DB" -c "INSERT INTO zenithjoy.tenant_feishu_bindings (tenant_id, tenant_access_token, expires_at, app_token, table_id_lead_profile, table_id_target_videos, table_id_leads, bound_at) VALUES ('$TENANT_ID', 'fake_t_b1', NOW()+interval'1 hour', 'bascn_b1_app', 'tbl_b1_profile', 'tbl_b1_videos', 'tbl_b1_leads', NOW())" >/dev/null

# 飞书绑定状态查询
curl -fsS -X GET "$API_BASE/api/feishu/oauth/status" -H "X-Tenant-Id: $TENANT_ID" \
  | jq -e '.data.bound == true' >/dev/null

echo "=== Step 2: 派 burner 绑定 task ==="
AGENT_ID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$TENANT_ID', 'mac-b1-${RANDOM}', 'rog-test', 'online') RETURNING id" | tr -d ' ')
RESP=$(curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\"}")
TASK_ID_NEW=$(echo "$RESP" | jq -r '.data.task_id')

echo "=== Step 3: fake-agent 模拟 chrome launched ==="
curl -fsS -X POST "$API_BASE/api/_smoke/fake-agent-burner-progress" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"phase\":\"chrome_launched\",\"user_data_dir\":\"/tmp/zj-burner/$AGENT_ID\",\"current_url\":\"https://creator.douyin.com/login\"}"

echo "=== Step 4: fake-agent 模拟扫码完成 ==="
curl -fsS -X POST "$API_BASE/api/agent/burner/qr-bind-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$TASK_ID_NEW\",\"agent_id\":\"$AGENT_ID\",\"qr_login\":\"success\",\"cookie_local_path\":\"/tmp/zj-burner/sessions/douyin/burner/装修小号1.json\",\"account_nickname\":\"装修达人小号\"}"

echo "=== Step 5: 验证 agent_platform_sessions 写入 burner 行 ==="
SESSION_COUNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_ID' AND platform='douyin' AND role='burner' AND status='active' AND created_at > NOW() - interval '60 seconds'")
[ "$SESSION_COUNT" = "1" ] || { echo "FAIL Step 5"; exit 1; }

echo "=== Step 6: dashboard 查询 burner sessions ==="
curl -fsS "$API_BASE/api/agent/burner/sessions?tenant_id=$TENANT_ID" \
  | jq -e '.data.sessions | length >= 1' >/dev/null

echo "=== Step 7: 派抓评论 task ==="
RESP=$(curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments" \
  -H "Content-Type: application/json" \
  -d "{\"tenant_id\":\"$TENANT_ID\",\"agent_id\":\"$AGENT_ID\",\"account_label\":\"装修小号1\",\"video_url\":\"https://www.douyin.com/video/7000000000000000001\"}")
CRAWL_TASK_ID=$(echo "$RESP" | jq -r '.data.task_id')

echo "=== Step 8: fake-agent 上报 5 条评论 ==="
curl -fsS -X POST "$API_BASE/api/agent/burner/crawl-comments-result" \
  -H "X-Smoke-Token: $SMOKE_TOKEN" -H "Content-Type: application/json" \
  -d @- <<'JSON'
{"task_id":"__CRAWL_TASK_ID__","agent_id":"__AGENT_ID__","video_url":"https://www.douyin.com/video/7000000000000000001","comments":[{"commenter_id":"@douyin_user_001","text":"求联系方式","publish_time":"2026-05-10T10:00:00Z"},{"commenter_id":"@douyin_user_002","text":"装修预算多少","publish_time":"2026-05-10T10:01:00Z"},{"commenter_id":"@douyin_user_003","text":"小户型适用吗","publish_time":"2026-05-10T10:02:00Z"},{"commenter_id":"@douyin_user_004","text":"想看完整方案","publish_time":"2026-05-10T10:03:00Z"},{"commenter_id":"@douyin_user_005","text":"在哪个城市","publish_time":"2026-05-10T10:04:00Z"}]}
JSON
# (smoke 实际 escaping 由 generator 处理；上面用 placeholder 标识)

echo "=== Step 9: 验证 fake-feishu-server 收到 5 次 records POST ==="
sleep 1
SEEN=$(curl -fsS "http://localhost:3099/__test/seen-records?table_id=tbl_b1_leads" | jq -r '.count')
[ "$SEEN" -ge "5" ] || { echo "FAIL Step 9: 飞书 records 数 $SEEN"; exit 1; }

echo "=== Step 10: 验证 dashboard 状态查询 ==="
curl -fsS "$API_BASE/api/agent/burner/crawl-tasks/$CRAWL_TASK_ID" \
  | jq -e '.data.status == "done" and .data.comment_count == 5 and .data.lead_write_status == "success"' >/dev/null

echo "✅ Path 2 Sprint B-1 Golden Path E2E 全 10 步通过"
```

**通过标准**: 脚本 exit 0；任一 step fail = 整 sprint FAIL。

---

## Risks & Mitigations

| ID | Risk | Mitigation（在哪一层处理 + 用户可见行为） |
|---|---|---|
| **R1** | 抖音小号扫码超时（5 分钟未扫，客户去找小号手机要时间）| `qr-bind-douyin-burner.ts` `waitForURL` timeout = 10 分钟（不是 5 分钟，给客户找手机时间）；超时上报 `qr_login:'timeout'` → task status='failed' → dashboard 显示「扫码超时，请重试」 |
| **R2** | 抖音视频 URL 不存在或被删 | `douyin-comment-crawl.cjs` `goto(video_url)` 后 `page.waitForSelector('[data-e2e="comment-item"]', {timeout: 30000})` 抛超时 → catch 上报 `error_code:'VIDEO_NOT_AVAILABLE'` → 中台 task status='failed' → dashboard 显示「视频不可访问」 |
| **R3** | 评论区为空（视频 0 评论）| crawl 脚本检测评论列表为空 → 上报 `comments:[]` → 中台 lead-writer 早 return（不调 writeRecord）→ task status='done' + comment_count=0 → dashboard 显示「该视频暂无评论」 |
| **R4** | 抖音反爬触发（小号被风控、跳验证码、跳登录）| crawl 脚本检测 url 跳到 login 或 captcha → 上报 `error_code:'BURNER_SESSION_EXPIRED'` 或 `'CAPTCHA_TRIGGERED'` → 中台 task status='failed' → dashboard 显示「小号被风控，请稍后重试或换号」+ 标记该 burner session status='expired' |
| **R5** | 飞书 Bitable Lead 表写入失败（token 过期 / API 超时）| **复用 Sprint A `getValidToken` 自动续 token 链路**（不重写）；本 sprint lead-writer 调 writeRecord，writeRecord 内部走 getValidToken；额外加 try/catch 重试 2 次后仍失败 → 标记 `lead_write_status='failed'` + 上报 dashboard 显示重试按钮 |
| **R6** | burner cookie 持久化失效（user-data-dir 30 天后被 OS 清）| crawl 脚本 `goto(video_url)` 后检测 url 跳 login → 上报 `BURNER_SESSION_EXPIRED` → 中台标记 `agent_platform_sessions.status='expired'` → dashboard 显示「小号 session 已失效，请重新扫码」+ 引导回 Step 2 重绑 |
| **R7** | Path 1 主号被绑小号脚本误改 user-data-dir 路径连坐 | 合同强制：burner handler **新建独立文件** `qr-bind-douyin-burner.ts`，不复用 `qr-bind-douyin.ts`；CI grep 断言 `git diff --name-only origin/main...HEAD` 不含 `qr-bind-douyin.ts`（仅 burner 新文件 + agent index dispatcher 注册） |
| **R8** | unique constraint `(agent_id, platform, account_label)` 撞行（客户给小号起名 'default' 与 Path 1 主号 default 撞）| dashboard 表单校验 `account_label` 不能为 'default'（保留给 main） + 后端 `/api/agent/burner/qr-bind` 入口校验 `account_label != 'default'` 否则返 400 `RESERVED_ACCOUNT_LABEL` |
| **R9** | role 字段 migration 在已有数据上跑（生产已有 main 行）| migration 用 `ALTER TABLE ADD COLUMN role TEXT NOT NULL DEFAULT 'main'` + 加 CHECK 约束；BEHAVIOR 测试覆盖"已存在 main 行 migration 后 role='main'"幂等场景 |
| **R10** | fake-agent helper 端点泄漏到生产（绕过真扫码）| `_smoke-feishu-seed.ts` 已建立 NODE_ENV + X-Smoke-Token 双门禁模式；本 sprint helper `_smoke/fake-agent-burner-progress` + `/api/agent/burner/qr-bind-result`（CI 模式） + `/api/agent/burner/crawl-comments-result`（CI 模式）共用同模式；ARTIFACT 测试 grep 断言 `if (process.env.NODE_ENV === 'production') return res.status(404)` |

每个 R 都已在对应 Step 的"可观测行为"段写明错误路径，BEHAVIOR 测试覆盖见 Test Contract 表对应 ws 测试文件。

---

## CI Stub 机制（fake-feishu-server + fake-agent）

### 1. fake-feishu-server (复用 Sprint A 已有)
- 文件：`apps/api/test-utils/fake-feishu-server.ts`（Sprint A 已有）
- 本 sprint 新增能力：`/__test/seen-records?table_id=xxx` helper 返回收到的 records 列表（用于 Step 9 断言）
- 新增端点：`POST /open-apis/bitable/v1/apps/:app_token/tables/:table_id/records` 已有 → 增加内存存储 records + helper 暴露

### 2. fake-agent helper 端点（CI 模式模拟 Agent 扫码 + 抓评论上报）
- 文件：`apps/api/src/routes/_smoke-fake-agent-burner.ts`（**新建**）
- 端点：
  - `POST /api/_smoke/fake-agent-burner-progress` — 模拟 Agent 上报"chrome launched"等中间 phase
- 复用真路由（NODE_ENV != production 不限制）：
  - `POST /api/agent/burner/qr-bind-result` — 真路由，CI 由 smoke 直接调（不绕过业务路由）
  - `POST /api/agent/burner/crawl-comments-result` — 真路由
- 双门禁：NODE_ENV=production → 404；缺/错 X-Smoke-Token → 403
- 端点处理函数走业务层 service（写 DB + 触发 lead-writer），不绕过

### 3. 启停时机
- CI workflow（在 `path-2-smoke.yml` 或现有 ci.yml）: smoke 步骤前 `node apps/api/test-utils/fake-feishu-server.js &` + `export FEISHU_API_BASE=http://localhost:3099` + `export SMOKE_TOKEN=<random>` + `NODE_ENV=test`；smoke 结束 `kill $!`
- smoke.sh 头部自检 4 个 ENV（API_BASE / DB / FEISHU_API_BASE / SMOKE_TOKEN）

---

## SSOT 文件路径（合同内禁止漂移）

| 用途 | 路径 (SSOT) |
|---|---|
| WS1 migration | `apps/api/db/migrations/20260510_xxxxxx_agent_platform_sessions_add_role.sql`（xxxxxx generator 决定，必须落到此目录 + 含 `agent_platform_sessions_add_role` 字样） |
| WS2 Agent burner 绑定 handler | `services/agent/src/handlers/qr-bind-douyin-burner.ts` |
| WS2 Agent crawl 脚本 | `services/agent/scripts/douyin-comment-crawl.cjs` |
| WS2 Agent dispatcher 注册 | `services/agent/src/index.ts`（仅追加 import + register，不改既有） |
| WS3 中台 burner 路由 | `apps/api/src/routes/agent-burner.ts` |
| WS3 路由挂载 | `apps/api/src/app.ts` 加 `app.use('/api/agent/burner', agentBurnerRouter)` |
| WS4 lead-writer service | `apps/api/src/services/lead-writer.ts` |
| WS5 dashboard burner bind 页 | `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx` |
| WS5 dashboard 路由挂载 | `apps/dashboard/src/App.tsx` 加 `/dashboard/douyin-burner-bind` route |
| WS6 smoke 脚本 | `.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh` |
| WS6 fake-agent helper | `apps/api/src/routes/_smoke-fake-agent-burner.ts` |
| WS6 fake-feishu-server seen-records helper | `apps/api/test-utils/fake-feishu-server.ts`（增量改 — 加内存 store + `/__test/seen-records` 端点） |
| WS6 CI workflow | `.github/workflows/path-2-b1-smoke.yml` 或合并到 `path-2-smoke.yml` |
| WS7 Lead 自验证据 | `.agent-knowledge/path-2/lead-acceptance-sprint-b1.md` |
| WS7 Lead 自验脚本（mac → rog scp） | `scripts/lead-acceptance/path2-sprint-b1-self-test.cjs` |

任一文件路径若 generator 想偏离此表 → 必须先回到合同 GAN 层修订，不可偷偷改。

---

## 关键约束（合同强制，不可妥协）

### 约束 A: Path 1 + Sprint A 文件零修改
`git diff --name-only origin/main...HEAD` 不得含：
- `services/agent/src/handlers/qr-bind-douyin.ts`（Path 1 主号绑定）
- `apps/api/src/services/feishu-bitable-multitenant.ts`（Sprint A）
- `apps/api/src/services/feishu-token.ts`（Sprint A）
- `apps/api/src/routes/feishu-oauth.ts`（Sprint A）
- `apps/dashboard/src/pages/FeishuBindTenant.tsx`（Sprint A）
- `apps/dashboard/src/pages/DouyinBindPage.tsx`（Path 1 主号 dashboard 绑定页）

允许 append-only 修改（CI 单独检查）：
- `services/agent/src/index.ts`（仅追加 burner handler 注册，不改既有）
- `apps/api/src/app.ts`（仅追加 router mount + import）
- `apps/dashboard/src/App.tsx`（仅追加 route + import）
- `apps/api/test-utils/fake-feishu-server.ts`（增量加 seen-records helper）

### 约束 B: TDD Iron Law
每个 workstream 必须 commit-1 RED test → commit-2 GREEN impl 严格两段式。CI `lint-tdd-commit-order.sh` 强校验。
**测试文件从合同原样复制到代码仓**（`apps/api/tests/wsN/` + `services/agent/src/handlers/__tests__/` + `apps/dashboard/src/pages/__tests__/`），commit-1 后不可修改。

### 约束 C: Feature 0 端到端 smoke 阈值线
`golden-path-2-b1-smoke.sh` 跑到 Step 10 PASS，`exit 0`。任一 step fail = 整 sprint FAIL。CI workflow 必须挂这条 smoke 作为 required check。

### 约束 D: lead-writer 必须复用 Sprint A multitenant service
`apps/api/src/services/lead-writer.ts` 必须 import `writeRecord` from `feishu-bitable-multitenant`，不得直接 axios 飞书域名。CI grep 断言强校验。

### 约束 E: Lead 客户机自验真扫码
`lead-acceptance-sprint-b1.md` 必须含真证据（5+ Step + PASS YAML + xian-rog 真扫码截图 + 飞书 Lead 表 5 行真截图 + cookie 持久化路径），size > 1KB。

---

## Workstreams

workstream_count: 7

### Workstream 1: DB migration `agent_platform_sessions` add `role` 字段

**范围**: 新增 `apps/api/db/migrations/20260510_xxxxxx_agent_platform_sessions_add_role.sql`，`ALTER TABLE ADD COLUMN role TEXT NOT NULL DEFAULT 'main'` + CHECK 约束 `role IN ('main','burner')`。
**大小**: S（< 50 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/migration-add-role.test.ts`

---

### Workstream 2: Agent 端 — `qr-bind-douyin-burner.ts` handler + `douyin-comment-crawl.cjs` 抓评论脚本

**范围**:
- 新建 `services/agent/src/handlers/qr-bind-douyin-burner.ts` — `launchPersistentContext` 用 burner user-data-dir + cookie 存 `~/.zenithjoy-agent/sessions/douyin/burner/<account_label>.json` + `waitForURL` 10min timeout + 上报中台
- 新建 `services/agent/scripts/douyin-comment-crawl.cjs` — `launchPersistentContext` 用 burner user-data-dir + `goto(video_url)` + 等 selector + 解析 5 条评论 + 上报中台
- 修改 `services/agent/src/index.ts`（追加 import + dispatcher 注册 task_type `qr_bind/douyin_burner` + `crawl_comments/douyin`，不改既有）

**大小**: L（300+ 行）
**依赖**: WS1（需 role 字段）

**BEHAVIOR 覆盖测试文件**: `tests/ws2/qr-bind-douyin-burner.test.ts` + `tests/ws2/douyin-comment-crawl.test.ts`

---

### Workstream 3: 中台 — `agent-burner.ts` 路由 + `_smoke-fake-agent-burner.ts` helper

**范围**:
- 新建 `apps/api/src/routes/agent-burner.ts`：
  - POST `/api/agent/burner/qr-bind` — 派 burner 绑定 task（含 R8 RESERVED_ACCOUNT_LABEL）
  - POST `/api/agent/burner/qr-bind-result` — 接 Agent 扫码完成回调，写 `agent_platform_sessions` role='burner'
  - GET `/api/agent/burner/sessions` — 列 burner sessions
  - POST `/api/agent/burner/crawl-comments` — 派抓评论 task
  - POST `/api/agent/burner/crawl-comments-result` — 接 Agent 评论上报，调 lead-writer
  - GET `/api/agent/burner/crawl-tasks/:task_id` — 查 crawl task 状态
- 新建 `apps/api/src/routes/_smoke-fake-agent-burner.ts`：CI 模式 fake-agent progress helper（NODE_ENV + X-Smoke-Token 双门禁，复用 Sprint A `_smoke-feishu-seed.ts` 模式）
- 修改 `apps/api/src/app.ts` 挂载新路由（追加，不改既有）

**大小**: L（300+ 行）
**依赖**: WS1（agent_platform_sessions role 字段）

**BEHAVIOR 覆盖测试文件**: `tests/ws3/agent-burner-routes.test.ts` + `tests/ws3/smoke-fake-agent-burner.test.ts`

---

### Workstream 4: `lead-writer.ts` service — 调用 Sprint A multitenant Bitable

**范围**:
- 新建 `apps/api/src/services/lead-writer.ts`：
  - `writeLeadsFromComments(tenantId, videoUrl, comments[])` — 5 次 writeRecord 写飞书
  - 字段映射：评论者抖音 ID / 评论内容 / 来源视频 URL / 抓取时间 / 状态='已抓取'
  - 重试 2 次 + 失败标记
  - 评论数 0 早 return
- **必须** import `writeRecord` from `feishu-bitable-multitenant`，不得直接 axios

**大小**: M（150-200 行）
**依赖**: 无（service 层独立；调用方 ws3 用即可）

**BEHAVIOR 覆盖测试文件**: `tests/ws4/lead-writer.test.ts`

---

### Workstream 5: Dashboard — `DouyinBurnerBindPage.tsx` + 路由挂载

**范围**:
- 新建 `apps/dashboard/src/pages/DouyinBurnerBindPage.tsx`：
  - 飞书未绑 → 表单 disabled + 提示
  - 表单：account_label 输入框（校验非 'default'）
  - 点开始 → POST `/api/agent/burner/qr-bind` → 显示「等扫码」状态
  - 列 burner sessions 表格（account_label / 昵称 / 状态 / bound_at）
  - 选 video_url 下拉（拉 fetchLeadConfig 的 target_videos）
  - 点「开始抓取评论」按钮 → POST crawl → 显示进度
  - 抓取完成 → 显示「N 条 → 看飞书 Lead 表」+ Bitable URL 跳转
- 修改 `apps/dashboard/src/App.tsx` 加 `/dashboard/douyin-burner-bind` route（追加，不改既有）

**大小**: L（300+ 行）
**依赖**: WS3（API 路由就绪）

**BEHAVIOR 覆盖测试文件**: `tests/ws5/douyin-burner-bind-page.test.tsx`

---

### Workstream 6: smoke 脚本 + CI workflow + fake-feishu-server seen-records 增量

**范围**:
- 新建 `.github/workflows/scripts/smoke/golden-path-2-b1-smoke.sh` — 落地合同 E2E 段全文 + 自检 4 ENV
- 新建/合并 `.github/workflows/path-2-b1-smoke.yml`（或加到 path-2-smoke.yml） — 启 fake-feishu-server + export ENV + 跑 smoke + cleanup
- **增量** 修改 `apps/api/test-utils/fake-feishu-server.ts` — 加内存 store records + `/__test/seen-records?table_id=xxx` 暴露
- ARTIFACT 断言 Path 1 + Sprint A 文件未改（git diff grep）
- ARTIFACT 断言 lead-writer 复用 multitenant service

**大小**: M（200 行）
**依赖**: WS3 + WS4 + WS5

**BEHAVIOR 覆盖测试文件**: `tests/ws6/smoke-script-structure.test.ts`

---

### Workstream 7: Lead 客户机自验脚本 + 真证据归档

**范围**:
- 新建 `scripts/lead-acceptance/path2-sprint-b1-self-test.cjs`：
  - mac 写 → scp 到 xian-rog `Documents/path2-self/self-test-b1.cjs`
  - rog 跑：launchPersistentContext (channel msedge headless: true) + user-data-dir 隔离
  - API 注册 user + 飞书 0-touch 绑定（复用 Sprint A）+ 真飞书 Bitable API 写 1 行对标视频
  - POST 触发绑 burner → Agent 弹 Chrome → 走到扫码页
  - **scp 二维码截图回 mac → user 真扫**
  - 等 cookie 落地 + agent_platform_sessions burner 行
  - POST crawl-comments → 等评论入飞书 Lead 表
  - 真飞书 API GET 客户 Lead 表验证 5 行
  - 截图 6+ 张 + summary JSON
- 新建 `.agent-knowledge/path-2/lead-acceptance-sprint-b1.md`：真证据归档（status PASS / 1 次扫码 / elapsed 秒数 / 飞书 Lead 表 5 行截图）

**大小**: M（200 行 self-test 脚本 + 文档）
**依赖**: 全部完成 + 已部署到生产 / lead 自验机

**BEHAVIOR 覆盖测试文件**: `tests/ws7/lead-self-test-script-structure.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/migration-add-role.test.ts` | role 列存在 + 默认 'main' + CHECK 约束 + 已有 main 行幂等 | WS1 → 4 failures |
| WS2a | `tests/ws2/qr-bind-douyin-burner.test.ts` | handler import + sessionPath 含 /burner/ + waitForURL 10min + 上报 cookie_local_path | WS2a → 4 failures |
| WS2b | `tests/ws2/douyin-comment-crawl.test.ts` | crawl 脚本 launchPersistentContext + selector + 解析 5 条结构 + 评论 0 早 return | WS2b → 4 failures |
| WS3a | `tests/ws3/agent-burner-routes.test.ts` | 6 路由的正常 + 错码（MISSING_*  / RESERVED_ACCOUNT_LABEL / NO_BURNER_SESSION / FEISHU_NOT_BOUND） | WS3a → 8 failures |
| WS3b | `tests/ws3/smoke-fake-agent-burner.test.ts` | NODE_ENV=production → 404 / 缺 SMOKE_TOKEN → 403 / 正常 progress 写 task response | WS3b → 3 failures |
| WS4 | `tests/ws4/lead-writer.test.ts` | 5 条评论 → 5 次 writeRecord / 字段映射 / 评论 0 早 return / 重试 2 次 / 复用 multitenant service | WS4 → 5 failures |
| WS5 | `tests/ws5/douyin-burner-bind-page.test.tsx` | 飞书未绑 disabled / account_label='default' 校验 / sessions 列表渲染 / video 下拉拉 fetchLeadConfig / 抓取完成显示 Bitable URL | WS5 → 5 failures |
| WS6 | `tests/ws6/smoke-script-structure.test.ts` | smoke 脚本含 4 ENV 自检 / 含 10 个 Step 标识 / git diff 断言段 / fake-feishu-server seen-records helper | WS6 → 4 failures |
| WS7 | `tests/ws7/lead-self-test-script-structure.test.ts` | self-test 脚本含 channel 'msedge' + headless true + scp + 真飞书 GET 验证 5 行断言 | WS7 → 4 failures |

合计预期 RED ≥ 41 个测试失败。Generator commit-1 后 `npx vitest run sprints/path-2-sprint-b1-douyin-burner-crawl/tests/` 必须显示 ≥ 41 failed。

---

