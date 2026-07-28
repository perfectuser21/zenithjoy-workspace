# Contract Draft — Staff Hub Ability Acceptance 端到端首刀

**Sprint ID:** 30a0c83a-47f4-4151-9636-a8cd2b6f1d7a  
**Sprint Dir:** `sprints/07281218-relay-30a0c83a`  
**合同版本:** v1（首轮，无 reviewer feedback）  
**生成时间:** 2026-07-28  

---

## 铁律覆盖（7/7）

| # | 铁律 | 对应合同断言 |
|---|------|------------|
| 1 | **[租户隔离]** 跨租户数据绝不混读/混写 | C9（API 集成）：tenant_b 查询不含 tenant_a run_id |
| 2 | **[测试默认多租户]** 单元/API 集成测试默认种 ≥2 tenant 并断言互不串 | API 单测 T4/T5 种两个租户并断言隔离 |
| 3 | **[日志脱敏]** PII 不得明文进日志 | API 单测 T6 断言无 email 泄漏到 error 响应体 |
| 4 | **[端点鉴权]** 所有 `/api/staff/ability-acceptance/*` 必须有 staffGuard | C1（API 集成）+ API 单测 T1/T2：无认证 → 403 FORBIDDEN |
| 5 | **[凭据安全]** secrets 不硬编码、不进 git、不进日志 | 迁移文件 DDL 无硬编码 secret；合同检查 |
| 6 | **[真环境验证才算 done]** 公网 VPS URL 须真实访问 | C Phase D（部署验收）：curl `https://staff.zenjoymedia.media/ability-acceptance` HTTP 200 |
| 7 | **[product-map 唯一写源]** `ability_acceptance` 状态只在 `product-map.yaml` 改 | Phase A T3：`ability_acceptance.status === 'active'`（YAML→JSON→测试三层一致） |

---

## 判定点清单（27 个）

### Phase A — product-map 保序合同 E2E（7 个判定点）

运行命令：`node --test scripts/product-map/__tests__/product-map.test.js`

| ID | 判定点 | 期望值 | 技术断言 |
|----|--------|--------|---------|
| A1 | T1 全通过：map 解析两个 app，结构完整 | PASS | `errors === []`，`appIds === ['customer_app','staff_app']` |
| A2 | T2 全通过：负向 schema 校验 | PASS | 缺 apps 字段时 `errors.length > 0` |
| A3 | T3 全通过：`ability_acceptance.status === 'active'` | PASS | `abilityGp.status === 'active'`（本 sprint 升级后）（依赖 product-map.yaml 与 product-map.test.js T3 断言同步修改，缺任一则 CI 红） |
| A4 | T4 全通过：关系校验正向 | PASS | `validateRelations(map) === []` |
| A5 | T5 全通过：关系校验三个负向用例 | PASS | missing_app / unknown_surface / duplicate GP 三个断言均触发 |
| A6 | T6 全通过：`productMapDigest` 确定性（保序修复验证） | PASS | `d1 === d2`，格式 `/^[a-f0-9]{64}$/` |
| A7 | T7 全通过：bootstrap parity | PASS | 干净 doc 不抛；注入 customer_app 抛 "duplicates Product Map fact" |

### Phase B — API 集成合同 E2E（9 个判定点）

脚本：`sprints/07281218-relay-30a0c83a/e2e-contract.sh`

| ID | 判定点 | 期望值 |
|----|--------|--------|
| B1 | 无认证头访问 `GET /api/staff/ability-acceptance/runs` | HTTP 403，`error.code === "FORBIDDEN"` |
| B2 | 带 `X-User-Email: $STAFF_EMAIL` 访问 `GET /api/staff/ability-acceptance/versions` | HTTP 200，`data.staging.version` 非 null，`data.production.version` 非 null（可为 Unknown 字符串） |
| B3 | 首次 `POST /runs`（task_id=30a0c83a, sha=abc1234） | HTTP 200，`created === true`，`run_id` 为 UUID 格式 |
| B4 | 同参数二次 `POST /runs` | HTTP 200，`created === false`，`run_id` 与 B3 相同 |
| B5 | `POST /runs/:runId/devices/1/checks`（result=PASS） | HTTP 200，`success === true` |
| B6 | `POST /runs/:runId/submit` | HTTP 200，`success === true`，run status → submitted |
| B7 | submit 后再 `POST /checks` | HTTP 400，`error.code === "RUN_ALREADY_SUBMITTED"` |
| B8 | DB 查 `acceptance_run.created_by` | 等于 `$STAFF_EMAIL`（来自 X-User-Email 头，非 null，非空） |
| B9 | 用 tenant_b 头查 `GET /runs` | 不含 tenant_a 创建的 run_id（租户隔离） |

### Phase C — Playwright E2E（5 个判定点）

文件：`apps/dashboard/e2e/ability-acceptance.spec.ts`（windows_cloud）

| ID | 判定点 | 可见断言 |
|----|--------|---------|
| C1 | staff 登录后左侧导航可见「Ability 验收」入口 | `page.locator('text=Ability 验收')` visible |
| C2 | 访问 `/ability-acceptance`，版本概览卡片可见（staging / production 版本字段） | `[data-testid="version-staging"]` + `[data-testid="version-production"]` visible |
| C3 | 点击「新建验收 run」，验收项清单出现 | `[data-testid="acceptance-checklist"]` visible |
| C4 | 选一条为 PASS → 点「提交验收」，页面出现「验收已提交」状态文字 | `text=验收已提交` visible |
| C5 | 访问历史页 `/ability-acceptance/history`，已提交 run 列出且可展开明细 | run 行 visible，点击后 `[data-testid="run-detail"]` visible |

### Phase D — 部署验收（6 个判定点）

| ID | 判定点 | 期望值 |
|----|--------|--------|
| D1 | Staff Hub 公网 URL 可访问 | `curl -s -o /dev/null -w "%{http_code}" https://staff.zenjoymedia.media/ability-acceptance` = `200` |
| D2 | `/api/build-info` 返回真实版本字段 | `version` 字段非空，非 `unknown` |
| D3 | DB 迁移已执行：四张表存在 | `\dt acceptance_*` 返回四张表：acceptance_template / acceptance_run / device_result / check_result |
| D4 | tenant_id 索引已建 | `\di` 含 acceptance_run_tenant_idx 或类似索引 |
| D5 | CI job `ability-acceptance-smoke` 绿 | GitHub Actions `ci-l2-consistency.yml` 最新 run 状态 = `success` |
| D6 | product-map T3 在 CI 绿（ability_acceptance.status=active） | CI `ci-l2-consistency` 日志含 `T3` PASS |

---

## E2E 验收

本合同的 E2E 验收分三个阶段执行，覆盖 product-map 保序、API 集成、Playwright 前端三条验收链路：

### Phase A — product-map 保序合同 E2E

运行：`node --test scripts/product-map/__tests__/product-map.test.js`（T1-T7 全 PASS）

关键断言：T3 `ability_acceptance.status === 'active'`；T6 `productMapDigest` 两次调用返回相同 hex。

### Phase B — API 集成合同 E2E

脚本：`bash sprints/07281218-relay-30a0c83a/e2e-contract.sh`（需 `$API_BASE`、`$DB`、`$STAFF_EMAIL`）

覆盖 B1-B9 共 9 条断言：无认证 → 403、版本接口非空、幂等创建/复用、check 录入、提交锁定、audit 字段、租户隔离。

### Phase C — Playwright E2E（windows_cloud）

文件：`apps/dashboard/e2e/ability-acceptance.spec.ts`

覆盖 C1-C5 共 5 个可见断言：导航入口、版本概览卡片、验收项清单、提交状态文字、历史明细展开。

---

## 累积 FR 回归断言（3 个）

| ID | 来源 sprint | 断言 |
|----|------------|------|
| R1 | 07090821 | `POST /api/staff/skill-eval/upload` 不带认证头 → HTTP 403，`error.code === "FORBIDDEN"` |
| R2 | 07211256 | `GET /api/staff/path-health` 返回 `{ paths: [...] }`，含 path1/path2/path4，`success === true` |
| R3 | 本 sprint | `productMapDigest` 同一 YAML 两次调用返回相同 hex（保序修复后累积为 FR） |

---

## 边界情况合同断言（5 个）

| ID | 场景 | 期望 |
|----|------|------|
| E1 | `VERSION` 文件不存在时 `GET /versions` | `data.staging.version` 包含 `"Unknown"` 字符串，HTTP 200 不中断 |
| E2 | `device_index = 6` 时 `POST /checks` | HTTP 400，`error.code === "DEVICE_INDEX_OUT_OF_RANGE"` |
| E3 | `result` 非法值（如 `"SKIP"`）时 `POST /checks` | HTTP 400，含输入校验错误信息 |
| E4 | `GET /templates` 模板表为空时 | HTTP 200，`data === []`（不报错） |
| E5 | 同 task_id+sha 第三次 `POST /runs` | HTTP 200，`created === false`，run_id 与 B3 仍相同（幂等不上限） |

---

## 合同总计

- **铁律覆盖:** 7 / 7
- **判定点总数:** 27 个（A:7 + B:9 + C:5 + D:6）
- **累积 FR 回归:** 3 个
- **边界情况:** 5 个
- **全部判定点数（含边界+回归）:** 35 个
