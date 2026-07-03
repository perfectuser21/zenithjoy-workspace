# Sprint Contract Draft (Round 6)

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

## Risks

| # | 风险 | 影响 | 缓解措施 |
|---|---|---|---|
| R1 | cutover 中途失败（DB 连接中断/事务异常）→ 部分数据迁入 `agent_platform_sessions`，部分留在 `line02_account_sessions`，形成数据孤岛 | 高 — 两表不一致，停写标记生效后新记录丢失 | 迁移脚本必须在**单 DB 事务**内完成全部 INSERT + 停写标记，失败全回滚；生产执行前必须先跑 `--dry-run` 并保存输出；合同 Step 5b 以 psql 时间窗断言验证三值全映射 |
| R2 | `agent_platform_sessions` JOIN `agents` 用 INNER JOIN → 无绑定机器的 session 被静默过滤，不出现在响应中（PRD Scenario A 明确要求返回 `agent_hostname=null`，不是不返回该行）| 高 — 管理员看到的小号数量少于实际，判断失误 | 必须使用 LEFT JOIN；合同 Step 2 验证字段存在性（`has("agent_hostname")`），不验 non-null；单测补 agent_hostname=null 场景 |
| R3 | `hostname` → `agent_hostname` 是 breaking change → 已有内部消费者（Agent worker 等）若读裸 `.hostname` 字段会静默返回 undefined | 中 — 现有消费者 silently break，功能异常无 error log | 禁用字段检查（`has("hostname") \| not`）已进 BEHAVIOR；generator 部署前 grep 全 codebase 确认无 `.hostname` 残留引用（`grep -r '\.hostname' apps/` 验无漏网） |

---

## Golden Path

[管理员打开账号管理页] → [API 返回含机器字段的 sessions] → [前端表格渲染绑定机器列（含单元格值）] → [旧绑定页已下线] → [迁移 dry-run 正常] → [cutover 三值映射正确] → [两租户数据隔离]

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
COUNT=$(echo "$RESP" | jq '.data.sessions | length')
if [ "$COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_hostname")' || { echo "FAIL: 缺 agent_hostname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_nickname")' || { echo "FAIL: 缺 agent_nickname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0].role == "burner"' || { echo "FAIL: role != burner"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("account_label")' || { echo "FAIL: 缺 account_label"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("status")' || { echo "FAIL: 缺 status"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("hostname") | not' || { echo "FAIL: 禁用字段 hostname 出现"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("nickname") | not' || { echo "FAIL: 禁用字段 nickname 出现"; exit 1; }
fi
echo "✅ Step 2 通过 count=$COUNT"
```

**硬阈值**:
- `success == true`
- `data.sessions` 为数组
- 每条 session 含 `agent_hostname` key（值允许为 null）
- 每条 session 含 `agent_nickname` key（值允许为 null）
- `role == "burner"`（小号专用 role 值）
- 含 `account_label` key
- 含 `status` key
- 禁止输出裸 `hostname` / `nickname` key

---

### Step 3: 前端表格"绑定机器"列单元格渲染 hostname 值或"—"

**来源**: `[FROM_PRD]` — PRD 场景 A 第 3-4 步

**可观测行为**:
- 有绑定机器的 session 行：单元格显示 hostname 文字（或 nickname）
- 无绑定机器的 session 行（`agent_hostname == null`）：单元格显示"—"（非空白、非 undefined）

**验证命令**:
```javascript
// Playwright spec 片段（在 Step 1 导航后执行）
await page.waitForSelector('tbody tr', { timeout: 10000 });
await page.screenshot({ path: 'screenshots/02-accounts-table.png' });

// DOM 内容断言（问题4修复：不只检查列头，还验证单元格实际值）
const rowCount = await page.locator('tbody tr').count();
if (rowCount > 0) {
  // generator 必须在"绑定机器"列的 <td> 上加 data-testid="machine-hostname-cell"
  const machineCell = page.locator('[data-testid="machine-hostname-cell"]').first();
  await expect(machineCell).toBeVisible({ timeout: 5000 });
  const cellText = (await machineCell.textContent() ?? '').trim();
  // 值必须是"—"（无绑定）或非空 hostname 字符串，不允许空字符串/undefined
  expect(cellText).toMatch(/^—$|^\S+/);
}
```

**硬阈值**: 
- tbody 有行时，`[data-testid="machine-hostname-cell"]` 可见
- 单元格文字匹配 `/^—$|^\S+/`（"—" 或非空）

---

### Step 4: 旧路由 `/dashboard/douyin-burner-bind` 已下线

**来源**: `[FROM_PRD]` — PRD 场景 B，旧页面下线

**可观测行为**:
- `DouyinBurnerBindPage.tsx` 文件已物理删除
- navigation.config.ts 移除 lazy import + 路由条目
- `apps/dashboard/src/pages/AreaHubPage.tsx` 移除 `/dashboard/douyin-burner-bind` 链接
- Playwright 访问该路由后 React Router catch-all 触发，URL 离开旧路径

**验证命令**:
```bash
# ARTIFACT：文件已删除
test ! -f apps/dashboard/src/pages/DouyinBurnerBindPage.tsx || { echo "FAIL: 文件未删除"; exit 1; }
# ARTIFACT：navigation.config.ts 无残留引用
grep -q "DouyinBurnerBind" apps/dashboard/src/config/navigation.config.ts && { echo "FAIL: navigation.config 仍有 DouyinBurnerBind 引用"; exit 1; } || echo "OK 导航配置已清理"
# ARTIFACT：AreaHubPage.tsx 已清理旧链接（问题5修复）
grep -q "douyin-burner-bind" apps/dashboard/src/pages/AreaHubPage.tsx && { echo "FAIL: AreaHubPage 仍有 douyin-burner-bind 链接"; exit 1; } || echo "OK AreaHubPage 已清理"
```

```javascript
// Playwright：访问旧路由，验证 URL 离开旧路径（问题4修复：throw 替代 process.exit）
await page.goto('http://localhost:5174/dashboard/douyin-burner-bind');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/03-old-route-gone.png' });
const finalUrl = page.url();
if (finalUrl.includes('douyin-burner-bind')) {
  throw new Error(`FAIL: 路由未下线，URL 仍为 ${finalUrl}`);
}
```

**硬阈值**:
- 文件不存在：`test ! -f apps/dashboard/src/pages/DouyinBurnerBindPage.tsx`
- navigation.config 无 `DouyinBurnerBind` 字样
- AreaHubPage 无 `douyin-burner-bind` 字样
- Playwright 访问后 URL 不含 `douyin-burner-bind`

---

### Step 5a: 迁移脚本 `--dry-run` 执行正常，输出冲突日志

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
grep -qE "dry.run|conflict|no.*conflict|0 conflict|tenant_id|完成" /tmp/dry-run.log || { echo "FAIL: 日志无预期输出"; cat /tmp/dry-run.log; exit 1; }
echo "✅ Step 5a dry-run 通过 $(wc -l < /tmp/dry-run.log) 行输出"
```

**硬阈值**: exit code = 0；stdout 含至少 1 行可读日志

---

### Step 5b: cutover 正式执行，三值 health → status 映射正确

**来源**: `[FROM_PRD]` — PRD 场景 C 第 3 步（cutover：health 按 ok→active / expired→expired / unknown→pending 写入 agent_platform_sessions.status）

**可观测行为**:
- `line02_account_sessions` 中 health=ok 的记录在 `agent_platform_sessions` 对应行 status='active'
- health=expired → status='expired'
- health=unknown → status='pending'
- `line02_account_sessions` 写入路径切断（停写）

**验证命令**:
```bash
# 准备测试数据：三种 health 值（带时间戳防冲突）
TS=$(date +%s)
CTID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cutover-$TS', 'ck-$TS', 'free') RETURNING id" | tr -d ' \n')
CAID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$CTID', 'mac-cut-$TS', 'cutover-host', 'online') RETURNING id" | tr -d ' \n')

# 插三条 line02_account_sessions（三种 health）
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.line02_account_sessions (agent_id, platform, account_label, health, tenant_id) VALUES ('$CAID','douyin','ok-lbl-$TS','ok','$CTID'), ('$CAID','douyin','exp-lbl-$TS','expired','$CTID'), ('$CAID','douyin','unk-lbl-$TS','unknown','$CTID')"

# 执行 cutover（不带 --dry-run，单事务）
DATABASE_URL="$DATABASE_URL" node apps/api/scripts/account-role-migrate.js > /tmp/cutover.log 2>&1
[ $? -eq 0 ] || { echo "FAIL: cutover exit non-zero"; cat /tmp/cutover.log; exit 1; }

# 验证三值映射（带时间窗口防造假）
C_OK=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID' AND account_label='ok-lbl-$TS' AND status='active' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_OK" -eq 1 ] || { echo "FAIL: ok→active 映射失败 count=$C_OK"; exit 1; }

C_EXP=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID' AND account_label='exp-lbl-$TS' AND status='expired' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_EXP" -eq 1 ] || { echo "FAIL: expired→expired 映射失败 count=$C_EXP"; exit 1; }

C_UNK=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID' AND account_label='unk-lbl-$TS' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_UNK" -eq 1 ] || { echo "FAIL: unknown→pending 映射失败 count=$C_UNK"; exit 1; }

# 清理（FK 顺序：ap_sessions → l02_sessions → agents → tenants，DELETE 0 rows 返回 exit 0）
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.line02_account_sessions WHERE agent_id='$CAID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agents WHERE id='$CAID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='$CTID'"
echo "✅ Step 5b cutover 三值映射通过"
```

**硬阈值**:
- ok-lbl → `status='active'`（count=1，5分钟内写入）
- exp-lbl → `status='expired'`（count=1，5分钟内写入）
- unk-lbl → `status='pending'`（count=1，5分钟内写入）

---

### Step 6: 两租户数据隔离（Invariant 铁律验证）

**来源**: `[AI_ADDED]` — PRD Invariant 铁律"所有查询必须带 tenant_id 过滤"，防止跨租户数据泄露

**可观测行为**: 租户 A 的 burner sessions 不出现在租户 B 的响应中

**验证命令**:
```bash
# 见 contract-dod.md [BEHAVIOR] 多租户隔离 manual:bash
# 以及 tests/account-role-unify.test.ts '多租户隔离' 用例
```

**硬阈值**: 租户 B 的 GET /sessions 结果 count = 0（当只有租户 A 有数据时）

---

## 接缝清单（logic-done-pending 直到真目标验证）

| # | 接缝点 | 真目标验证方式 |
|---|---|---|
| 1 | staging DB `agent_platform_sessions` + `agents` LEFT JOIN 查询（需真实 staging DB 有已绑定 agent 数据）| evaluator 对 staging DB 真实执行 GET /sessions，验证返回行含非 null agent_hostname |
| 2 | Windows GHA runner 上 Vite build + API 真实启动（非 mock）| e2e-verify.ps1 在 windows-latest 上运行，Playwright spec 打真实后端 localhost:3000 |

两条接缝在 final-e2e（evaluator 执行 e2e-verify.ps1 in GHA windows-latest）时验证；合并前标 logic-done-pending。

---

## E2E 验收（最终 final-e2e — target_environment: windows_cloud 变体C）

**journey_type**: user_facing
**target_environment**: windows_cloud（GHA windows-latest + Playwright，真实后端，禁 page.route()）

**workflow 文件**: `.github/workflows/e2e-line02-account-role-unify-windows.yml`（问题3修复：明确命名，generator 需创建）

**steps 梗概**（generator 必须在 .yml 里实现）:
```yaml
# .github/workflows/e2e-line02-account-role-unify-windows.yml
name: E2E — Line02 账号角色统一 & 绑定机器列
on:
  pull_request:
    branches: [main]
    paths:
      - 'apps/api/src/routes/agent-burner.ts'
      - 'apps/dashboard/src/pages/AcquisitionAccountsPage.tsx'
      - 'apps/dashboard/e2e/line02-account-role-unify.spec.ts'
  workflow_dispatch:
jobs:
  e2e:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - name: Install deps
        run: npm ci
      - name: Install Windows rollup binding
        run: npm install @rollup/rollup-win32-x64-msvc --no-save
      - name: Run E2E
        shell: pwsh
        env:
          E2E_DATABASE_URL: ${{ secrets.E2E_DATABASE_URL }}
          E2E_SUPER_ADMIN_EMAIL: ${{ secrets.E2E_SUPER_ADMIN_EMAIL }}
          E2E_SUPER_ADMIN_PASSWORD: ${{ secrets.E2E_SUPER_ADMIN_PASSWORD }}
        run: |
          & sprints/07032332-line02-account-role-unify/e2e-verify.ps1
          exit $LASTEXITCODE
```

> windows_cloud 变体C 死规则（全部遵守）:
> 1. Playwright spec 禁止 page.route()
> 2. e2e-verify.ps1 必须先启动 apps/api server（port 3000）并等待就绪
> 3. `VITE_API_BASE_URL` 传给 Vite 以代理到真实后端
> 4. `VITE_SKIP_AUTH=true` 绕过登录界面

<!-- GOLDEN_SMOKE_ABILITY_SLUG: line02-account-role-unify -->
<!-- GOLDEN_SMOKE_TARGET_ENV: local_api -->
<!-- NOTE: smoke scenarios only (local_api curl+psql); full E2E target=windows_cloud (see e2e-verify.ps1) -->

### Scenario 1: api-sessions-has-agent-hostname
<!-- GOLDEN_SMOKE_SCENARIO: api-sessions-has-agent-hostname -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
# 验证 GET /api/agent/burner/sessions 返回含 agent_hostname 字段
# 环境变量：DATABASE_URL / BRAIN_URL
API_URL="${BRAIN_URL:-http://localhost:3000}"

TS=$(date +%s)
TENANT_ID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('smoke-role-$TS', 'sk-$TS', 'free') RETURNING id" | tr -d ' \n')
[ -n "$TENANT_ID" ] || { echo "FAIL: 无法创建测试租户"; exit 1; }

RESP=$(curl -sf -H "X-Tenant-Id: $TENANT_ID" "$API_URL/api/agent/burner/sessions") || {
  psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'"
  echo "FAIL: GET /sessions 未返回 200"; exit 1; }

echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e '.data.sessions | type == "array"' || { echo "FAIL: sessions 非数组"; exit 1; }

COUNT=$(echo "$RESP" | jq '.data.sessions | length')
if [ "$COUNT" -gt 0 ]; then
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_hostname")' || { echo "FAIL: 缺 agent_hostname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("agent_nickname")' || { echo "FAIL: 缺 agent_nickname"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0].role == "burner"' || { echo "FAIL: role != burner"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("account_label")' || { echo "FAIL: 缺 account_label"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("status")' || { echo "FAIL: 缺 status"; exit 1; }
  echo "$RESP" | jq -e '.data.sessions[0] | has("hostname") | not' || { echo "FAIL: 禁用字段 hostname 出现"; exit 1; }
fi

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='$TENANT_ID'"
echo "✅ Scenario 1 通过 sessions_count=$COUNT"
```

### Scenario 2: old-route-deleted-and-file-gone
<!-- GOLDEN_SMOKE_SCENARIO: old-route-deleted-and-file-gone -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 10000 -->

```bash
#!/bin/bash
set -e
test ! -f "apps/dashboard/src/pages/DouyinBurnerBindPage.tsx" || { echo "FAIL: 文件未删除"; exit 1; }
grep -q "DouyinBurnerBind" "apps/dashboard/src/config/navigation.config.ts" && { echo "FAIL: navigation.config 仍有引用"; exit 1; } || true
grep -q "douyin-burner-bind" "apps/dashboard/src/config/navigation.config.ts" && { echo "FAIL: navigation.config 仍有路径"; exit 1; } || true
grep -q "douyin-burner-bind" "apps/dashboard/src/pages/AreaHubPage.tsx" && { echo "FAIL: AreaHubPage 仍有旧链接"; exit 1; } || true
echo "✅ Scenario 2 通过 — 旧页面已物理删除，导航配置及 AreaHubPage 已清理"
```

### Scenario 3: migration-dry-run-exits-zero
<!-- GOLDEN_SMOKE_SCENARIO: migration-dry-run-exits-zero -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 30000 -->

```bash
#!/bin/bash
set -e
test -f "apps/api/scripts/account-role-migrate.js" || { echo "FAIL: 迁移脚本不存在"; exit 1; }
grep -q "dry-run\|dryRun" "apps/api/scripts/account-role-migrate.js" || { echo "FAIL: 迁移脚本缺 dry-run 参数处理"; exit 1; }
grep -q "active\|pending" "apps/api/scripts/account-role-migrate.js" || { echo "FAIL: 迁移脚本缺三值映射逻辑"; exit 1; }
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
API_URL="${BRAIN_URL:-http://localhost:3000}"
TS=$(date +%s)
TA=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('iso-a-$TS', 'ka-$TS', 'free') RETURNING id" | tr -d ' \n')
TB=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('iso-b-$TS', 'kb-$TS', 'free') RETURNING id" | tr -d ' \n')

AID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$TA', 'mac-iso-$TS', 'host-a', 'online') RETURNING id" | tr -d ' \n')
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role, status, created_at, bound_at) VALUES ('$AID', 'douyin', 'iso-label', 'burner', 'active', NOW(), NOW())"

RESP_B=$(curl -sf -H "X-Tenant-Id: $TB" "$API_URL/api/agent/burner/sessions") || { echo "FAIL: B GET /sessions 失败"; exit 1; }
echo "$RESP_B" | jq -e '.success == true' || { echo "FAIL: B GET /sessions success!=true"; exit 1; }
CNT=$(echo "$RESP_B" | jq '.data.sessions | length')
[ "$CNT" -eq 0 ] || { echo "FAIL: 跨租户泄露，B 看到 $CNT 条 A 的 sessions"; exit 1; }

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$AID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agents WHERE id='$AID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id IN ('$TA','$TB')"
echo "✅ Scenario 4 通过 — 多租户隔离正常"
```

### Scenario 5: cutover-health-mapping
<!-- GOLDEN_SMOKE_SCENARIO: cutover-health-mapping -->
<!-- GOLDEN_SMOKE_TIMEOUT_MS: 60000 -->

```bash
#!/bin/bash
set -e
# 验证 cutover 三值映射：ok→active, expired→expired, unknown→pending
TS=$(date +%s)
CTID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name, license_key, plan) VALUES ('cut-$TS', 'ck-$TS', 'free') RETURNING id" | tr -d ' \n')
CAID=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.agents (tenant_id, machine_id, hostname, status) VALUES ('$CTID', 'mac-c-$TS', 'cut-host', 'online') RETURNING id" | tr -d ' \n')
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.line02_account_sessions (agent_id, platform, account_label, health, tenant_id) VALUES ('$CAID','douyin','ok-$TS','ok','$CTID'), ('$CAID','douyin','exp-$TS','expired','$CTID'), ('$CAID','douyin','unk-$TS','unknown','$CTID')"

DATABASE_URL="$DATABASE_URL" node apps/api/scripts/account-role-migrate.js > /tmp/cut.log 2>&1
[ $? -eq 0 ] || { echo "FAIL: cutover exit non-zero"; cat /tmp/cut.log; exit 1; }

C_OK=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID' AND account_label='ok-$TS' AND status='active' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_OK" -eq 1 ] || { echo "FAIL: ok→active count=$C_OK"; exit 1; }
C_EXP=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID' AND account_label='exp-$TS' AND status='expired' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_EXP" -eq 1 ] || { echo "FAIL: expired→expired count=$C_EXP"; exit 1; }
C_UNK=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID' AND account_label='unk-$TS' AND status='pending' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C_UNK" -eq 1 ] || { echo "FAIL: unknown→pending count=$C_UNK"; exit 1; }

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agent_platform_sessions WHERE agent_id='$CAID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.line02_account_sessions WHERE agent_id='$CAID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.agents WHERE id='$CAID'"
psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='$CTID'"
echo "✅ Scenario 5 cutover 三值映射通过"
```
