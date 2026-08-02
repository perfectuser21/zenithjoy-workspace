# Sprint Contract Draft (Round 2)

## Response Schema（推导来源: PRD 字面 + 现有 acquisition-dispatch 路由）

### Endpoint: PUT /api/acquisition/config

**Success (HTTP 200)**：沿用现有响应，不新增或改名字段。

```json
{"success":true,"data":{"tenant_id":"<string>","keywords_per_round_min":3,"keywords_per_round_max":5},"timestamp":"<ISO-8601 string>"}
```

- `success` (boolean, 必填)：现有 `OK` 包装。
- `data.tenant_id` (string, 必填)：必须等于鉴权解析出的当前租户 ID。
- `data.keywords_per_round_min` (number, 必填)：现有配置字段。
- `data.keywords_per_round_max` (number, 必填)：现有配置字段。
- `timestamp` (string, 必填)：非空且可由 `Date.parse` 解析的 ISO-8601 时间。

**Error (HTTP 400)**：

```json
{"success":false,"error":{"code":"INVALID_CONFIG","message":"<string>"},"timestamp":"<ISO-8601 string>"}
```

- `error.code` 必须字面等于 `INVALID_CONFIG`（PRD 明确）。
- `error.message` 为长度大于 0 的字符串，但不得回显完整租户配置。
- `timestamp` 为非空且可由 `Date.parse` 解析的 ISO-8601 时间。
- **禁用字段名**：`code` 顶层字段、`error_code`、`invalid_config`。

## 已知约束

- [apps/api/src/services/acquisition-dispatch.test.ts] → `defaultConfig`、字段范围校验、租户级配置读写的既有测试风格。
- [apps/api/src/routes/acquisition-dispatch.ts] → 调用方通过既有鉴权中间件获得 `req.tenantId`；配置更新入口为 `PUT /api/acquisition/config`。
- [累积FR] 本 line 暂无历史。
- context-manifest: unavailable（journey_id=none，端点返回 404）。
- Registry 可用：沿用现有 API 的 `{success,data|error,timestamp}` 包装、Postgres `zenithjoy.acquisition_config` 表及 Vitest 风格。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 对 patch 与当前租户配置合并后的有效配置校验关键词上下界；倒置返回 400/INVALID_CONFIG 且零写入；有效部分/完整更新保持成功。 |
| NFR（做得多好） | 不新增外部调用；校验与单次租户配置读取同请求完成；延迟阈值 PRD 未指定，N/A。 |
| Invariant（永不违反） | 原子拒绝无效更新；查询与写入只 scope 当前租户；另一租户不变；不改共享 Red fixture。 |
| 判定点（怎么知道） | 以合并后两个整数的数值比较为唯一判定点，见下表。 |
| 保质期（何时过期） | 随 acquisition 配置 schema 存续；若字段退役，由配置 schema owner 同步退役校验与回归测试。 |
| 死亡告警（停了谁知道） | API 400/错误码与集成测试失败立即可见；生产告警策略 PRD 未指定，N/A。 |
| 失败语义（挂了怎么办） | 无法读取当前配置或持久化时拦截并返回既有 5xx；无效配置不重试、不写入；有效请求由既有调用方决定重试。 |
| 效果确认（已发≠已生效） | 错误响应后 GET/DB 比对前后快照；成功响应后 GET/DB 读取新值；同时核对另一租户。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| 合并后关键词每轮上下界是否有效 | A. 只比较 patch；B. 读取当前租户配置后合并再比较 | B. 合并后比较 | PRD Golden Path 第 2 步 | A 会放过部分更新形成无效持久状态 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 合并后 min > max | HTTP 400/INVALID_CONFIG，零写入 | 是；重复拒绝且状态不变 | 不降级、不自动改值 |
| 当前配置读取或 DB 写入失败 | 沿用既有 5xx，禁止声称成功 | PUT 为同值重放可收敛 | 不使用默认值覆盖已有租户配置 |
| 合并后 min = max | 正常持久化并返回成功 | 是 | N/A |

### 输入对抗面

N/A：该端点是既有受鉴权业务 API，不是对外暴露 agent/prompt 输入面；数值类型与范围继续由既有校验覆盖。

## 真实调用方请求 shape

- 生产调用方仍调用 `PUT /api/acquisition/config`，`Content-Type: application/json`。
- 鉴权与租户选择沿用现有 `tenantContextOptional`：session 或 `X-Feishu-User-Id` 解析到 `req.tenantId`；body 不接受 `tenant_id` 作为租户权威。
- payload 关键字段逐字为 `keywords_per_round_min`、`keywords_per_round_max`，二者均可单独出现或同时出现。
- DoD/E2E 使用 `X-Feishu-User-Id`，不走 body `tenant_id` 分叉。

## 禁 mock 边清单

- `PUT /api/acquisition/config` 路由 ↔ `acquisition-dispatch` 配置服务（本单改变合并后校验时序，路由/服务集成测试不得 mock 任一侧）。
- 配置服务 ↔ 真 Postgres `zenithjoy.acquisition_config`（本单涉及 SELECT 后 merge 与 INSERT/UPDATE 写路径，integration 测试必须使用真 Postgres）。
- 租户上下文 ↔ 当前租户配置查询（测试至少两个租户，禁止用固定单租户替身掩盖串租户）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 1-3 步。

[提交配置 patch] → [读取当前租户配置并合并校验] → [拒绝且零写入，或成功持久化] → [读取确认]

### Step 1: 调用方提交部分或完整配置更新

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: 既有鉴权入口接受只含最小值、只含最大值或同时含两者的 JSON patch；租户身份不从 body 获取。

**验证命令**:

```bash
curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":4}' | jq -e '.success==true and .data.keywords_per_round_min==4'
```

**硬阈值**: HTTP 200；返回值为 4。上面的 `curl -f` 与 `jq -e` 同时执法。

### Step 2: 系统用当前租户配置补齐字段并判定有效配置

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步与「边界情况」前两项。

**可观测行为**: patch 自身看似有效但与当前值合并后 `min > max` 时，返回 HTTP 400，`error.code=INVALID_CONFIG`；相等时允许。

**验证命令**:

```bash
RESP_FILE=$(mktemp); CODE=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":9}'); [ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string") and (keys==["error","success","timestamp"]) and (has("error_code")|not)' "$RESP_FILE"
```

**硬阈值**: HTTP 恰为 400；错误码字面为 `INVALID_CONFIG`；顶层 keys 精确匹配且无禁用字段。命令中的状态码与 `jq -e` 执法。

### Step 3: 无效更新零持久化且租户隔离

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与「边界情况」后两项。

**可观测行为**: 拒绝后 A 租户整行配置与请求前相同，B 租户不被读取/写入且配置保持不变。

**验证命令**:

```bash
AFTER_A=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_A_ID'"); AFTER_B=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'"); [ "$AFTER_A" = "$BEFORE_A" ] && [ "$AFTER_B" = "$BEFORE_B" ]
```

**硬阈值**: 两个租户的整行 JSON 均逐字等于请求前快照；命令直接比较两份快照。

### Step 4: 有效部分与完整更新继续成功并可读取

**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步及「边界情况」相等值有效。

**可观测行为**: 只改 min、只改 max、完整更新及 min=max 均成功，成功响应包含当前 `tenant_id` 与可解析 `timestamp`，GET/DB 返回合并后的新值，B 租户保持不变。

**验证命令**:

```bash
RESP=$(curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_max":9}'); echo "$RESP" | jq -e --arg tid "$TENANT_A_ID" '.success==true and .data.tenant_id==$tid and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==9 and (.timestamp|type=="string" and length>0)' && node -e 'const x=JSON.parse(process.argv[1]); if(Number.isNaN(Date.parse(x.timestamp)))process.exit(1)' "$RESP"; curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":7,"keywords_per_round_max":7}' | jq -e --arg tid "$TENANT_A_ID" '.success==true and .data.tenant_id==$tid and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==7'; psql "$DB_URL" -XtAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=7 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A_ID'" | grep -qx t
```

**硬阈值**: max-only 更新 HTTP 200 且 max=9；完整相等更新 HTTP 200；成功响应 tenant_id 等于当前租户且 timestamp 可解析；真 DB 最终两个值均为 7。命令用 `jq -e`、`Date.parse` 与 SQL 定点读共同执法。

### Step 5: 防造假与盲测边界保持

**来源**: `[AI_ADDED]` — 防止只测 patch 自洽、历史数据或单租户替身造成假绿，同时落实 PRD 明示的盲测边界。

**可观测行为**: 测试从冻结 Red 基线以 TDD 先红后绿；不读取 One-session 候选材料、不修改共享 Red fixture、不在盲测 verdict 前合并。

**验证命令**:

```bash
git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- shared-red-fixture 2>/dev/null || { [ ! -e shared-red-fixture ] && exit 0; exit 1; }
```

**硬阈值**: 共享 Red fixture 零 diff；候选材料边界由 Harness 审计保证，合同不创建任何候选读取步骤。

### 冻结 Red SHA 真红证据

在冻结 SHA `0dc4e3c07ff19a0ac95440723986bf3cb78580b2` 上执行共享 Red 用例（只读，不修改 fixture）：

```bash
git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts && cd apps/api && npx vitest run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
```

**预期红证据**: 用例 `partial patch cannot make merged keyword bounds invalid` 在冻结实现上得到 `expected 200 to be 400`，命令 exit 非 0；依赖未安装或测试未收集不算真红。Generator 完成后同一命令必须 exit 0。

## 接缝清单

- [接缝×2] 真实 API ↔ 真 Postgres：用两个独立租户重复执行无效部分更新两次；两次均须 400/INVALID_CONFIG 且前后整行快照不变。真目标：local_api + 隔离 Postgres。
- API 鉴权租户 ↔ 配置 tenant_id：通过既有 `X-Feishu-User-Id` 解析，body 不传 tenant_id；用另一租户配置证明互不串。真目标：local_api。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${API_URL:=http://localhost:3000}"
: "${DB_URL:?DB_URL 必填，指向隔离测试 Postgres}"
: "${TENANT_A_USER:?TENANT_A_USER 必填}"
: "${TENANT_B_USER:?TENANT_B_USER 必填}"
TENANT_A_ID=$(psql "$DB_URL" -XtAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='$TENANT_A_USER' LIMIT 1")
TENANT_B_ID=$(psql "$DB_URL" -XtAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id='$TENANT_B_USER' LIMIT 1")
[ -n "$TENANT_A_ID" ] && [ -n "$TENANT_B_ID" ] && [ "$TENANT_A_ID" != "$TENANT_B_ID" ]
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO zenithjoy.acquisition_config (tenant_id,keywords_per_round_min,keywords_per_round_max) VALUES ('$TENANT_A_ID',3,8),('$TENANT_B_ID',11,12) ON CONFLICT (tenant_id) DO UPDATE SET keywords_per_round_min=EXCLUDED.keywords_per_round_min,keywords_per_round_max=EXCLUDED.keywords_per_round_max"
BEFORE_A=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_A_ID'")
BEFORE_B=$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'")
for ATTEMPT in 1 2; do
  BODY=$(mktemp)
  CODE=$(curl -sS -o "$BODY" -w '%{http_code}' -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":9}')
  [ "$CODE" = 400 ]
  jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string" and length>0) and (.timestamp|type=="string" and length>0) and (keys==["error","success","timestamp"]) and (has("error_code")|not)' "$BODY"
  node -e 'const x=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(Number.isNaN(Date.parse(x.timestamp)))process.exit(1)' "$BODY"
  [ "$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_A_ID'")" = "$BEFORE_A" ]
  [ "$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'")" = "$BEFORE_B" ]
done
MIN_RESP=$(curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":7}')
echo "$MIN_RESP" | jq -e --arg tid "$TENANT_A_ID" '.success==true and .data.tenant_id==$tid and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==8 and (.timestamp|type=="string" and length>0)'
node -e 'const x=JSON.parse(process.argv[1]); if(Number.isNaN(Date.parse(x.timestamp)))process.exit(1)' "$MIN_RESP"
MAX_RESP=$(curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_max":9}')
echo "$MAX_RESP" | jq -e --arg tid "$TENANT_A_ID" '.success==true and .data.tenant_id==$tid and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==9 and (.timestamp|type=="string" and length>0)'
node -e 'const x=JSON.parse(process.argv[1]); if(Number.isNaN(Date.parse(x.timestamp)))process.exit(1)' "$MAX_RESP"
curl -sf -X PUT "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" -H 'Content-Type: application/json' -d '{"keywords_per_round_min":7,"keywords_per_round_max":7}' | jq -e --arg tid "$TENANT_A_ID" '.success==true and .data.tenant_id==$tid and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==7 and (.timestamp|type=="string" and length>0)'
curl -sf "$API_URL/api/acquisition/config" -H "X-Feishu-User-Id: $TENANT_A_USER" | jq -e --arg tid "$TENANT_A_ID" '.data.tenant_id==$tid and .data.keywords_per_round_min==7 and .data.keywords_per_round_max==7'
psql "$DB_URL" -XtAc "SELECT keywords_per_round_min=7 AND keywords_per_round_max=7 FROM zenithjoy.acquisition_config WHERE tenant_id='$TENANT_A_ID'" | grep -qx t
[ "$(psql "$DB_URL" -XtAc "SELECT row_to_json(c)::text FROM zenithjoy.acquisition_config c WHERE tenant_id='$TENANT_B_ID'")" = "$BEFORE_B" ]
echo 'Golden Path 验证通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: `PUT /api/acquisition/config` 分别传字符串、浮点数、null 与范围外上下界。
- 重复提交: 连续两次提交同一有效 patch 与同一无效 patch，确认幂等和零写入。
- 中途中断: 请求处理中断客户端连接后重新 GET，确认不出现半更新。
- 边界值: min=max、1、50，以及当前配置在边界时只更新另一端。
- 租户对抗: body 注入另一租户 `tenant_id`，确认仍只作用于鉴权租户。

发现分级: P0/P1（跨租户、无效配置落库、有效配置被破坏）阻塞 merge；P2/P3 记录 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合并后配置校验与租户隔离 | `tests/acquisition-config-effective-validation.integration.test.ts` | `只更新最小值且合并后倒置时拒绝并零持久化`；`有效部分、完整和相等边界更新继续持久化且不串租户` | 冻结 Red SHA 的共享用例报 `expected 200 to be 400`；真 Postgres 首条断言因 `upsertConfig` 未校验而失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 本轮仅使用当前仓库与允许复用的 Kernel 上下文；未检查或复制 One-session 候选 worktree、patch、日志、PR 或反馈。
