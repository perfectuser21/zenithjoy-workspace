# Sprint Contract Draft (Round 1)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 冻结 Red 基线为 `0dc4e3c07ff19a0ac95440723986bf3cb78580b2`；不得修改共享 Red fixture，不得检查或复制 One-session 候选材料，不得在盲测 A/B verdict 前合并。
- Registry 可达但快照已过期且未给出本端点专属 schema；以下以 PRD 字面、现有生产路由与 Dashboard 调用方为准。
- `npm run product-map:check` 当前因工作区未安装 `ajv` 无法启动；本合同不改产品分类。

## Response Schema（推导来源: PRD字面 + 现有生产端点）

### Endpoint: PUT/PATCH /api/acquisition/config

**Success (HTTP 200)**:

```json
{"success":true,"data":{"tenant_id":"<string>","keywords_per_round_min":3,"keywords_per_round_max":5},"timestamp":"<ISO-8601 string>"}
```

- `success` (boolean, 必填)：现有成功信封。
- `data.tenant_id` (string, 必填)：请求上下文中的租户。
- `data.keywords_per_round_min` (integer, 必填)：PRD 字面字段。
- `data.keywords_per_round_max` (integer, 必填)：PRD 字面字段。
- `timestamp` (string, 必填)：现有响应时间戳。

**Error (HTTP 400)**:

```json
{"success":false,"error":{"code":"INVALID_CONFIG","message":"<string>"},"timestamp":"<ISO-8601 string>"}
```

- `error.code` 必须字面等于 `INVALID_CONFIG`。
- **禁用字段名**：`result`、`min`、`max`（不得替代 PRD 字面配置字段）。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 非法数值 → 400 INVALID_CONFIG，不写库`
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`（共享 Red fixture，只读）
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 合法 → 200 + upsert`
- `apps/dashboard/e2e/acquisition-config.spec.ts` → `配置表单渲染 + 改值保存调 PUT 持久化`
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（端点返回 404 HTML）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 以当前租户配置和补丁形成有效配置后校验 keyword 上下界；冲突拒绝且零持久化，合法 PUT/PATCH 保持成功。 |
| NFR（做得多好） | 性能/可靠性 | PRD 未给延迟数值；请求同步明确返回 200 或 400，失败不得部分写入。 |
| Invariant（永不违反） | 安全/一致性 | 仅 `keywords_per_round_min <= keywords_per_round_max` 可落库；失败不改整行或 `updated_at`；租户间隔离。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 退役责任 | 与 acquisition_config 两字段和现有配置入口共存；字段退役时由 API owner 同步退役合同。 |
| 死亡告警（停了谁知道） | 故障发现 | CI 集成测试失败阻塞交付；运行时沿用现有 API 5xx 监控，PRD 未要求新增告警。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | 有效配置冲突 fail-closed 为 400；不重试、不写库、不降级。 |
| 效果确认（已发≠已生效） | 生效回执 | 200 后查真实 DB；400 后比较整行写前/写后快照，并核对第二租户。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 有效配置上下界是否冲突 | A. 仅校验补丁；B. 读取当前租户配置并与补丁合并后校验 | B. 合并后校验 | PRD Golden Path 第 2 步 | 非法参数落库并破坏获客闭环 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 合并后 `min > max` | HTTP 400 + `INVALID_CONFIG`，任何字段均不写入 | 是；重复请求仍拒绝且状态不变 | 不降级 |
| Postgres 读写故障 | 沿用现有 5xx，禁止返回成功 | 不自动重试 | 调用方读取确认后决定重试 |

### 输入对抗面

N/A：本任务不是对外暴露 agent；沿用现有鉴权和字段范围校验。

## 真实调用方请求 shape

- 生产 Dashboard `apps/dashboard/src/api/acquisition-dispatch.api.ts` 使用 `PUT /api/acquisition/config`、`credentials:'include'`、可选 `Authorization: Bearer <license>`、`Content-Type: application/json`，body 为配置 patch。
- PRD 验收还明确调用同 URL 的 PATCH；非浏览器 smoke 通过现有 `tenantContextOptional` 使用 `X-Tenant-Id` header。DoD 与集成测试使用该真实 smoke shape，不在 query/body 伪造 `tenant_id`。
- 关键 payload 字段逐字为 `keywords_per_round_min`、`keywords_per_round_max`。

## 禁 mock 边清单

- `PUT/PATCH /api/acquisition/config` 路由 ↔ `upsertConfig/getConfig` service（必须挂真实相邻路由与 service）。
- `upsertConfig/getConfig` ↔ Postgres `zenithjoy.acquisition_config`（必须真读写真表，禁止替换 pool）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- [接缝×2] API ↔ Postgres：在隔离验收库重复执行冲突拒绝和合法持久化，比较双租户整行快照；真目标验过前为 `logic-done-pending`。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[调用方提交配置] → [读取当前租户并形成有效配置] → [冲突零写入拒绝，或合法持久化并读回]

### Step 1: 当前租户提交部分或完整配置
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 步。

**可观测行为**: 已鉴权调用方以生产字段 shape 发起 PUT 或 PATCH，租户由请求上下文确定。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分更新成功持久化且只改变请求字段并保持双租户隔离"
```
**硬阈值**: 测试 exit code = 0；响应 HTTP 200；未请求的 max 与第二租户保持不变。

### Step 2: 以请求实际可见的当前配置校验有效上下界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及「边界情况」的对称部分更新与并发可见性要求。

**可观测行为**: 只提高 min、只降低 max 或后续请求基于最新可见值造成 `min > max` 时，PUT/PATCH 均返回 HTTP 400 和 `INVALID_CONFIG`。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "有效配置|实际可见当前配置"
```
**硬阈值**: 3/3 冲突场景通过；HTTP = 400；`error.code = INVALID_CONFIG`。

### Step 3: 非法零持久化，合法更新成功读回
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与全部边界情况。

**可观测行为**: 非法请求前后目标租户整行（含 `updated_at`）相同，第二租户不变；合法部分、完整和 `min=max` 更新成功并读回。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts
```
**硬阈值**: 5/5 测试通过；真实 DB 或解释器不可用时非 0 退出。

### Step 4: 以随机双租户和真实边界防止替身假绿
**来源**: `[AI_ADDED]` — 防止只验响应、历史记录或 mock pool 掩盖部分写入与跨租户副作用。

**可观测行为**: 每轮随机生成两个 tenant key，挂生产路由和真实 service/pool，结束后仅清理本轮数据。

**验证命令**:
```bash
if rg -n "vi\.mock|jest\.mock|page\.route|stub" sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts; then exit 1; fi
```
**硬阈值**: 禁止关键词零命中；真正 verdict 仍为 Step 3 的真实执行。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
export DB_URL="${DB_URL:?DB_URL 必填，须指向隔离验收 Postgres}"
TEST_FILE="sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts"
START=$(date +%s)
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/acquisition-config-effective-validation.log
grep -q "5 passed" /tmp/acquisition-config-effective-validation.log || { echo "FAIL: 未观察到 5 passed"; exit 1; }
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 60 ] || { echo "FAIL: 集成验收耗时 ${ELAPSED}s > 60s"; exit 1; }
echo "OK: acquisition 有效配置合并校验通过 elapsed=${ELAPSED}s"
```

通过标准：隔离 Postgres 上 5/5 通过、exit code 0、60 秒内完成；依赖不可用不得静默跳过。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: PUT/PATCH 传字符串、null、浮点和 1..50 之外整数。
- 重复提交: 连续两次提交相同合法 patch，最终有效配置稳定。
- 中途中断: 读取当前配置后数据库连接中断，不得返回成功或部分更新。
- 边界值: `min=max`、1、50、无现存配置行时的合法与冲突 patch。
发现分级: P0/P1（跨租户、非法落库、错误成功）阻塞 merge；P2/P3 记录 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合并后冲突拒绝 | `tests/acquisition-config-effective-validation.integration.test.ts` | `有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化`、`实际可见当前配置校验且非法请求不更新时间` | 当前 PUT 只校验孤立 patch、PATCH 不校验，至少 3 failures |
| 合法更新回归 | `tests/acquisition-config-effective-validation.integration.test.ts` | `合法部分更新成功持久化且只改变请求字段并保持双租户隔离`、`合法完整更新与 min=max 等值边界成功持久化并可读回` | 修复不得使合法路径转红 |
