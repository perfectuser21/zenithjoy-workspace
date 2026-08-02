# Sprint Contract Draft (Round 1)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 冻结 Red 基线：`0dc4e3c07ff19a0ac95440723986bf3cb78580b2`；不得修改共享 Red fixture，不读取 One-session 候选证据，盲测 A/B verdict 前不合并。
- Registry：API registry 可达但无本端点专属 schema；按 PRD 字面及现有生产路由推导。

## Response Schema（推导来源: PRD字面 + 现有生产端点）

### Endpoint: PUT /api/acquisition/config

**Success (HTTP 200)**:

```json
{"success":true,"data":{"tenant_id":"<string>","keywords_per_round_min":3,"keywords_per_round_max":5},"timestamp":"<ISO-8601 string>"}
```

- `success` (boolean, 必填)：现有 `OK` 信封。
- `data.tenant_id` (string, 必填)：当前认证租户。
- `data.keywords_per_round_min` (integer, 必填)：PRD 字面字段。
- `data.keywords_per_round_max` (integer, 必填)：PRD 字面字段。
- `timestamp` (string, 必填)：现有 `OK` 信封。

**Error (HTTP 400)**:

```json
{"success":false,"error":{"code":"INVALID_CONFIG","message":"<string>"},"timestamp":"<ISO-8601 string>"}
```

- `error.code` 必须字面等于 `INVALID_CONFIG`。
- **禁用字段名**：`result`、`min`、`max` 不得替代 PRD 字面配置 key。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 非法数值 → 400 INVALID_CONFIG，不写库`
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`（冻结 Red fixture）
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 合法 → 200 + upsert`
- `apps/dashboard/e2e/acquisition-config.spec.ts` → `配置表单渲染 + 改值保存调 PUT 持久化`
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 合并部分/完整补丁与当前租户配置后校验 keyword 上下界；冲突拒绝且零写入；合法更新保持成功。 |
| NFR（做得多好） | PRD 未给延迟数值；请求同步返回明确 200 或 400，不允许部分写入。 |
| Invariant（永不违反） | `min <= max` 才可落库；失败前后当前租户整行不变；另一租户不受影响。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 与 acquisition_config schema 和 PUT 端点共存；字段退役时由 API owner 同步退役合同。 |
| 死亡告警（停了谁知道） | CI 集成测试失败阻塞交付；PRD 未要求新增生产告警渠道。 |
| 失败语义（挂了怎么办） | 有效配置冲突 fail-closed 为 400；不重试、不写库；DB 故障沿用既有 5xx。 |
| 效果确认（已发≠已生效） | 200 后响应和 DB 均为新值；400 后 DB 与写前快照相同。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 有效配置上下界是否冲突 | A. 只看补丁；B. 当前租户配置与补丁合并后比较 | B. 合并后比较 | PRD Golden Path 第 2 步 | 非法配置落库，采集行为错误 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 合并后 `min > max` | HTTP 400 + `INVALID_CONFIG`，零写入 | 是，相同请求重复拒绝 | 不降级、不放行 |
| Postgres 读写失败 | 沿用既有 5xx，禁止声称成功 | 不自动重试 | 调用方读取确认后决定重试 |

### 输入对抗面

N/A：本任务不是对外暴露 agent；现有鉴权与数值范围校验不变。

## 真实调用方请求 shape

- 生产 Dashboard 使用 `PUT /api/acquisition/config`、`Content-Type: application/json` 与 JSON body。
- 生产租户由 session cookie 解析；既有 smoke 路径使用 `X-Tenant-Id` header。DoD 不在 body/query 传 `tenant_id`。
- payload 字段逐字为 `keywords_per_round_min`、`keywords_per_round_max`。

## 禁 mock 边清单

- `PUT /api/acquisition/config` 路由 ↔ `upsertConfig/getConfig` service：集成测试真调相邻模块。
- `upsertConfig/getConfig` ↔ Postgres `zenithjoy.acquisition_config`：测试真读写真表并核对双租户。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- API ↔ Postgres：local_api 真调路由与真 Postgres，核对写前/写后快照；真验前为 `logic-done-pending`。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步

[PUT 配置] → [与当前租户配置合并并校验] → [冲突拒绝且零写入，或合法持久化]

### Step 1: 提交部分或完整更新

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: 调用方按生产 shape 发 PUT，租户由请求上下文确定。

**验证命令**:

```bash
DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分更新成功持久化并可读取且不改变另一租户"
```

**硬阈值**: exit code 0；不得通过 body/query 改写租户。

### Step 2: 合并当前配置后拒绝冲突

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步和两个单字段边界情况。

**可观测行为**: 单字段补丁造成有效配置 `min > max` 时返回 400 与 `INVALID_CONFIG`。

**验证命令**:

```bash
DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts -t "有效配置 min>max 返回 400 INVALID_CONFIG"
```

**硬阈值**: 两个对称用例通过；HTTP=400；error.code=`INVALID_CONFIG`。

### Step 3: 非法零写入，合法更新可读取

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步和边界情况。

**可观测行为**: 非法更新前后 bounds 相同；合法部分、完整和 `min=max` 更新返回 200 并落库。

**验证命令**:

```bash
DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts
```

**硬阈值**: 4/4 测试通过；任一断言失败均非 0 退出。

### Step 4: 防止替身或历史数据假绿

**来源**: `[AI_ADDED]` — 防止只看响应而漏掉真实持久化副作用。

**可观测行为**: 每轮使用随机 tenant id 在真实 Postgres 写入并清理；不替换路由、service 或 DB。

**验证命令**:

```bash
if rg -n "vi\.mock|jest\.mock|page\.route|stub" sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts; then exit 1; fi
```

**硬阈值**: 禁止关键词零命中；真实 verdict 仍由 Step 3 提供。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
export DATABASE_URL="${DATABASE_URL:?DATABASE_URL 必填，须指向隔离验收 Postgres}"
TEST_FILE="sprints/08021518-ab-kernel-acquisition-config-recovery-7/tests/acquisition-config-effective-validation.integration.test.ts"
START=$(date +%s)
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/acquisition-config-effective-validation.log
grep -q "4 passed" /tmp/acquisition-config-effective-validation.log || { echo "FAIL: 未观察到 4 passed"; exit 1; }
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 60 ] || { echo "FAIL: 集成验收耗时 ${ELAPSED}s > 60s"; exit 1; }
echo "OK: acquisition 有效配置校验通过 elapsed=${ELAPSED}s"
```

通过标准：真 Postgres 上 4/4 通过、exit 0、60 秒内完成；环境不可用即 FAIL。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 传字符串、null、浮点和越界整数。
- 重复提交: 连续两次提交同一合法部分更新。
- 中途中断: DB 连接中断时不得返回成功信封。
- 边界值: `min=max`、1、50，以及无现有配置行时的部分更新。
发现分级: P0/P1（跨租户/非法落库）阻塞 merge；P2/P3 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合并后冲突拒绝 | `tests/acquisition-config-effective-validation.integration.test.ts` | `有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化` | 当前实现只校验 patch，两个部分更新返回 200，至少 2 failures |
| 合法更新回归 | 同上 | `合法部分更新成功持久化并可读取且不改变另一租户`、`合法完整更新与 min=max 等值边界成功持久化` | 修复不得使合法路径转红 |
