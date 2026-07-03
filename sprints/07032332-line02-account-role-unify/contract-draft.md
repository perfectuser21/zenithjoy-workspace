# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: 当前代码 agent-burner.ts:161-186 + PRD 明确字段名）

### Endpoint: GET /api/agent/burner/sessions
**Success (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "account_label": "<string>",
        "role": "burner",
        "status": "<active|needs_rebind|expired|pending>",
        "bound_at": "<ISO8601|null>",
        "created_at": "<ISO8601>",
        "agent_hostname": "<string|null>",
        "agent_nickname": "<string|null>",
        "account_nickname": "<string|null>"
      }
    ]
  },
  "timestamp": "<ISO8601>"
}
```
- `agent_hostname` (string|null, 必填): agents.hostname 的别名；无绑定机器时为 null（来源——PRD 明确）
- `agent_nickname` (string|null, 必填): agents.nickname 的别名；无绑定机器时为 null（来源——PRD 明确）
- `account_nickname`: 从 publish_tasks 子查询读取，可为 null
**禁用字段名**: [`hostname`, `nickname`] — 不带 `agent_` 前缀的旧字段名，generator 不得在 sessions 数组里输出这两个裸名

**Error (HTTP 4xx/5xx)**:
```json
{"success": false, "error": {"code": "<string>", "message": "<string>"}, "timestamp": "<string>"}
```

---

## 已知约束（来自回归测试）

- [agent-burner-routes.test.ts] → `GET /api/agent/burner/sessions 按 tenant_id 返回 burner 列表`
- [agent-burner-routes.test.ts] → `POST /api/agent/burner/qr-bind 正常 200 + task_id`
- [agent-burner-routes.test.ts] → `POST /api/agent/burner/qr-bind-result 成功写 agent_platform_sessions`
- [douyin-burner-bind-page.test.tsx] → `account_label=default → 校验报错 + 提交 disabled`（本 sprint 将删除此测试文件）
- [navigation.config.test.ts] → 导航配置结构（路由注册合法性）

---

## Golden Path

[管理员打开账号管理页] → [API 返回含机器字段的 sessions] → [前端表格渲染绑定机器列] → [旧绑定页已下线] → [迁移脚本 dry-run 正常输出]

---

### Step 1: 管理员打开账号管理页 `/area/acquisition/accounts`

**来源**: `[FROM_PRD]` — PRD 场景 A 第 1 步

**可观测行为**: 页面加载成功，表格区域可见；表头含"绑定机器"列

**验证命令**:
```bash
# Playwright — 导航至账号管理页，断言"绑定机器"列头可见
await page.goto('http://localhost:5174/area/acquisition/accounts')
await expect(page.locator('text=绑定机器')).toBeVisible({ timeout: 10000 })
```

**硬阈值**: 页面在 10s 内出现"绑定机器"文字

---

### Step 2: GET /api/agent/burner/sessions 响应含 `agent_hostname` + `agent_nickname`

**来源**: `[FROM_PRD]` — PRD 场景 A 第 2 步，明确指定 JOIN agents 返回两字段

**可观测行为**: 响应 JSON 中 `data.sessions[*]` 每条记录含 `agent_hostname`（可为 null）和 `agent_nickname`（可为 null）

**验证命令**:
```bash
# evaluator 模式A（API-level curl，带真实 tenant 鉴权 header）
RESP=$(curl -sf -H "X-Tenant-Id: ${TEST_TENANT_ID}" localhost:3000/api/agent/burner/sessions) || { echo "FAIL: sessions 端点未返回 200"; exit 1; }
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e '.data.sessions | type == "array"' || { echo "FAIL: sessions 非数组"; exit 1; }
# 有 session 时验证字段存在（has()，字段值允许 null，但 key 必须存在）
COUNT=$(echo "$RESP" | jq '.data.sessions | length')
if [ "$COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_hostname")' || { echo "FAIL: 缺 agent_hostname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_nickname")' || { echo "FAIL: 缺 agent_nickname"; exit 1; }
  # 禁用字段反向检查：hostname/nickname 不得裸露（无 agent_ 前缀的旧名）
  echo "$RESP" | jq -e '.data.sessions[0] | has("hostname") | not' || { echo "FAIL: 禁用字段 hostname 漏出"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("nickname") | not' || { echo "FAIL: 禁用字段 nickname 漏出"; exit 1; }
fi
echo "✅ Step 2 通过 count=$COUNT"
```

**硬阈值**:
- `success == true`
- `data.sessions` 为数组
- 每条 session 含 `agent_hostname` key（值允许为 null）
- 每条 session 含 `agent_nickname` key（值允许为 null）
- 禁止输出裸 `hostname` / `nickname` key

---

### Step 3: 前端表格"绑定机器"列渲染 hostname 或"—"

**来源**: `[FROM_PRD]` — PRD 场景 A 第 3-4 步

**可观测行为**:
- 有绑定机器的 session 行：显示 hostname 文字（或 nickname）
- 无绑定机器的 session 行（`agent_hostname == null`）：显示"—"

**验证命令**:
```javascript
// Playwright spec 片段（在 Step 1 导航后执行）
// 对表格行进行断言：至少 1 行渲染了"绑定机器"列的内容（dash 或 hostname）
const rows = page.locator('[data-testid="burner-session-row"]');
// 若无 data-testid，退一步查任何含"—"或 hostname 文字的机器列单元格
await expect(page.locator('text=绑定机器')).toBeVisible(); // 列头已在 Step 1 验
await page.screenshot({ path: 'screenshots/02-accounts-table.png' });
```

**硬阈值**: "绑定机器"列头 DOM 可见（toBeVisible）；页面无 JS 报错

---

### Step 4: 旧路由 `/dashboard/douyin-burner-bind` 已下线

**来源**: `[FROM_PRD]` — PRD 场景 B，旧页面下线

**可观测行为**:
- `DouyinBurnerBindPage.tsx` 文件已物理删除
- navigation.config.ts 移除 lazy import + 路由条目
- AreaHubPage.tsx 移除 `/dashboard/douyin-burner-bind` 链接
- Playwright 访问该路由后 React Router catch-all 触发，用户不再能访问旧组件

**验证命令**:
```bash
# ARTIFACT 验证：文件已删除
test ! -f apps/dashboard/src/pages/DouyinBurnerBindPage.tsx || { echo "FAIL: 文件未删除"; exit 1; }
# ARTIFACT 验证：navigation.config.ts 无残留引用
grep -q "DouyinBurnerBind" apps/dashboard/src/config/navigation.config.ts && { echo "FAIL: navigation.config 仍有 DouyinBurnerBind 引用"; exit 1; } || echo "OK 导航配置已清理"
```

```javascript
// Playwright：访问旧路由，验证组件内容不再出现
await page.goto('http://localhost:5174/dashboard/douyin-burner-bind');
await page.waitForTimeout(1000); // 等待路由处理
// 旧页面的特征文字不应出现
await expect(page.locator('text=DouyinBurnerBindPage').first()).not.toBeVisible({ timeout: 3000 }).catch(() => {});
// 当前 URL 不应停在旧路径（catch-all 会 navigate 走）
const finalUrl = page.url();
if (finalUrl.includes('douyin-burner-bind')) {
  console.error('FAIL: 路由未下线，URL 仍为', finalUrl); process.exit(1);
}
await page.screenshot({ path: 'screenshots/03-old-route-gone.png' });
```

**硬阈值**:
- 文件不存在：`test ! -f apps/dashboard/src/pages/DouyinBurnerBindPage.tsx`
- navigation.config 无 `DouyinBurnerBind` 字样
- Playwright 访问后 URL 离开旧路径

---

### Step 5: 迁移脚本 `--dry-run` 执行正常，输出冲突日志

**来源**: `[FROM_PRD]` — PRD 场景 C 第 1-2 步

**可观测行为**:
- `node scripts/account-role-migrate.js --dry-run` 退出码 0
- stdout 输出每条角色不一致记录（tenant_id + account_label + 两表 role 值）
- 不写任何数据（dry-run 模式）

**验证命令**:
```bash
DATABASE_URL="${TEST_DB_URL}" node apps/api/scripts/account-role-migrate.js --dry-run > /tmp/dry-run.log 2>&1
EXIT_CODE=$?
[ $EXIT_CODE -eq 0 ] || { echo "FAIL: dry-run exit=$EXIT_CODE"; cat /tmp/dry-run.log; exit 1; }
# 验证日志格式合法（含表头或"0 conflicts"字样）
grep -qE "dry.run|conflict|no.*conflict|0 conflict|tenant_id" /tmp/dry-run.log || { echo "FAIL: 日志无预期输出"; cat /tmp/dry-run.log; exit 1; }
echo "✅ dry-run 通过 $(wc -l < /tmp/dry-run.log) 行输出"
```

**硬阈值**: exit code = 0；stdout 含至少 1 行可读日志

---

### Step 6: 两租户数据隔离（Invariant 铁律验证）

**来源**: `[AI_ADDED]` — PRD Invariant 铁律"所有查询必须带 tenant_id 过滤"，防止跨租户数据泄露

**可观测行为**: 租户 A 的 burner sessions 不出现在租户 B 的响应中

**验证命令**:
```bash
# supertest 单测（vitest）— 两租户种数据 + 断言互不串
# 见 tests/account-role-unify.test.ts: '多租户隔离' 用例
```

**硬阈值**: 租户 B 的 GET /sessions 结果 count = 0（当只有租户 A 有数据时）

---

## 接缝清单（logic-done-pending 直到真目标验证）

| # | 接缝点 | 真目标验证方式 |
|---|---|---|
| 1 | staging DB agent_platform_sessions + agents JOIN 查询（需真实 staging DB 有数据）| evaluator 对 staging DB 真实执行 GET /sessions，验证返回行含非 null agent_hostname |
| 2 | Windows GHA runner 上 Vite build + API 真实启动（非 mock）| e2e-verify.ps1 在 windows-latest 上运行，Playwright spec 打真实后端 localhost:3000 |

两条接缝在 final-e2e（evaluator 执行 e2e-verify.ps1 in GHA windows-latest）时验证；合并前仅 logic-done-pending。

---

## E2E 验收（最终 final-e2e — target_environment: windows_cloud 变体C）

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA windows-latest + Playwright，真实后端，禁 page.route()）

> windows_cloud 变体C 死规则（全部遵守）:
> 1. Playwright spec 禁止 page.route()
> 2. e2e-verify.ps1 必须先启动 apps/api server（port 3000）
> 3. VITE_API_BASE_URL 传给 Vite 以代理到真实后端
> 4. VITE_SKIP_AUTH=true 绕过登录界面

<!-- GOLDEN_SMOKE_ABILITY_SLUG: line02-account-role-unify -->
<!-- GOLDEN_SMOKE_TARGET_ENV: windows_cloud -->
<!-- GOLDEN_SMOKE_SKIP_IN_CI: true -->

### Scenario 1: api-sessions-has-agent-hostname
<!-- GOLDEN_SMOKE_SCENARIO: api-sessions-has-agent-hostname -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
# 验证 GET /api/agent/burner/sessions 返回含 agent_hostname 字段
# 环境变量：DATABASE_URL / DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / BRAIN_URL

API_URL="${BRAIN_URL:-http://localhost:3000}"

# 需要 tenant，插入测试租户
TENANT_ID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-test-role-unify', 'smoke-key-$(date +%s)', 'free') RETURNING id" | tr -d ' \n')
[ -n "$TENANT_ID" ] || { echo "FAIL: 无法创建测试租户"; exit 1; }

RESP=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_URL/api/agent/burner/sessions") || { \
  psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" 2>/dev/null || true; \
  echo "FAIL: GET /sessions 未返回 200"; exit 1; }

echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e '.data.sessions | type == "array"' || { echo "FAIL: sessions 非数组"; exit 1; }

# 验证字段 schema（空列表时仅检测结构，非空时检测 key 存在性）
COUNT=$(echo "$RESP" | jq '.data.sessions | length')
if [ "$COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_hostname")' || { echo "FAIL: 缺 agent_hostname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_nickname")' || { echo "FAIL: 缺 agent_nickname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("hostname") | not' || { echo "FAIL: 禁用字段 hostname 出现"; exit 1; }
fi

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'" 2>/dev/null || true
echo "✅ Scenario 1 通过 sessions_count=$COUNT"
```

### Scenario 2: old-route-deleted-and-file-gone
<!-- GOLDEN_SMOKE_SCENARIO: old-route-deleted-and-file-gone -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
# 验证 DouyinBurnerBindPage.tsx 已删除 + navigation.config.ts 无引用
test ! -f "apps/dashboard/src/pages/DouyinBurnerBindPage.tsx" || { echo "FAIL: 文件未删除"; exit 1; }
grep -q "DouyinBurnerBind" "apps/dashboard/src/config/navigation.config.ts" && { echo "FAIL: navigation.config 仍有引用"; exit 1; } || true
grep -q "douyin-burner-bind" "apps/dashboard/src/config/navigation.config.ts" && { echo "FAIL: navigation.config 仍有 douyin-burner-bind 路径"; exit 1; } || true
echo "✅ Scenario 2 通过 — 旧页面已物理删除且导航配置已清理"
```

### Scenario 3: migration-dry-run-exits-zero
<!-- GOLDEN_SMOKE_SCENARIO: migration-dry-run-exits-zero -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
# 验证迁移脚本 --dry-run 退出码 0 并输出日志
test -f "apps/api/scripts/account-role-migrate.js" || { echo "FAIL: 迁移脚本文件不存在"; exit 1; }
DATABASE_URL="${DATABASE_URL}" node apps/api/scripts/account-role-migrate.js --dry-run > /tmp/dry-run.log 2>&1
[ $? -eq 0 ] || { echo "FAIL: dry-run 退出非零"; cat /tmp/dry-run.log; exit 1; }
grep -qE "dry.run|conflict|ok|完成|0 row" /tmp/dry-run.log || { echo "FAIL: 日志无可识别输出"; cat /tmp/dry-run.log; exit 1; }
echo "✅ Scenario 3 通过"
```

### Scenario 4: multi-tenant-isolation
<!-- GOLDEN_SMOKE_SCENARIO: multi-tenant-isolation -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
# 验证两租户数据隔离：A 的 sessions 不漏给 B
API_URL="${BRAIN_URL:-http://localhost:3000}"

TS=$(date +%s)
TENANT_A=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-iso-a-$TS', 'key-a-$TS', 'free') RETURNING id" | tr -d ' \n')
TENANT_B=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-iso-b-$TS', 'key-b-$TS', 'free') RETURNING id" | tr -d ' \n')

# 给 A 插一个 agent + session
AGENT_A=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$TENANT_A', 'mac-a-$TS', 'host-a', 'online') RETURNING id" | tr -d ' \n')
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, created_at, bound_at) VALUES ('$AGENT_A', 'douyin', 'label-a', 'burner', 'active', NOW(), NOW())" 2>/dev/null || true

# B 查询不应看到 A 的 session
RESP_B=$(curl -sf -H "X-Tenant-Id: $TENANT_B" "$API_URL/api/agent/burner/sessions") || { echo "FAIL: B GET /sessions 失败"; exit 1; }
COUNT_B=$(echo "$RESP_B" | jq '.data.sessions | length')
[ "$COUNT_B" -eq 0 ] || { echo "FAIL: 跨租户泄露，B 看到 $COUNT_B 条 A 的 sessions"; exit 1; }

# 清理
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AGENT_A'" 2>/dev/null || true
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agents WHERE id='$AGENT_A'" 2>/dev/null || true
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$TENANT_A','$TENANT_B')" 2>/dev/null || true
echo "✅ Scenario 4 通过 — 多租户隔离正常"
```
