# Sprint Contract Draft (Round 1)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 产品分类锚点来自 `product-map/generated/product-map.md`；安装锁定依赖后 `npm run product-map:check` 已通过，无分类漂移。
- 冻结 Red fixture 只读；本合同不修改共享 Red fixture，也不读取 One-session 候选证据。

## Response Schema（推导来源: PRD字面 + 现有 acquisition 路由）

### Endpoint: PUT /api/acquisition/config

**冲突有效配置 (HTTP 400)**：

```json
{"success":false,"error":{"code":"INVALID_CONFIG","message":"<string>"},"timestamp":"<ISO-8601 string>"}
```

- `error.code` (string, 必填)：PRD 字面要求固定为 `INVALID_CONFIG`。
- `error.message` (string, 必填)：沿用现有 `apps/api/src/routes/acquisition-dispatch.ts` 的错误 envelope。
- `success` (boolean, 必填) 与 `timestamp` (string, 必填)：沿用同一路由既有 envelope。

**合法更新 (HTTP 200)**：

```json
{"success":true,"data":{"tenant_id":"<uuid>","keywords_per_round_min":3,"keywords_per_round_max":8},"timestamp":"<ISO-8601 string>"}
```

- `data.tenant_id`、`data.keywords_per_round_min`、`data.keywords_per_round_max`：现有 API 响应字段，供合法更新后读取观察。
- 禁用字段名：N/A（PRD 未声明同义字段禁用清单）。

## 已知约束（来自回归测试与累积 FR）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 非法数值 → 400 INVALID_CONFIG，不写库`
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid`（冻结 Red fixture，只读）
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `PUT /config 合法 → 200 + upsert`
- `apps/api/src/services/acquisition-dispatch.test.ts` → `getConfig`、`upsertConfig` 的租户配置读写约束。
- [累积FR] PRD 声明本 line 暂无历史。
- [累积FR] context-manifest: unavailable（Brain 对该 journey 路径返回 404）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 对 acquisition 配置补丁先与当前租户配置合并，再校验 `keywords_per_round_min <= keywords_per_round_max`；冲突返 400/`INVALID_CONFIG` 且零写入，合法更新保持成功。 |
| NFR（做得多好） | 不新增延迟硬指标；验证必须使用真实 API 与真实 Postgres，并覆盖两个租户。 |
| Invariant（永不违反） | 无效有效配置不落库；只读写 `X-Tenant-Id` 指定租户；等值边界合法；不改共享 Red fixture。 |
| 判定点（怎么知道） | 以合并后的两个数值作确定性比较，无模糊现实判定。 |
| 保质期（何时过期） | 配置在下一次合法更新前有效；字段或 API 契约退役时同步退役测试。 |
| 死亡告警（停了谁知道） | CI 的 Red/回归测试与 evaluator 的 HTTP/DB oracle 在本轮即失败；无额外线上告警需求。 |
| 失败语义（挂了怎么办） | 配置冲突 fail-closed，HTTP 400，不重试、不写库；合法请求沿用现有 upsert 语义。 |
| 效果确认（已发≠已生效） | 失败以 400/code 和写前写后 DB 相同双验；成功以 200 和 DB/GET 可读值双验。 |

### 判定点登记表

（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 合并后 min > max | HTTP 400 + `INVALID_CONFIG`，不写入 | 是；相同非法请求持续无副作用 | 无降级，fail-closed |
| DB 读取或写入故障 | 沿用现有服务错误处理，不把失败报告为成功 | 客户端可在确认失败后重试 | 不以默认值掩盖写入故障 |

### 输入对抗面

N/A：该接口是已鉴权租户配置 API，不是对外暴露 agent 或非可信内容 pipeline；数值类型、范围与组合关系仍按现有校验拒绝。

## 真实调用方请求 shape

- 生产 Dashboard 的 `apps/dashboard/src/api/acquisition-dispatch.api.ts` 使用 `PUT /api/acquisition/config`、`Content-Type: application/json`，JSON body 只含更新字段。
- 租户认证/隔离由 session 或兼容调用方的 `X-Tenant-Id` header 进入 `tenantContextOptional`；DoD 使用 `X-Tenant-Id`，不在 body 伪造 `tenant_id`。
- 关键 payload 字段逐字为 `keywords_per_round_min` 与 `keywords_per_round_max`。

## 禁 mock 边清单

- `acquisition-dispatch route ↔ acquisition-dispatch service`（本单改变路由校验与 service 合并读写的接力，测试必须真调相邻模块）。
- `acquisition-dispatch service ↔ zenithjoy.acquisition_config`（本单触及 DB 读写路径，测试必须使用真 Postgres，禁止 mock pool）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[PUT 配置补丁] → [合并当前租户配置并校验] → [拒绝且零写入，或合法持久化并可读取]

### Step 1: 当前租户提交部分或完整配置更新

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 步。

**可观测行为**: 服务只接受当前租户上下文中的配置更新，另一个租户保持隔离。

**验证命令**:

```bash
curl -sf -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_A" -d '{"keywords_per_round_min":3,"keywords_per_round_max":8}' | jq -e --arg t "$TENANT_A" '.success==true and .data.tenant_id==$t and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==8'
```

**硬阈值**: 合法请求 HTTP 200；响应租户等于 header 租户，字段值逐字匹配请求。上述 `curl -f + jq -e` 为对应机器断言。

### Step 2: 与租户当前配置合并后校验上下界

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 2 步及两个对称边界情况。

**可观测行为**: 只更新 min 或只更新 max 时，校验对象包含 DB 中未更新的另一边界；合并结果 `min > max` 即返回 HTTP 400 和 `error.code=INVALID_CONFIG`。

**验证命令**:

```bash
CODE=$(curl -sS -o /tmp/acq-invalid.json -w '%{http_code}' -X PUT "${API_BASE:-http://localhost:3000}/api/acquisition/config" -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_A" -d '{"keywords_per_round_min":10}'); [ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type)=="string"' /tmp/acq-invalid.json
```

**硬阈值**: 同步返回 HTTP 400，`error.code` 必须逐字等于 `INVALID_CONFIG`；命令对状态码与业务字段同时断言。

### Step 3: 失败零写入；合法部分、完整及等值更新持久化

**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 3 步与「边界情况」。

**可观测行为**: 非法请求后目标租户写前写后值一致，第二租户不变；合法部分和完整更新成功，`min=max` 合法且后续读取可见。

**验证命令**:

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT keywords_per_round_min=3 AND keywords_per_round_max=5 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A'" | grep -qx t
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=9 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_B'" | grep -qx t
```

**硬阈值**: 无效请求后两租户值完全不变；有效请求后仅目标租户值改变。两条定点 DB 读为对应机器断言；本断言不是历史计数，不适用 created_at 时间窗。

### Step 4: 防历史假绿的真实链路集成测试

**来源**: `[AI_ADDED]` — 为落实 PRD 的 TDD 与零持久化要求，防止 mock pool 掩盖 route→service→Postgres 接缝断裂。

**可观测行为**: 新测试在真实路由和真实 Postgres 上先红；实现后覆盖对称冲突、合法回归和双租户隔离。

**验证命令**:

```bash
cd /workspace && npx vitest run --config vitest.config.cjs sprints/0802135715-ab-kernel-acquisition-config-amended-runner/tests/acquisition-effective-config.integration.test.ts --reporter=verbose
```

**硬阈值**: 3 个 `it()` 全通过且进程 exit 0；测试不得含 `vi.mock`、stub 或 fake pool。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?必须显式提供测试 Postgres DB_URL}"
API_BASE="${API_BASE:-http://localhost:3000}"
TENANT_A="$(node -e 'console.log(require("crypto").randomUUID())')"
TENANT_B="$(node -e 'console.log(require("crypto").randomUUID())')"
cleanup() { psql "$DB_URL" -v ON_ERROR_STOP=1 -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id IN ('$TENANT_A','$TENANT_B')" >/dev/null; }
trap cleanup EXIT
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('$TENANT_A',3,5),('$TENANT_B',7,9)" >/dev/null
BEFORE_A="$(psql "$DB_URL" -Atc "SELECT row_to_json(x)::text FROM (SELECT keywords_per_round_min,keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A') x")"
BEFORE_B="$(psql "$DB_URL" -Atc "SELECT row_to_json(x)::text FROM (SELECT keywords_per_round_min,keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_B') x")"
CODE="$(curl -sS -o /tmp/acq-min-invalid.json -w '%{http_code}' -X PUT "$API_BASE/api/acquisition/config" -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_A" -d '{"keywords_per_round_min":10}')"
[ "$CODE" = 400 ]
jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type)=="string"' /tmp/acq-min-invalid.json
[ "$(psql "$DB_URL" -Atc "SELECT row_to_json(x)::text FROM (SELECT keywords_per_round_min,keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A') x")" = "$BEFORE_A" ]
[ "$(psql "$DB_URL" -Atc "SELECT row_to_json(x)::text FROM (SELECT keywords_per_round_min,keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_B') x")" = "$BEFORE_B" ]
CODE="$(curl -sS -o /tmp/acq-max-invalid.json -w '%{http_code}' -X PUT "$API_BASE/api/acquisition/config" -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_B" -d '{"keywords_per_round_max":5}')"
[ "$CODE" = 400 ]
jq -e '.success==false and .error.code=="INVALID_CONFIG"' /tmp/acq-max-invalid.json
[ "$(psql "$DB_URL" -Atc "SELECT row_to_json(x)::text FROM (SELECT keywords_per_round_min,keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_B') x")" = "$BEFORE_B" ]
curl -sf -X PUT "$API_BASE/api/acquisition/config" -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_A" -d '{"keywords_per_round_max":8}' | jq -e --arg t "$TENANT_A" '.success==true and .data.tenant_id==$t and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==8'
curl -sf -X PUT "$API_BASE/api/acquisition/config" -H 'Content-Type: application/json' -H "X-Tenant-Id: $TENANT_A" -d '{"keywords_per_round_min":6,"keywords_per_round_max":6}' | jq -e '.success==true and .data.keywords_per_round_min==6 and .data.keywords_per_round_max==6'
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT keywords_per_round_min=6 AND keywords_per_round_max=6 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A'" | grep -qx t
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=9 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_B'" | grep -qx t
echo 'Golden Path 验证通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: PUT `/api/acquisition/config` 给任一边界传字符串、null、小数或范围外整数。
- 重复提交: 连续提交相同非法补丁及相同合法补丁，确认无状态振荡。
- 中途中断: 在 DB 不可达时提交更新，确认不报告成功；恢复后重试合法请求。
- 边界值: `min=max`、1、50，以及从合法值跨越另一当前边界的单字段更新。
- 租户隔离: 在两个 tenant header 间交替请求，body 注入 `tenant_id` 不得覆盖 header 选定租户。

发现分级: P0/P1（跨租户、错误持久化、错误放行）阻塞 merge；P2/P3 记录 findings 不阻塞。

## 接缝清单

- [接缝×2] API route → service → 真 Postgres：在 `local_api` 测试库重复执行两次冲突部分更新，均须 400/`INVALID_CONFIG` 且 DB 不变；未真验前状态为 `logic-done-pending`。
- [接缝×2] `X-Tenant-Id` → 当前租户配置行：用两个真实租户重复执行并核对第二租户不变；未真验前状态为 `logic-done-pending`。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 有效配置合并校验 | `tests/acquisition-effective-config.integration.test.ts` | `部分更新 min 与当前 max 合并后冲突`；`部分更新 max 与当前 min 合并后冲突`；`合法部分更新、合法完整更新和等值边界` | 当前实现只校验 patch，前两项预期收到 200 而非 400，至少 2 failures |
