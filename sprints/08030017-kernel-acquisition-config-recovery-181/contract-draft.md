# Sprint Contract Draft (Round 3)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 冻结 Red 基线：`0dc4e3c07ff19a0ac95440723986bf3cb78580b2`。本轮未修改共享 Red fixture，且禁止读取 One-session 候选 worktree、patch、日志、PR 或反馈。
- Registry 可达但未登记本端点；test registry 已登记 Line 02 acquisition config E2E。context-manifest 返回 404 HTML。
- Round 3 仅补 Reviewer 指明的四个缺口：合法完整 PUT、合法更新整行/双租户隔离、新租户首次并发 upsert、冻结 Red SHA 可复验失败证据；删除 Round 2 超出 PRD 的完整 response keys/type 合同。
- `npm run product-map:check` 在安装锁定依赖后通过，无分类漂移。
- 新增真 Postgres 测试按仓库 SSOT 规则登记到 `test-registry.yaml`，CI 层级为 L4。

## Response Schema（推导来源: PRD字面 + 现有生产端点）

### Endpoint: PUT/PATCH `/api/acquisition/config`

**Success (HTTP 200)**：PRD 只要求合法部分/完整更新成功并可读回；沿用现有信封 `{success:true,data,timestamp}`。本合同只锁定与 PRD 相关的 `data.keywords_per_round_min`、`data.keywords_per_round_max` 及请求字段值，不新增或重命名字段。

**Error (HTTP 400)**：`success=false`，`error.code="INVALID_CONFIG"`，`error.message` 为 string；无效请求不得持久化。

**禁用字段名**：N/A — PRD 未给禁用字段清单。本合同不得以 `min`/`max` 替代字面字段 `keywords_per_round_min`/`keywords_per_round_max`。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`（共享 Red fixture，只读）。
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 非法数值 → 400 INVALID_CONFIG，不写库`。
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 合法 → 200 + upsert`。
- `apps/dashboard/e2e/acquisition-config.spec.ts` → 配置表单保存调用现有 PUT 路径。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（404 HTML）。

## 冻结 Red 证据

在当前 planner 基线执行以下两步；第一步证明四个相关生产/fixture 文件与冻结 SHA 字节一致，第二步真启动 Vitest 并得到真实失败：

```bash
git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/src/services/acquisition-dispatch.ts apps/api/src/routes/acquisition-dispatch.ts apps/api/src/routes/acquisition.ts apps/api/tests/routes/acquisition-dispatch.test.ts
npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
```

已记录 Red：第一条 exit 0；第二条 exit 1，Vitest `1 failed`，断言位于 `acquisition-dispatch.test.ts:475`，实际 HTTP 200、期望 400。实现后共享 fixture 必须转绿，但 fixture 文件本身不得修改。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 合并当前租户配置与局部/完整更新后校验 keyword bounds；冲突 400 `INVALID_CONFIG` 且零持久化，合法更新保存可读回。 |
| NFR（做得多好） | 性能/可靠性 | 并发请求按每次实际可见配置校验；同步请求在测试等待预算内完成。 |
| Invariant（永不违反） | 安全/一致性 | 持久态始终 `keywords_per_round_min <= keywords_per_round_max`；失败不改目标整行/`updated_at`；租户隔离。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 退役责任 | 与现有配置字段/端点共存；字段或端点退役时由 API owner 同步退役合同。 |
| 死亡告警（停了谁知道） | 故障发现 | 共享 Red smoke 与本 Sprint 真 Postgres 集成测试阻塞交付；PRD 未要求新增运行时告警。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | 有效态冲突 fail-closed 为 400；DB 故障 5xx/回滚；不得降级为孤立 patch 校验。 |
| 效果确认（已发≠已生效） | 生效回执 | 200 后从真 DB 读整行；400 后比较 A/B 租户完整快照；并发后验证最终不变量。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 同租户并发请求的实际可见当前配置 | A. 孤立校验 patch；B. 在同一租户原子边界内读有效态、校验并写入 | B. 原子边界内判定 | PRD 明确禁止孤立判定，并要求按实际可见配置校验 | 产生非法配置或丢更新 |
| 新租户首次写入的当前配置 | A. 两请求分别使用默认值；B. tenant-scoped 串行后让后请求看到首个写入 | B. tenant-scoped 串行 | 无既有行时普通行锁不存在，仍须满足相同不变量 | 首次并发写入非法有效态 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 合并后 `min > max` | HTTP 400 + `INVALID_CONFIG`；不写任何字段或更新时间 | 是；重复无效请求仍拒绝 | 不降级 |
| DB 读/校验/写失败 | 5xx 且事务回滚 | 调用方确认状态后重试 | 禁止无锁/非原子降级 |
| 同租户并发冲突 | 一个合法写入先完成，后请求按可见新值拒绝 | 最终态保持合法 | 不允许双 200 形成非法态 |

### 输入对抗面

N/A：本任务不是对外暴露 agent；沿用现有 tenant 鉴权与字段范围校验。

## 真实调用方请求 shape

- 生产 Dashboard 使用 `Content-Type: application/json`、`credentials:'include'`，并可带 `Authorization: Bearer <license>`；现有 smoke/集成入口使用生产 middleware 支持的 `X-Tenant-Id` header。
- PUT/PATCH tenant 身份只来自 header/session，不从 body 接收；payload 字段逐字为 `keywords_per_round_min`、`keywords_per_round_max` 及既有配置字段。
- 合同测试使用 `X-Tenant-Id` + JSON body，和生产 middleware 的真实请求 shape 一致；不引入第二套 tenant body 参数。

## 禁 mock 边清单

- PUT/PATCH Express 路由 ↔ `upsertConfig`：测试挂载真实生产 router/service，禁止 mock 任一侧。
- `upsertConfig` ↔ Postgres `zenithjoy.acquisition_config`：测试使用真 Pool、真事务/并发请求，禁止 mock pool/client。
- tenant middleware ↔ 路由 tenant scope：测试通过真实 `X-Tenant-Id` 解析并种至少两个租户。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] API ↔ Postgres：在隔离 Postgres 重复执行非法零写入、合法整行 diff 与双租户隔离；真验前为 `logic-done-pending`。
- [接缝×2] 同租户并发 ↔ 原子持久化：已有租户与无行新租户各重复两次；两次结果不一致判 FLAKY。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[租户提交部分或完整更新] → [系统按实际可见当前配置形成有效态并校验] → [冲突零写入拒绝，或合法保存并读回]

### Step 1: 租户提交部分或完整配置
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步及「范围限定」。

**可观测行为**: 合法部分 PATCH、非上下界部分 PUT、含全部既有配置字段的完整 PUT 均返回 200；完整 PUT 的 `min=max` 可成功。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分 PATCH|合法非上下界部分 PUT|合法完整 PUT"
```
**硬阈值**: 3/3 exit 0；完整 PUT 全字段读回；每个合法部分更新的业务整行 diff 恰为请求字段，第二租户整行不变。

### Step 2: 按实际可见租户配置校验有效上下界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及「并发更新」边界。

**可观测行为**: 只提高 min 或只降低 max 造成合并后冲突均返回 400；已有租户和首次无行新租户的并发孤立合法 patch 都只能一成一拒，最终有效态合法。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "无效有效态|并发"
```
**硬阈值**: 4/4 exit 0；非法响应 HTTP 400 且 `error.code=INVALID_CONFIG`；每组并发 statuses 恰为 `[200,400]`；最终 `min<=max`。

### Step 3: 非法零持久化，合法更新隔离保存并读回
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与「验收准则」。

**可观测行为**: 两类非法请求后目标租户整行（含 `updated_at`）与第二租户整行完全不变；合法更新只改变预期业务字段，完整 PUT 全字段可读回。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose
```
**硬阈值**: 7/7 exit 0；真 DB 或解释器不可用时必须非 0，不允许 skip。

### Step 4: 冻结 Red smoke 由实现点绿且 fixture 不变
**来源**: `[AI_ADDED]` — Reviewer 明确要求冻结 Red SHA 真实失败证据与 TDD 闭环，防止只写新测试却未证明既有 Red。

**可观测行为**: 实现前真实证据为 200≠400；实现后同一共享 fixture 通过，且 fixture 相对冻结 SHA 无 diff。

**验证命令**:
```bash
git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts && npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
```
**硬阈值**: fixture diff exit 0；实现后目标 smoke 1/1 pass、命令 exit 0；盲评前不得 merge。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
export DB_URL="${DB_URL:?DB_URL 必填，须指向隔离验收 Postgres}"
TEST_FILE="sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts"
START=$(date +%s)
npx vitest run "$TEST_FILE" --reporter=verbose 2>&1 | tee /tmp/kernel-acquisition-effective-config.log
grep -Eq "7 passed|Tests[[:space:]]+7 passed" /tmp/kernel-acquisition-effective-config.log || { echo "FAIL: 未观察到 7 passed"; exit 1; }
git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts
npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 90 ] || { echo "FAIL: E2E 耗时 ${ELAPSED}s > 90s"; exit 1; }
echo "OK: Kernel acquisition effective-config guard 通过 elapsed=${ELAPSED}s"
```

通过标准：隔离 Postgres 7/7；共享 Red fixture 1/1；fixture 未改；总耗时 ≤90s；任一依赖不可用即 FAIL。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: PUT/PATCH 的 bounds 传 string、null、浮点、0、51。
- 重复提交: 同一合法 patch 连续提交两次，值保持稳定且无跨租户影响。
- 中途中断: 请求持有 tenant 原子边界时断开 DB，确认回滚后可重试。
- 边界值: `min=max`、1、50、已有租户并发、无行新租户首次并发。
发现分级: P0/P1（非法态落库、跨租户修改、部分写入）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 有效态拒绝与零持久化 | `tests/acquisition-config-effective-validation.integration.test.ts` | `无效有效态返回 400 INVALID_CONFIG 且两租户整行零持久化` | 当前 PUT/PATCH 均未按合并有效态拒绝 |
| 合法部分/完整更新 | `tests/acquisition-config-effective-validation.integration.test.ts` | `合法部分 PATCH 只改变请求字段且保持双租户隔离`、`合法非上下界部分 PUT 只改变请求字段且保持双租户隔离`、`合法完整 PUT 含全部配置字段且 min=max 时整行持久化可读回` | 修复不得回退合法路径 |
| 已有/新租户并发 | `tests/acquisition-config-effective-validation.integration.test.ts` | `已有租户并发部分更新按实际可见配置串行校验且最终合法`、`新租户首次并发 upsert 串行校验且不会创建无效有效态` | 当前非原子 read/upsert 导致双 200 或非法最终态 |
