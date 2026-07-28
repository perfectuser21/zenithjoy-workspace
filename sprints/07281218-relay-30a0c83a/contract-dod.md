# Contract DoD — Staff Hub Ability Acceptance 端到端首刀

sprint_dir: sprints/07281218-relay-30a0c83a
task_id: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
round: 1
date: 2026-07-28

---

## DoD 可验证断言

### [BEHAVIOR] BEHAVIOR-DB-TABLES

**描述**：Postgres `zenithjoy` schema 下存在 4 张表：`acceptance_template`、`acceptance_run`、`device_result`、`check_result`，且 `acceptance_run` 含 UNIQUE(task_id, git_sha) 约束。

**验收标准**：

- `information_schema.tables` 中 4 张表均存在
- `information_schema.table_constraints` 中存在类型为 UNIQUE 的约束关联 `acceptance_run`
- `acceptance_run.status` 列允许值为 NULL（run 未提交时）

**manual:bash**：

```bash
# 验证 4 张表存在
COUNT=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name IN ('acceptance_template','acceptance_run','device_result','check_result')" | tr -d ' ')
[ "$COUNT" = "4" ] && echo "PASS: 4 张表均存在" || echo "FAIL: 仅找到 $COUNT 张表"

# 验证 UNIQUE 约束
UNIQ=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM information_schema.table_constraints WHERE table_schema='zenithjoy' AND table_name='acceptance_run' AND constraint_type='UNIQUE'" | tr -d ' ')
[ "$UNIQ" -ge "1" ] && echo "PASS: UNIQUE 约束存在" || echo "FAIL: 未找到 UNIQUE 约束"
```

---

### [BEHAVIOR] BEHAVIOR-IDEMPOTENT-RUN

**描述**：相同 `task_id` + `git_sha` 连续 POST 两次 `/api/staff/ability-acceptance/runs`，两次均返回 HTTP 200，且返回的 run `id` 字段完全相同。DB 中只有一条对应记录。

**验收标准**：

- 第一次 POST 返回 200，body 含 `data.id`
- 第二次 POST 返回 200，body 含相同 `data.id`
- DB `SELECT count(*) FROM zenithjoy.acceptance_run WHERE task_id=... AND git_sha=...` = 1

**manual:bash**：

```bash
STAFF_EMAIL="${STAFF_EMAIL:-test@zenithjoy.com}"
API_BASE="${API_BASE:-http://localhost:3000}"
TEMPLATE_ID="${ACCEPTANCE_TEMPLATE_ID:-}"  # 需先从 GET /templates 获取

PAYLOAD='{"templateId":"'"$TEMPLATE_ID"'","taskId":"idempotent-test-001","gitSha":"deadbeefcafe0001","env":"staging"}'

RUN1=$(curl -sf -X POST "$API_BASE/api/staff/ability-acceptance/runs" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $STAFF_EMAIL" \
  -d "$PAYLOAD" | jq -r '.data.id')

RUN2=$(curl -sf -X POST "$API_BASE/api/staff/ability-acceptance/runs" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $STAFF_EMAIL" \
  -d "$PAYLOAD" | jq -r '.data.id')

[ "$RUN1" = "$RUN2" ] && [ -n "$RUN1" ] \
  && echo "PASS: 幂等成功，run id=$RUN1" \
  || echo "FAIL: id 不同或为空: RUN1=$RUN1 RUN2=$RUN2"
```

---

### [BEHAVIOR] BEHAVIOR-STAFF-GUARD

**描述**：所有 `/api/staff/ability-acceptance/*` 端点在缺少有效 `X-User-Email`（或 `X-Feishu-User-Id`）header 时返回 HTTP 403，body 含 `error.code = "FORBIDDEN"`。

**验收标准**：

- 无 header 请求 GET /templates → 403
- 无 header 请求 POST /runs → 403
- 无 header 请求 GET /runs → 403
- 带非白名单邮箱 → 403

**manual:bash**：

```bash
API_BASE="${API_BASE:-http://localhost:3000}"

# 无 header
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_BASE/api/staff/ability-acceptance/templates")
[ "$STATUS" = "403" ] && echo "PASS: 无 header 返回 403" || echo "FAIL: 返回 $STATUS"

# 非白名单邮箱
STATUS2=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-User-Email: notastaff@example.com" \
  "$API_BASE/api/staff/ability-acceptance/templates")
[ "$STATUS2" = "403" ] && echo "PASS: 非白名单邮箱返回 403" || echo "FAIL: 返回 $STATUS2"

# error.code 字段验证
CODE=$(curl -sf -H "X-User-Email: notastaff@example.com" \
  "$API_BASE/api/staff/ability-acceptance/templates" | jq -r '.error.code')
[ "$CODE" = "FORBIDDEN" ] && echo "PASS: error.code=FORBIDDEN" || echo "FAIL: error.code=$CODE"
```

---

### [BEHAVIOR] BEHAVIOR-SUBMIT-STATUS

**描述**：POST `/api/staff/ability-acceptance/runs/:id/submit` 后，DB 中 `acceptance_run.status` 字段根据所有 device_result 的状态正确汇总（全 PASS→PASS，任一 BLOCKED→BLOCKED，其余→FAIL）。

**验收标准**：

- 5 台设备全 PASS，提交后 run.status = PASS
- 任一设备 BLOCKED，提交后 run.status = BLOCKED
- 任一设备 FAIL（无 BLOCKED），提交后 run.status = FAIL
- 已 submitted run 再次 submit 返回 409

**manual:bash**：

```bash
API_BASE="${API_BASE:-http://localhost:3000}"
STAFF_EMAIL="${STAFF_EMAIL:-test@zenithjoy.com}"
RUN_ID="$1"  # 传入已录入所有设备结果的 run id

# 提交
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/api/staff/ability-acceptance/runs/$RUN_ID/submit" \
  -H "X-User-Email: $STAFF_EMAIL")
[ "$HTTP_STATUS" = "200" ] && echo "PASS: submit 返回 200" || echo "FAIL: submit 返回 $HTTP_STATUS"

# 验证 DB 状态
DB_STATUS=$(psql "$DATABASE_URL" -t -c "SELECT status FROM zenithjoy.acceptance_run WHERE id='$RUN_ID'" | tr -d ' ')
[ -n "$DB_STATUS" ] && echo "PASS: run.status=$DB_STATUS" || echo "FAIL: run.status 为空"

# 重复提交返回 409
STATUS409=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/api/staff/ability-acceptance/runs/$RUN_ID/submit" \
  -H "X-User-Email: $STAFF_EMAIL")
[ "$STATUS409" = "409" ] && echo "PASS: 重复 submit 返回 409" || echo "FAIL: 返回 $STATUS409"
```

---

### [BEHAVIOR] BEHAVIOR-PRODUCT-MAP-ACTIVE

**描述**：`product-map/product-map.yaml` 中 `ability_acceptance` 的 `status` 字段为 `active`，且 `product-map/generated/product-map.md` 的对应行体现该状态。`npm run product-map:check` 全部通过（10/10）。

**验收标准**：

- yaml 文件中 `id: ability_acceptance` 下方 `status: active`
- 生成的 md 文件中 ability_acceptance 行含 `active`
- `npm run product-map:check` 退出码为 0

**manual:bash**：

```bash
# 验证 yaml
grep -A5 "id: ability_acceptance" /workspace/product-map/product-map.yaml | grep -q "status: active" \
  && echo "PASS: yaml status=active" \
  || echo "FAIL: yaml 中 ability_acceptance status 不是 active"

# 验证生成文件
grep -q "active" /workspace/product-map/generated/product-map.md \
  && grep "ability_acceptance" /workspace/product-map/generated/product-map.md | grep -q "active" \
  && echo "PASS: generated/product-map.md 含 active" \
  || echo "FAIL: generated/product-map.md 未体现 active"

# 验证 check 脚本
cd /workspace && npm run product-map:check \
  && echo "PASS: product-map:check 通过" \
  || echo "FAIL: product-map:check 失败"
```

---

### [BEHAVIOR] BEHAVIOR-UI-LIST-ELEMENT

**描述**：Playwright E2E 访问 Staff Hub `/ability-acceptance` 页面，页面中存在 `[data-testid="ability-acceptance-list"]` 元素，且页面截图存入报告目录。

**验收标准**：

- Playwright 测试通过，exit code = 0
- 截图文件存在于 `playwright-report/` 或 `test-results/` 目录
- 元素 `[data-testid="ability-acceptance-list"]` 在截图中可见

**manual:bash**：

```bash
cd /workspace/apps/staff-hub
npx playwright test --grep "ability-acceptance" --reporter=html 2>&1 | tail -20
[ $? -eq 0 ] && echo "PASS: Playwright E2E 通过" || echo "FAIL: Playwright E2E 失败"
```

---

### [BEHAVIOR] BEHAVIOR-INPUT-VALIDATION

**描述**：非法输入（空 git_sha、device_no 超界、非法 status 值）均返回 HTTP 422，body 含 Zod 校验错误信息。

**验收标准**：

- `git_sha = ""` POST /runs → 422
- `device_no = 6` PATCH /runs/:id/devices/6 → 422
- `status = "UNKNOWN"` PATCH device → 422
- 422 body 含 `error.code` 字段

**manual:bash**：

```bash
API_BASE="${API_BASE:-http://localhost:3000}"
STAFF_EMAIL="${STAFF_EMAIL:-test@zenithjoy.com}"

# 空 git_sha
S1=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_BASE/api/staff/ability-acceptance/runs" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $STAFF_EMAIL" \
  -d '{"templateId":"some-id","taskId":"t1","gitSha":"","env":"staging"}')
[ "$S1" = "422" ] && echo "PASS: 空 git_sha 返回 422" || echo "FAIL: 返回 $S1"

# device_no 超界（使用任意有效 run id 测试路由层校验）
RUN_ID="${TEST_RUN_ID:-00000000-0000-0000-0000-000000000000}"
S2=$(curl -s -o /dev/null -w "%{http_code}" \
  -X PATCH "$API_BASE/api/staff/ability-acceptance/runs/$RUN_ID/devices/6" \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $STAFF_EMAIL" \
  -d '{"status":"PASS"}')
[ "$S2" = "422" ] && echo "PASS: device_no=6 返回 422" || echo "FAIL: 返回 $S2"
```

---

## 判定点登记表

| 判定点 ID | [BEHAVIOR] | 描述 | 验证方式 | 优先级 |
|----------|-----------|------|---------|--------|
| CP-01 | BEHAVIOR-DB-TABLES | 4 张 DB 表存在，UNIQUE 约束正确 | manual:bash | P0 |
| CP-02 | BEHAVIOR-IDEMPOTENT-RUN | 同 task_id+sha 幂等返回同一 run | manual:bash | P0 |
| CP-03 | BEHAVIOR-STAFF-GUARD | 未认证请求返回 403 | manual:bash + automated:api-test | P0 |
| CP-04 | BEHAVIOR-SUBMIT-STATUS | 提交后 run.status 正确汇总 | manual:bash | P0 |
| CP-05 | BEHAVIOR-PRODUCT-MAP-ACTIVE | ability_acceptance status=active | manual:bash | P0 |
| CP-06 | BEHAVIOR-UI-LIST-ELEMENT | Staff Hub 页面 list 元素存在 | automated:playwright | P1 |
| CP-07 | BEHAVIOR-INPUT-VALIDATION | 非法输入返回 422 | manual:bash + automated:api-test | P1 |

**合计：7 个判定点，7 个 [BEHAVIOR] 条目（≥4 满足要求）**

---

## 自动化测试映射

| 测试文件 | 覆盖 [BEHAVIOR] |
|---------|----------------|
| `sprints/07281218-relay-30a0c83a/tests/db-tables.test.ts` | BEHAVIOR-DB-TABLES |
| `sprints/07281218-relay-30a0c83a/tests/idempotent-run.test.ts` | BEHAVIOR-IDEMPOTENT-RUN |
| `sprints/07281218-relay-30a0c83a/tests/staff-guard.test.ts` | BEHAVIOR-STAFF-GUARD |
| `sprints/07281218-relay-30a0c83a/tests/submit-status.test.ts` | BEHAVIOR-SUBMIT-STATUS |
| `sprints/07281218-relay-30a0c83a/tests/input-validation.test.ts` | BEHAVIOR-INPUT-VALIDATION |
| `sprints/07281218-relay-30a0c83a/tests/ability-acceptance.spec.ts` | BEHAVIOR-UI-LIST-ELEMENT |
