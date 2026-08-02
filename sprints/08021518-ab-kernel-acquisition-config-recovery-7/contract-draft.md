# Sprint Contract Draft (Round 6)

## Response Schema（推导来源: PRD 字面 + 现有路由）

### Endpoint: PUT /api/acquisition/config

- 成功响应沿用现有 `{success:true,data,timestamp}`，不改变字段。
- 合并后无效响应为 HTTP 400：`{"success":false,"error":{"code":"INVALID_CONFIG","message":"<非空字符串>"},"timestamp":"<ISO-8601>"}`。
- 禁用字段名：顶层 `code`、`error_code`、`invalid_config`。

## 已知约束

- [apps/api/src/services/acquisition-dispatch.test.ts] → Vitest；配置查询均按 tenant_id。
- [apps/api/src/routes/acquisition-dispatch.ts] → `PUT /config` 先校验后调用 `upsertConfig`，错误使用嵌套 `error.code`。
- [apps/api/src/middleware/tenant-context.ts] → `tenantContextOptional` 的显式调用方 shape 是 `X-Tenant-Id` 或 `body.tenant_id`，本合同采用冻结 Red 一致的 `X-Tenant-Id`。
- [累积FR] 暂无；context-manifest: unavailable（journey_id=none）。
- Registry 未提供额外约束，按 PRD 与源码字面模式。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | patch 与当前租户配置合并后校验关键词上下界；无效返回 400/INVALID_CONFIG 且不写；有效更新保持成功。 |
| NFR | 延迟/频控未指定，N/A；不得记录配置内容。 |
| Invariant | 当前租户隔离、无效更新零写入、有效更新不回退、鉴权不变。 |
| 判定点 | 合并后 `min <= max`，见登记表。 |
| 保质期 | 随 acquisition 配置字段存续；字段退役时同步退役校验。 |
| 死亡告警 | HTTP 错误与 integration 回归失败可见；生产告警未指定，N/A。 |
| 失败语义 | 无效配置稳定拒绝；DB 故障沿用 5xx；不自动纠正输入。 |
| 效果确认 | HTTP 响应加真 Postgres 前后快照/定点读取。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 合并后关键词上下界有效性 | 只比较 patch；读取当前租户后比较 effective config | 比较 effective config | PRD Golden Path 第 2 步 | 无效配置落库 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| effective min > max | HTTP 400/INVALID_CONFIG，写入语句不执行 | 是 | 不降级 |
| 配置读取/写入失败 | 沿用 5xx，不返回成功 | 同值重放可收敛 | 不用默认值覆盖当前配置 |

### 输入对抗面

N/A：既有受鉴权配置 API，不是 agent/prompt 输入面。

## 真实调用方请求 shape

- `PUT /api/acquisition/config`，`Content-Type: application/json`。
- 认证/租户方式保持源码现状：`tenantContextOptional` 接受 `X-Tenant-Id` 或 `body.tenant_id`；本合同和冻结 Red 使用 `X-Tenant-Id`，不新增鉴权行为。
- payload 字段逐字为 `keywords_per_round_min`、`keywords_per_round_max`，可单独或同时出现。

## Risks

| 风险 | Mitigation |
|---|---|
| 只校验 patch 自身而未校验合并后的 effective config | 真 HTTP + 真 Postgres 测试预置当前租户配置，分别以 min-only/max-only 构造合并后倒置。 |
| 无效请求错误写入或串租户 | 请求前后读取 A/B 两租户整行快照并比较；所有 SQL 以 tenant_id 定点读取。 |

## 禁 mock 边清单

- `PUT /api/acquisition/config` 路由 ↔ `upsertConfig`（必须以真 HTTP 证明 effective config 的领域错误映射为 400）。
- `upsertConfig` ↔ 真 Postgres `zenithjoy.acquisition_config`（必须真实读取当前租户、合并 patch，并验证拒绝时零写入）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 1-3 步。

[提交 patch] → [读取当前租户并合并校验] → [400 零写入或 200 持久化] → [读取确认]

### Step 1: 提交部分或完整 PUT 更新
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步。
**可观测行为**: 使用既有 X-Tenant-Id 调用；鉴权保持不变。
**验证命令**: `curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":4}' | jq -e '.success==true and .data.keywords_per_round_min==4'`
**硬阈值**: HTTP 200 且返回 min=4，由上述 `curl -f`/`jq -e` 执法。

### Step 2: 以当前配置补齐后校验并稳定映射错误
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步及边界情况。
**可观测行为**: 当前 min=3/max=8 时只提交 min=9，真 HTTP 返回 400/INVALID_CONFIG，而非 500。
**验证命令**: `F=$(mktemp); C=$(curl -sS -o "$F" -w '%{http_code}' -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":9}'); [ "$C" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.timestamp|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")) and keys==["error","success","timestamp"]' "$F"`
**硬阈值**: HTTP 恰为 400、错误码字面匹配、错误响应 timestamp 为 ISO-8601 且顶层 keys 完整，由状态码与 jq 共同执法。

### Step 3: 无效更新零持久化并隔离租户
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步及边界情况。
**可观测行为**: A 的无效请求后 A/B 两租户整行分别不变。
**验证命令**: `A1=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_A_ID'"); B1=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'"); [ "$A1" = "$A0" ] && [ "$B1" = "$B0" ]`
**硬阈值**: 两个快照逐字相等，由 shell 比较执法。

### Step 4: 有效 PUT 部分、完整及相等边界继续成功
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 步与边界情况。
**可观测行为**: min-only、max-only、完整更新与 min=max 返回 200 并可从 DB 读到，B 不变。
**验证命令**: `curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":7,"keywords_per_round_max":7}' | jq -e '.success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==7 and (.timestamp|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")) and keys==["data","success","timestamp"]'`
**硬阈值**: HTTP 200、两值均为 7、成功响应 timestamp 为 ISO-8601 且顶层 keys 完整，由上述命令执法。

### Step 5: 冻结 Red 与盲测边界
**来源**: `[AI_ADDED]` — 将 PRD 的测试/盲测约束变为交付边界，防止假绿。
**可观测行为**: 真实共享 Red 文件保持冻结 SHA 的 blob；本轮只产生 sprint 合同资产，不检查或复制 One-session 候选材料；盲测裁决前不存在 merge commit。
**验证命令**: `BASE=18333a8293ea3a9c8fac1a3111142fa6491fbb59; RED=0dc4e3c07ff19a0ac95440723986bf3cb78580b2; RED_PATH=apps/api/tests/routes/acquisition-dispatch.test.ts; test "$(git rev-parse "$RED:$RED_PATH")" = "$(git hash-object "$RED_PATH")" && test -z "$(git diff --name-only "$BASE" HEAD -- . ':(exclude)sprints/08021518-ab-kernel-acquisition-config-recovery-7/**')" && test -z "$(git rev-list --min-parents=2 "$BASE"..HEAD)"`
**硬阈值**: 共享 Red 文件 blob 与冻结 SHA 完全相同；base 之后零 sprint 外变更；base 之后零 merge commit，三项均由上述命令执法。

## 接缝清单

- [接缝×2] 真 HTTP ↔ 服务 ↔ 真 Postgres：无效 min-only/max-only 各重复两次，均须 400/INVALID_CONFIG 且零写入。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${API_URL:=http://localhost:3000}"
: "${DB_URL:?DB_URL 必填}"
TENANT_A_ID=${TENANT_A_ID:-00000000-0000-4000-8000-000000000a01}
TENANT_B_ID=${TENANT_B_ID:-00000000-0000-4000-8000-000000000b02}
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('$TENANT_A_ID',3,8),('$TENANT_B_ID',11,12) ON CONFLICT (tenant_id) DO UPDATE SET keywords_per_round_min=EXCLUDED.keywords_per_round_min,keywords_per_round_max=EXCLUDED.keywords_per_round_max"
A0=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_A_ID'")
B0=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'")
for PAYLOAD in '{"keywords_per_round_min":9}' '{"keywords_per_round_max":2}'; do
  for ATTEMPT in 1 2; do
    F=$(mktemp)
    C=$(curl -sS -o "$F" -w '%{http_code}' -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d "$PAYLOAD")
    [ "$C" = 400 ]
    jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string" and length>0) and (.timestamp|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")) and (keys==["error","success","timestamp"]) and (has("error_code")|not) and (has("code")|not)' "$F"
    [ "$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_A_ID'")" = "$A0" ]
    [ "$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'")" = "$B0" ]
  done
done
curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":7}' | jq -e '.success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==8 and (.timestamp|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")) and keys==["data","success","timestamp"]'
curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d '{"keywords_per_round_max":9}' | jq -e '.success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==9 and (.timestamp|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")) and keys==["data","success","timestamp"]'
curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Tenant-Id: $TENANT_A_ID" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":7,"keywords_per_round_max":7}' | jq -e '.success==true and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==7 and (.timestamp|type=="string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$")) and keys==["data","success","timestamp"]'
psql "$DB_URL" -XtAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=7 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A_ID'" | grep -qx t
[ "$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'")" = "$B0" ]
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 两字段传字符串、null、浮点和范围外值。
- 重复提交: 同一有效/无效 patch 连续提交。
- 中途中断: 请求处理中断后 GET，确认无半更新。
- 边界值: min=max、1、50。

发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合并校验、HTTP 映射、零写入 | `tests/acquisition-config-effective-validation.integration.test.ts` | `真 HTTP 对合并后无效的 min-only patch 返回 400 INVALID_CONFIG 且零持久化`；`真 HTTP 对合并后无效的 max-only patch 返回 400 INVALID_CONFIG 且零持久化`；`有效部分、完整和相等边界更新继续成功且不串租户` | 冻结实现前两条收到 200 而非 400 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- Reviewer Round 3 修订：B-01 测试内真实连续执行两次请求；删除 PRD 未要求的并发控制与另一更新入口范围，仅约束既有 PUT 更新入口。
- Reviewer Round 4 修订：新增 B-05 五行剧本，以真实共享 Red 路径、sprint 外零变更和零 merge commit 的 git 基线证据机检冻结 Red、候选材料禁查/禁复制及盲测裁决前禁合并边界。
- Reviewer Round 5 修订：错误与成功响应均新增完整顶层 keys 断言及 ISO-8601 timestamp 可解析断言。
- 本轮未检查或复制 One-session 候选 worktree、patch、日志、PR 或反馈。
