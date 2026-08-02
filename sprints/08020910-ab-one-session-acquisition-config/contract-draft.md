# Sprint Contract Draft（Round 1）

## Response Schema（推导来源: 现有 `acquisition-dispatch` route）

### Endpoint: PUT `/api/acquisition/config`

**Success (HTTP 200)**：沿用现有信封 `{ success: true, data: AcquisitionConfig, timestamp: string }`；本 sprint 不改变成功 schema。

**Invalid effective configuration (HTTP 400)**：`{ success: false, error: { code: "INVALID_CONFIG", message: string }, timestamp: string }`。

**禁用变化**：不得新增另一个错误码、不得把非法 effective configuration 返回为 HTTP 200、不得把 tenant id 改从 body/query 读取。

## 已知约束

- [回归测试] `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`。
- [回归测试] 同文件既有 `PUT /config 非法数值 → 400 INVALID_CONFIG，不写库`、`PUT /config 合法 → 200 + upsert`、tenant 隔离与无 tenant 401。
- [累积 FR] task payload 未提供 journey_id，context-manifest 不适用。
- [共享 Red] commit `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 的测试不可修改、删除、跳过或弱化。

## Golden Path

独立小路（无父路）。

入口 `PUT /api/acquisition/config` → 读取请求 tenant 当前配置 → patch 覆盖形成 effective configuration → 校验关键词上下界 → 非法时 400 且不写库；合法时沿用既有 upsert 与成功响应。

### Step 1：读取当前 tenant 配置
**来源**：`[FROM_PRD]` — PRD Golden Path 第 1–2 步。
**可观测行为**：partial PUT 在判定前使用请求 tenant 的当前配置；tenant 仍只来自现有请求上下文。
**验证锚**：DoD `B-01` 与 `B-04`；共享 Red 的 mock pool 首次查询必须被消费且绑定当前 tenant。
**硬阈值**：非法请求出现任何 `INSERT INTO zenithjoy.acquisition_config` 调用即 FAIL。

### Step 2：校验合并后的 effective configuration
**来源**：`[FROM_PRD]` — PRD Golden Path 第 2–4 步。
**可观测行为**：当前 `keywords_per_round_max=5` 时 partial patch `{keywords_per_round_min:10}` 返回 HTTP 400，`error.code=INVALID_CONFIG`。
**验证锚**：DoD `B-01`（共享 Red 原样执行）。
**硬阈值**：HTTP status 必须为 400，错误码必须字面等于 `INVALID_CONFIG`。

### Step 3：非法 effective configuration 不持久化

**来源**：`[FROM_PRD]` — PRD Golden Path 第 5 步。

**可观测行为**：校验失败后不调用 acquisition_config 的 INSERT/upsert。

**验证锚**：DoD `B-01` 与 `B-02`。

**硬阈值**：非法请求的 INSERT 调用数必须为 0。

### Step 4：合法 update 与既有行为兼容

**来源**：`[FROM_PRD]` — PRD Golden Path 第 6 步。

**可观测行为**：合法 partial update 仍返回 200 并 upsert；完整有效配置经过相同 effective 校验后不得被拒绝。

**验证锚**：DoD `B-03` 与整文件回归 `B-04`。

**硬阈值**：既有 route 测试文件全绿；合法 update 的 HTTP status=200 且存在 INSERT 调用。

## 接缝清单

- Route ↔ 配置读取/持久化 service：真实行为要求先读当前 tenant，再决定是否 upsert；共享 fixture 在 supertest route 层以注入 pool 验证查询顺序与零 INSERT。
- 真实 PostgreSQL：本合同未新增 schema 或 SQL；真实数据库回归由现有 acquisition dispatch smoke/CI 宿主持续守护，当前共享 Red 不声称覆盖真实 PG。

## 禁 mock 边清单

- Route ↔ `getConfig`/`upsertConfig` 调用边不得被替换为新的旁路实现；共享 fixture 必须继续走真实 route 与 service 代码。
- pool ↔ PostgreSQL 在共享 Red 中按 Owner 冻结为 mock pool；不得用它宣称真实 PG 已验证，见“未覆盖真实链路清单”。

## 真实调用方请求 shape

- Method：`PUT`
- Endpoint：`/api/acquisition/config`
- Authentication/tenant context：沿用现有 `X-Tenant-Id: <tenant>` 或 session 注入的 `req.tenantId`；禁止从 body/query 读取 tenant。
- Content-Type：`application/json`
- Partial body：只包含要更新的配置字段，例如 `{ "keywords_per_round_min": 10 }`。
- Complete body：包含完整 acquisition configuration 字段集，仍走同一 endpoint 与校验路径。

## 未覆盖真实链路清单

- 共享 Red fixture 本身不覆盖真实 PostgreSQL 往返｜Owner 冻结测试使用 supertest + mock pool｜补位：专用 `acquisition-config-validation-smoke.sh` 通过真实 API + PostgreSQL 验证完整合法 PUT、非法 partial PUT 的 400/`INVALID_CONFIG`/数据库快照不变，以及后续合法 partial PUT；mock 证据不冒充真实 PG 证据。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | partial PUT 读取当前配置，校验合并后的 effective configuration；非法返回 400 `INVALID_CONFIG` 且不持久化；合法更新兼容。 |
| NFR（做得多好） | 不新增外部调用；保持 tenant 隔离、鉴权、错误信封与成功信封兼容。 |
| Invariant（永不违反） | 共享 Red 不变；非法配置零持久化；tenant 不串；合法 partial/complete update 不回退。 |
| 判定点（怎么知道） | 纯确定性数值比较，无外部状态推断；见下方 N/A。 |
| 保质期（何时过期） | 配置字段或 endpoint 合同变更时由对应迁移任务更新测试；当前无限期回归。 |
| 死亡告警（停了谁知道） | PR CI 中已注册的 API route 测试失败即阻塞；exact-head checks 对外可见。 |
| 失败语义（挂了怎么办） | effective configuration 非法时 fail closed：400、零写入；不得降级为保存 patch。 |
| 效果确认（已发≠已生效） | 非法路径以 400+错误码+零 INSERT 三信号确认；合法路径以 200+回读 data+INSERT 确认。 |

### 判定点登记表（对模糊现实的判断假设）

（本任务为确定性数值边界判断，无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| effective `min > max` | HTTP 400 `INVALID_CONFIG`，不写库 | 是；同请求重复仍为 400 | 无降级，fail closed |
| 缺 tenant | 沿用 HTTP 401 `NO_TENANT` | 是 | 无 |
| 合法 update | 沿用现有 HTTP 200 + upsert | 现有 upsert 语义 | 无变化 |

### 输入对抗面

N/A：此任务不新增 agent、prompt 或新外部输入面；沿用现有 API 校验与 auth。

## 风险与缓解

- 风险：只校验 patch 会遗漏“新 min + 旧 max”或“旧 min + 新 max”的非法组合。缓解：对 effective object 单点校验，并以共享 Red 锁定至少一个跨新旧字段组合。
- 风险：为了校验先读当前配置后误写非法状态。缓解：校验必须发生在任何 INSERT/upsert 之前，fixture 明确断言零 INSERT。
- 风险：修复破坏合法 update。缓解：整文件 route 回归必须全绿，保留既有成功 test。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算：10 分钟 / 15 动作。

- 错输入：分别只传 `keywords_per_round_min`、只传 `keywords_per_round_max`，与当前另一端组合为非法边界。
- 重复提交：连续两次提交同一非法 partial patch，均应 400 且零写入。
- 中途中断：N/A；该同步 PUT 无异步中间态。
- 边界值：验证 `min == max` 合法，`min == max + 1` 非法，以及字段范围 1/50。

## E2E 验收

**journey_type**：autonomous
**target_environment**：local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
REAL_SMOKE=.github/workflows/scripts/smoke/acquisition-config-validation-smoke.sh
grep -q 'jq -e' "$REAL_SMOKE"
grep -q 'psql' "$REAL_SMOKE"
grep -q "NOW() - interval" "$REAL_SMOKE"
bash sprints/08020910-ab-one-session-acquisition-config/e2e-verify.sh
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| effective config 合并校验 | `apps/api/tests/routes/acquisition-dispatch.test.ts` | `partial patch cannot make merged keyword bounds invalid` | 旧生产代码 actual 200 / expected 400 |
| 合法与错误回归 | `apps/api/tests/routes/acquisition-dispatch.test.ts` | `PUT /config 合法 → 200 + upsert`、`PUT /config 非法数值 → 400 INVALID_CONFIG，不写库` | 新增共享 case 红，其余既有 case 保持绿 |

## Notes

- contract-gate: skipped（本仓无 `packages/brain/src/lib/contract-gate.js`，仅执行技能内置规则审查）。
- review_required: true；Evaluator 与 Judge PASS 后停在人工 blind A/B gate，禁止 merge/close/staging E2E。
