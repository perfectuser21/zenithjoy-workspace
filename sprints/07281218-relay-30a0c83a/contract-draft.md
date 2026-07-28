# Contract Draft — Staff Hub Ability Acceptance 端到端首刀

sprint_dir: sprints/07281218-relay-30a0c83a
task_id: 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a
journey_id: 636a918c-8b23-4df5-baec-b1eb3308fffb
feature_id: 09edf50f-6cd3-4fda-8b21-7d2efcd075ec
round: 1
date: 2026-07-28

---

## Golden Path

**场景：Staff 完成 Line02/Android 首次 Ability Acceptance Run**

```
[Staff Hub /ability-acceptance]
  → 选 Line02/Android target（从 acceptance_template 读取）
  → 系统返回含 FR/NFR/Invariant/SOP 的模板内容
  → POST /runs（幂等）创建 acceptance_run
  → 录入最多 5 台设备的 device_result + check_result
  → POST /runs/:id/submit 提交，汇总状态写入 run.status
  → GET /runs?templateId=&status= 历史回看，列表可见刚提交的 run
```

---

## 场景清单

### 场景 S1 — Product Map 保序修复与状态推进

- `npm run product-map:check` 输出 10/10 PASS
- `product-map/product-map.yaml` ability_acceptance.status = `active`
- `product-map/generated/product-map.md` 中 ability_acceptance 行 status 列为 `active`
- 任何手改 `generated/` 目录的 PR 被拒（INV3）

### 场景 S2 — 数据库迁移：4 张表创建

- psql 查询 `information_schema.tables`（`zenithjoy` schema）返回 4 张表
- 表包含：`acceptance_template`、`acceptance_run`、`device_result`、`check_result`
- `acceptance_run` 含 `UNIQUE(task_id, git_sha)` 约束
- `device_result` 含 `device_no` ∈ [1,5] 约束（check constraint）

### 场景 S3 — staffGuard 保护：未认证请求返回 403

- 不带 `X-User-Email` 或 `X-Feishu-User-Id` header 请求任何 `/api/staff/ability-acceptance/*` 路由
- 返回 HTTP 403，body `{ success: false, error.code: "FORBIDDEN" }`

### 场景 S4 — 幂等创建 acceptance_run

- 相同 `task_id` + `git_sha` POST 两次 `/api/staff/ability-acceptance/runs`
- 两次均返回 HTTP 200，返回 run 的 `id` 字段相同
- DB 中只有一条记录（UNIQUE 约束无冲突）

### 场景 S5 — 设备结果录入与汇总提交

- PATCH `/api/staff/ability-acceptance/runs/:id/devices/1` 录入 status=PASS
- PATCH 同 run 的 device 2-5 均为 PASS
- POST `/api/staff/ability-acceptance/runs/:id/submit`
- DB `acceptance_run.status` = `PASS`

### 场景 S6 — BLOCKED 汇总逻辑

- 任意一台设备 status=BLOCKED，其余 PASS
- 提交后 run.status = `BLOCKED`

### 场景 S7 — 重复提交返回 409

- 已 submitted 的 run 再次 POST submit
- 返回 HTTP 409

### 场景 S8 — 非法输入返回 422

- `git_sha` 为空字符串 POST `/runs`，返回 422
- `device_no` = 6 PATCH device，返回 422
- `status` = `UNKNOWN` PATCH device，返回 422

### 场景 S9 — Staff Hub 页面真实数据渲染

- Playwright 打开 `/ability-acceptance`
- 页面含 `[data-testid="ability-acceptance-list"]` 元素
- 版本号来自 Brain API 或 GitHub API（非硬编码），Brain 不可达时显示"暂不可用"

### 场景 S10 — 历史回看列表

- `GET /api/staff/ability-acceptance/runs?templateId=<id>&status=PASS`
- 返回分页列表，包含已提交 PASS 的 run

---

## E2E 验收

### E2E1 — 数据库表存在性验证

```bash
psql $DATABASE_URL -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name IN ('acceptance_template','acceptance_run','device_result','check_result')"
```
预期输出：`4`

### E2E2 — 幂等 run 创建

```bash
RUN1=$(curl -sf -X POST $API_BASE/api/staff/ability-acceptance/runs \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $STAFF_EMAIL" \
  -d '{"templateId":"<template_id>","taskId":"test-task-001","gitSha":"abc123def456","env":"staging"}' \
  | jq -r '.data.id')
RUN2=$(curl -sf -X POST $API_BASE/api/staff/ability-acceptance/runs \
  -H "Content-Type: application/json" \
  -H "X-User-Email: $STAFF_EMAIL" \
  -d '{"templateId":"<template_id>","taskId":"test-task-001","gitSha":"abc123def456","env":"staging"}' \
  | jq -r '.data.id')
[ "$RUN1" = "$RUN2" ] && echo "PASS: 幂等 run id 相同 $RUN1" || echo "FAIL: id 不同 $RUN1 != $RUN2"
```
预期：`PASS: 幂等 run id 相同 <uuid>`

### E2E3 — Playwright UI 截图验证

```bash
cd apps/staff-hub && npx playwright test --grep "ability-acceptance" --reporter=html
```
预期：截图中 `[data-testid="ability-acceptance-list"]` 元素可见，截图存入 `playwright-report/`

### E2E4 — 提交后 DB 状态验证

```bash
RUN_ID=<run_id>
STATUS=$(psql $DATABASE_URL -t -c "SELECT status FROM zenithjoy.acceptance_run WHERE id='$RUN_ID'")
[ -n "$STATUS" ] && echo "PASS: run status=$STATUS" || echo "FAIL: status 为 null"
```
预期：`PASS: run status=PASS`（或 FAIL/BLOCKED，取决于 device 录入）

### E2E5 — Product Map active 状态验证

```bash
grep -A3 "ability_acceptance" product-map/generated/product-map.md | grep -q "active" \
  && echo "PASS: ability_acceptance status=active" \
  || echo "FAIL: status 不是 active"
```
预期：`PASS: ability_acceptance status=active`

---

## 未覆盖真实链路清单

| 编号 | 链路 | 未覆盖原因 | 风险 |
|------|------|-----------|------|
| U1 | Brain API 真实版本/差异数获取 | Brain 服务在 CI 中不可达，降级逻辑需 mock | 中：降级显示"暂不可用"但未验证真实 API 响应格式 |
| U2 | 多租户写隔离（cross-staff 写操作拦截） | 本期范围外（只读全量，写绑定 created_by） | 低：已在 NFR2/INV1 明确为非本期目标 |
| U3 | 生产数据库真实迁移执行 | CI 用沙箱 DB，生产迁移需 hk-vps+mmv 手动跑 | 高：需在部署文档中明确 migration 步骤 |
| U4 | Playwright E2E 飞书登录真实 OAuth 流程 | 飞书 OAuth 凭据不在 CI 中 | 中：登录用 stub/mock，实际页面鉴权未 E2E 覆盖 |
| U5 | 超过 5 台设备的 UI 层阻止 | 422 仅在 API 层验证，前端 UI 是否同样阻止未测 | 低：API 层已有 check，UI 只是体验问题 |

---

## 判定点登记表

| 判定点 ID | 描述 | 对应 [BEHAVIOR] | 验证方式 |
|----------|------|----------------|---------|
| CP-01 | 4 张 DB 表存在且 schema 正确 | BEHAVIOR-DB-TABLES | manual:bash (E2E1) |
| CP-02 | 幂等 run 创建（同 task_id+sha 返回同一 id） | BEHAVIOR-IDEMPOTENT-RUN | manual:bash (E2E2) |
| CP-03 | staffGuard 未认证返回 403 | BEHAVIOR-STAFF-GUARD | automated:api-test |
| CP-04 | 提交后 run.status 非 null 且正确 | BEHAVIOR-SUBMIT-STATUS | manual:bash (E2E4) |
| CP-05 | ability_acceptance status=active 在生成文件中体现 | BEHAVIOR-PRODUCT-MAP-ACTIVE | manual:bash (E2E5) |
| CP-06 | Staff Hub 页面 list 元素存在 | BEHAVIOR-UI-LIST-ELEMENT | automated:playwright (E2E3) |

**合计：6 个判定点，覆盖 6 个 [BEHAVIOR]**
