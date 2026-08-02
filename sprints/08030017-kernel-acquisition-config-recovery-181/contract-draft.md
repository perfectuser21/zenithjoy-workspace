# Sprint Contract Draft (Round 2)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 冻结 Red 基线为 `0dc4e3c07ff19a0ac95440723986bf3cb78580b2`；不得修改共享 Red fixture，不得检查或复制 One-session 候选材料，不得在盲测 A/B verdict 前合并。
- Registry 可达但未登记本端点；schema 以 PRD 字面和现有生产路由为准。context-manifest 返回 404 HTML。
- `npm run product-map:check` 因依赖 `ajv` 未安装而未启动；本合同不改产品分类。
- Round 2 删除 PRD 外防替身 Step 4，并补合法 PATCH、完整 schema oracle、确定性并发竞态和原子性风险。
- judgment-pending-user: 同租户并发请求的实际可见当前配置（PRD 已选择原子校验；具体锁实现由 generator 在合同边界内完成）。

## Response Schema（推导来源: PRD字面 + 现有生产端点）

### Endpoint: PUT/PATCH /api/acquisition/config

**Success (HTTP 200)**：顶层 keys 必须恰为 `data,success,timestamp`；`success=true`；`timestamp` 为 ISO 时间。PUT `data` keys 必须恰为 `tenant_id,collect_rounds_per_day,keywords_per_round_min,keywords_per_round_max,collect_active_start,collect_active_end,burner_count,dm_per_hour,dm_per_day,dm_interval_min_sec,dm_interval_max_sec,dm_active_start,dm_active_end,nurture_per_day_min,nurture_per_day_max,cookie_check_interval_hours,dm_message`；PATCH 另含 `target_profile_desc`。数值字段为 number，租户与文本字段为 string，`target_profile_desc` 为 string 或 null。

**Error (HTTP 400)**：顶层 keys 必须恰为 `error,success,timestamp`；`success=false`；`error` keys 恰为 `code,message`；`error.code="INVALID_CONFIG"`，message 为 string。

**禁用字段名**：`result`、`min`、`max` 不得替代 PRD 字面配置字段。全部字段、keys 完整性和禁用字段由集成测试 helper 可执行断言覆盖。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 非法数值 → 400 INVALID_CONFIG，不写库`
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`（共享 Red fixture，只读）
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 合法 → 200 + upsert`
- `apps/dashboard/e2e/acquisition-config.spec.ts` → `配置表单渲染 + 改值保存调 PUT 持久化`
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（404 HTML）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 以当前租户配置和补丁形成有效配置后校验上下界；冲突拒绝且零持久化，合法 PUT/PATCH 成功。 |
| NFR（做得多好） | 性能/可靠性 | 同租户读-校验-写必须原子串行；请求同步返回 200 或 400。 |
| Invariant（永不违反） | 安全/一致性 | 持久态始终 `keywords_per_round_min <= keywords_per_round_max`；失败不改整行或 `updated_at`；租户隔离。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 退役责任 | 与现有字段和配置入口共存；字段退役时由 API owner 同步退役合同。 |
| 死亡告警（停了谁知道） | 故障发现 | CI 集成 smoke 阻塞交付；运行时沿用 API 4xx/5xx 监控，PRD 未要求新增告警。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | 冲突 fail-closed 为 400；不重试、不写库、不降级。 |
| 效果确认（已发≠已生效） | 生效回执 | 200 后读真 DB；400 后比较整行快照；并发后查最终不变量及双租户隔离。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 同租户并发请求的实际可见当前配置 | A. 无锁读取；B. 同一事务锁定租户行后读-校验-写 | B. 原子锁后读取 | PRD 边界明确要求每次请求实际可见配置 | 两个孤立合法补丁均成功，产生丢更新或非法有效态 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 合并后 `min > max` | HTTP 400 + `INVALID_CONFIG`，整行不写 | 是；重复冲突请求仍拒绝 | 不降级 |
| DB 读/锁/写故障 | 5xx 且事务回滚 | 调用方确认状态后重试 | 禁止无锁降级 |
| 并发冲突 | 锁后先完成者成功，后请求按新可见值返回 400 | 最终态保持合法 | 不允许两请求绕过校验 |

### 输入对抗面

N/A：本任务不是对外暴露 agent；沿用现有鉴权和字段范围校验。

## 真实调用方请求 shape

- Dashboard PUT 使用 `credentials:'include'`、可选 `Authorization: Bearer <license>`、`Content-Type: application/json`；smoke 使用生产中间件支持的 `X-Tenant-Id` header，body 不传 tenant id。
- PRD 验收 PATCH 使用同一 URL、认证和 JSON body；字段逐字为 `keywords_per_round_min`、`keywords_per_round_max` 等现有配置 key。

## 禁 mock 边清单

- PUT/PATCH 路由 ↔ `upsertConfig/getConfig`：必须挂真实路由与 service。
- `upsertConfig` 读-校验-写 ↔ Postgres `zenithjoy.acquisition_config`：必须用真连接、真事务/锁，禁止替换 pool/client。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- [接缝×2] API ↔ Postgres：隔离库重复执行双租户拒绝、合法持久化和受控并发竞态；真目标验过前为 `logic-done-pending`。

## 风险与缓解

- 高风险：`getConfig` 与 upsert 分离会形成 TOCTOU；两个并发 patch 可基于同一旧值判定。缓解：同租户行的读取、有效态校验与写入必须在同一 DB 事务/锁边界内，异常回滚；测试用外部 `FOR UPDATE` blocker 确定性证明请求等待后按新可见值串行，要求结果恰为一个 200、一个 400。
- 新租户无既有行时也需串行；实现可使用 tenant-scoped advisory lock 或等价机制，禁止只对已存在行 `FOR UPDATE` 而留下首次 upsert 竞态。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[调用方提交配置] → [原子读取当前租户并形成有效配置] → [冲突零写入拒绝，或合法持久化并读回]

### Step 1: 当前租户提交部分或完整配置
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: PUT/PATCH 使用生产请求 shape；合法部分 PATCH 与完整 PUT 均可成功。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "合法部分 PATCH|合法完整 PUT|未涉及上下界"
```
**硬阈值**: 3/3 exit 0；HTTP 200；仅请求字段改变；完整 response schema 通过。

### Step 2: 原子地按实际可见当前配置校验有效上下界
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及「并发更新」边界。

**可观测行为**: 单字段冲突返回 400；受控并发两个孤立合法、合并冲突的 patch 恰一成功一拒绝，最终 min<=max。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts -t "有效配置|min<=max"
```
**硬阈值**: 3/3 exit 0；冲突为 HTTP 400 + INVALID_CONFIG；并发 statuses 恰为 `[200,400]`。

### Step 3: 非法零持久化，合法更新成功读回
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与验收准则。

**可观测行为**: 非法请求目标整行含 `updated_at` 不变且第二租户不变；合法部分/完整/等值边界成功。

**验证命令**:
```bash
DB_URL="${DB_URL:?}" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts
```
**硬阈值**: 6/6 exit 0；真实 DB/解释器不可用时非 0。

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
grep -Eq "6 passed|Tests[[:space:]]+6 passed" /tmp/acquisition-config-effective-validation.log || { echo "FAIL: 未观察到 6 passed"; exit 1; }
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 60 ] || { echo "FAIL: 集成验收耗时 ${ELAPSED}s > 60s"; exit 1; }
echo "OK: 有效配置原子校验通过 elapsed=${ELAPSED}s"
```

通过标准：隔离 Postgres 上 6/6、exit 0、60 秒内完成；依赖不可用不得静默跳过。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: PUT/PATCH 传字符串、null、浮点和范围外整数。
- 重复提交: 连续提交相同合法 patch，最终有效配置稳定。
- 中途中断: 持锁期间断开 DB，事务回滚且不留下锁或部分写入。
- 边界值: `min=max`、1、50、首次 upsert 的并发冲突。
发现分级: P0/P1（跨租户、非法落库、并发绕过）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 冲突拒绝与原子并发 | `tests/acquisition-config-effective-validation.integration.test.ts` | `有效配置 min>max 返回 400 INVALID_CONFIG 且零持久化`、`并发部分更新按锁后实际可见配置原子校验且最终 min<=max` | 当前孤立校验及无事务读写导致至少 3 failures |
| 合法更新与 schema | `tests/acquisition-config-effective-validation.integration.test.ts` | `合法部分 PATCH 成功且只改变请求字段并保持完整响应 schema与双租户隔离`、`合法完整 PUT 与 min=max 等值边界成功持久化并可读回`、`未涉及上下界的合法部分 PUT 不被误拒且只改变请求字段` | 修复不得使合法路径转红 |
