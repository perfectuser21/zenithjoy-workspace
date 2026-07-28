# Contract DoD — Staff Hub Ability Acceptance 端到端首刀

**Sprint ID:** 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a  
**合同法则：合同即法律（CONTRACT IS LAW）**

---

## DoD 定义：何为"完成"

本 Sprint 的每个交付物必须满足以下所有条件，缺一不可：

---

## 必须全绿的 CI Gate

| Gate | 命令 / 工作流 | 通过标准 |
|------|--------------|---------|
| product-map 单元测试 | `node --test scripts/product-map/__tests__/product-map.test.js` | T1-T7 全 PASS（含 T3 `ability_acceptance.status=active`，T6 digest 确定性） |
| API 单元测试 | `npm run test --workspace=apps/api -- ability-acceptance` | ability-acceptance.test.ts 全用例 PASS |
| CI l2 consistency | `.github/workflows/ci-l2-consistency.yml` → `ability-acceptance-smoke` job | 绿 |

---

## 必须存在且正确的交付物

### [Fix] product-map 保序

- [ ] `scripts/product-map/lib.mjs`：`canonicalize()` 函数对 `golden_paths` 数组按 `id` 字母序排序后再计算 digest
- [ ] `scripts/product-map/cli.mjs`：`generate` 命令生成 JSON/MD 时保持 `golden_paths` 按 `id` 字母序
- [ ] `product-map/product-map.yaml`：`ability_acceptance.status: active`（已从 `proposed` 升级）
- [ ] `product-map/generated/product-map.json`：已重新生成，`golden_paths` 按 `id` 字母序，`ability_acceptance.status: active`
- [ ] `product-map/generated/product-map.md`：已重新生成
- [ ] `package.json` 根 devDependencies 含 `ajv@^8.17.1` + `ajv-formats@^3.0.1`
- [ ] **验证：** `node --test scripts/product-map/__tests__/product-map.test.js` 全 7 用例 PASS

### [DB] 迁移文件

- [ ] 文件存在：`apps/api/db/migrations/20260728_ability_acceptance.sql`
- [ ] 含四张表 DDL：`acceptance_template`、`acceptance_run`、`device_result`、`check_result`
- [ ] `acceptance_run` 含 UNIQUE(tenant_id, task_id, sha) 约束
- [ ] `acceptance_run.status` CHECK 约束：`IN ('in_progress', 'submitted', 'cancelled')`
- [ ] `device_result.device_index` CHECK 约束：`BETWEEN 1 AND 5`
- [ ] `check_result.result` CHECK 约束：`IN ('PASS', 'FAIL', 'BLOCKED', 'pending')`
- [ ] `acceptance_template.kind` CHECK 约束：`IN ('FR', 'NFR', 'Invariant', 'SOP')`
- [ ] tenant_id 索引存在（`acceptance_run`、`acceptance_template`）
- [ ] 版本审计字段存在（`created_at`、`created_by`）

### [API] ability-acceptance 路由

- [ ] 文件存在：`apps/api/src/routes/ability-acceptance.ts`
- [ ] 7 个端点全部实现：GET /templates、GET /versions、POST /runs、GET /runs、GET /runs/:runId、POST /runs/:runId/devices/:deviceIndex/checks、POST /runs/:runId/submit
- [ ] 所有端点均使用 `staffGuard` 中间件
- [ ] 路由已在 `apps/api/src/app.ts` 挂载为 `/api/staff/ability-acceptance`
- [ ] `GET /versions`：版本来源优先级 env var → VERSION 文件 → Unknown，禁止硬编码假版本
- [ ] `POST /runs`：幂等（同 tenant_id+task_id+sha → 返回已有 run_id + created:false）
- [ ] `POST /submit`：提交后 `POST /checks` 返回 400 `RUN_ALREADY_SUBMITTED`
- [ ] `device_index > 5`：返回 400 `DEVICE_INDEX_OUT_OF_RANGE`
- [ ] `result` 非法值：返回 400 输入校验错误

### [API 单测]

- [ ] 文件存在：`apps/api/src/routes/__tests__/ability-acceptance.test.ts`
- [ ] 覆盖 401/403 场景（无认证头 → 403 FORBIDDEN）
- [ ] 覆盖幂等创建（同参数两次 POST 返回相同 run_id，created:false）
- [ ] 覆盖输入校验（非法 result、device_index 超范围）
- [ ] 覆盖 audit 字段写入（created_by 来自 X-User-Email 头）
- [ ] 覆盖多租户隔离（≥2 tenant，断言互不串）

### [前端] Staff Hub

- [ ] `apps/staff-hub/src/App.tsx`：新增「Ability 验收」NavLink（`ClipboardCheck` 图标）+ `/ability-acceptance` 路由 + `/ability-acceptance/history` 路由
- [ ] 文件存在：`apps/staff-hub/src/pages/AbilityAcceptancePage.tsx`（版本概览 + 创建/继续 run + 逐条验收 + 提交）
- [ ] 文件存在：`apps/staff-hub/src/pages/AbilityAcceptanceHistoryPage.tsx`（历史 run 列表 + 明细）
- [ ] 页面含 `data-testid="version-staging"` + `data-testid="version-production"` 元素
- [ ] 页面含 `data-testid="acceptance-checklist"` 元素
- [ ] 提交后显示「验收已提交」文字
- [ ] 历史页含 `data-testid="run-detail"` 可展开元素

### [E2E] Playwright

- [ ] 文件存在：`apps/dashboard/e2e/ability-acceptance.spec.ts`
- [ ] 全部 5 个场景通过（C1-C5）
- [ ] 使用 `page.route` mock API，不依赖真实 DB

### [合同 E2E 脚本]

- [ ] 文件存在：`sprints/07281218-relay-30a0c83a/e2e-contract.sh`
- [ ] 可执行（chmod +x）
- [ ] 覆盖全部 9 条 API 集成断言（B1-B9）
- [ ] 需要环境变量：`$API_BASE`、`$DB`（psql DSN）、`$STAFF_EMAIL`（白名单邮箱）

**手动执行合同 E2E：**

manual:bash bash sprints/07281218-relay-30a0c83a/e2e-contract.sh

**product-map 合同 E2E：**

manual:bash node --test scripts/product-map/__tests__/product-map.test.js

---

## 行为断言（[BEHAVIOR] 标签）

[BEHAVIOR] B1 无认证 → 403：`curl -s -o /dev/null -w "%{http_code}" $API_BASE/api/staff/ability-acceptance/runs` → HTTP 403，`error.code=FORBIDDEN`

[BEHAVIOR] B3 幂等首次创建：`POST $API_BASE/api/staff/ability-acceptance/runs {task_id:"30a0c83a",sha:"abc1234"}` → HTTP 200，`data.created===true`，`data.run_id` 为 UUID 格式

[BEHAVIOR] B4 幂等复用：相同 task_id+sha 二次 POST `/runs` → HTTP 200，`data.created===false`，`data.run_id` 与首次相同

[BEHAVIOR] B6 提交后锁定：`POST /runs/:runId/submit` 成功后再 `POST /runs/:runId/devices/1/checks` → HTTP 400，`error.code=RUN_ALREADY_SUBMITTED`

[BEHAVIOR] B9 租户隔离：用 tenant_b 的 X-User-Email 头 `GET /runs` → 响应 `data` 数组不含 tenant_a 创建的 run_id

### [CI Gate]

- [ ] `.github/workflows/ci-l2-consistency.yml` 新增 `ability-acceptance-smoke` job
- [ ] job 运行：`npm install` → `node --test scripts/product-map/__tests__/product-map.test.js`
- [ ] job 断言 `ability_acceptance.status === 'active'`

---

## 累积 FR 不得回退

- [ ] `POST /api/staff/skill-eval/upload` 不带认证头仍返回 403（R1）
- [ ] `GET /api/staff/path-health` 仍返回三条 path 的 journey features（R2）
- [ ] `productMapDigest` 保序确定性（R3 — 本 sprint 新增累积 FR）

---

## 禁止事项（违反 = PR 被拒）

- [ ] 无 `*New.tsx` / `*Old.tsx` / `*Backup.*` 临时文件
- [ ] 无根目录临时脚本
- [ ] 无 console.log 遗留（除 debug 注释明确标注的）
- [ ] 无未使用的 import
- [ ] 无硬编码版本号、邮箱、secret
- [ ] 无对 main 的直接推送

---

## 完成标准总结

**全部 ✓ = 本 Sprint DONE**  
**任一 ✗ = 未完成，需继续推进**

合同铁律：**7/7 铁律全部覆盖，27 个判定点全部通过，3 个累积 FR 不回退。**
