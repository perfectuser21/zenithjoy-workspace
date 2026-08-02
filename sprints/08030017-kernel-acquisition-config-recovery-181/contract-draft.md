# Sprint Contract Draft (Round 4)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 冻结 Red 基线：`0dc4e3c07ff19a0ac95440723986bf3cb78580b2`。本轮未修改共享 Red fixture，且禁止读取 One-session 候选 worktree、patch、日志、PR 或反馈。
- Registry 可达但未登记本端点；test registry 已登记 Line 02 acquisition config E2E。context-manifest 返回 404 HTML。
- Round 4 只修 Reviewer 指定缺口：恢复真实 local_api HTTP + Dashboard session-cookie 鉴权 E2E，按生产调用方/tenant middleware 修正请求 shape，并增加独立 Risks 与 mitigation；其余 PRD 覆盖不扩张。
- 首次 `npm run product-map:check` 因 workspace 缺锁定依赖 `ajv` 未启动；执行 `npm ci` 后重跑已 PASS（digest `5011e4ef...`），无分类漂移。
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

- 生产 Dashboard `apps/dashboard/src/api/acquisition-dispatch.api.ts` 对 `PUT /api/acquisition/config` 发送 `credentials:'include'`、`Content-Type: application/json` 与 JSON patch；浏览器以 better-auth `Cookie` 携带 session，可选 `Authorization: Bearer <license>` 不是 tenant 解析的替代品。Dashboard 不发送 `X-Tenant-Id`，也不在 body 发送 `tenant_id`。
- 生产 `tenantContextOptional` 的真实解析顺序为：显式 `X-Tenant-Id`/`body.tenant_id` 兼容捷径；否则进入 `tenantContext`，先解析 better-auth session cookie，再回落 `X-Feishu-User-Id`。本 Sprint 的 Final E2E 必须走 Dashboard 同形的 session cookie 分支，禁止用 `X-Tenant-Id` 绕过鉴权；TDD 集成测试另走生产支持的 `X-Feishu-User-Id` 回落分支以覆盖真实 middleware。
- Final E2E 请求逐字段固定为：`Cookie: ${AUTH_COOKIE_A|B}`、`Content-Type: application/json`、body 仅含既有 acquisition config 字段；URL 固定为真实 `http://127.0.0.1:${API_PORT}/api/acquisition/config`。tenant 身份只由 cookie 对应 session 解析，合同同时验证无 cookie 请求为 401。

## Risks 与 mitigation

| Risk | 影响 | Mitigation / 验收闸 |
|---|---|---|
| 把 `X-Tenant-Id` 兼容捷径误当 Dashboard 鉴权 | 路由/DB 绿但真实浏览器 session 链路未跑 | Final E2E 禁止 `X-Tenant-Id` 与 body `tenant_id`，用两个真实 disposable better-auth session cookie；先断言无 cookie=401，再跑双租户全链。 |
| read→merge→upsert 非原子，同租户并发使用旧快照 | 双 200 后落入 `min>max` 非法态 | failing test 对已有行和首次无行 tenant 并发真打生产 routers/middleware + 真 Postgres，Final E2E 再打完整 HTTP app；被改的 service↔DB 边禁 mock，最终必须一成一拒且不变量成立。 |
| PATCH 路由与 PUT 路由分属两个生产 router，修一漏一 | 单边越界仍可落库或错误码漂移 | PUT 提高 min 与 PATCH 降低 max 分别验 400/`INVALID_CONFIG`/整行零写入；共享 Red fixture 同时点绿。 |
| E2E 凭据或 DB 指向非隔离环境 | 污染真实租户或泄露 session | `DB_URL`、`AUTH_COOKIE_A/B`、`TENANT_ID_A/B` 仅由隔离验收环境注入；要求 disposable tenants，脚本不打印 cookie，并用 trap 只清理这两个随机验收 tenant 的 config 行。 |
| workspace 依赖未安装导致门禁未执行 | 合同格式绿但分类/测试门禁未真跑 | 先 `npm ci`，再重跑 `npm run product-map:check`、Red/Green smoke 与质量门禁；缺依赖视为环境未就绪而非 PASS。 |

## 禁 mock 边清单

- PUT/PATCH Express 路由 ↔ `upsertConfig`：测试挂载真实生产 router/service，禁止 mock 任一侧。
- `upsertConfig` ↔ Postgres `zenithjoy.acquisition_config`：测试使用真 Pool、真事务/并发请求，禁止 mock pool/client。
- tenant middleware ↔ 路由 tenant scope：Final E2E 通过真实 better-auth session cookie；集成测试通过生产 `X-Feishu-User-Id` 回落，两者均种至少两个真实 tenant/member，禁止 mock middleware。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] Dashboard 同形 Cookie 鉴权 ↔ tenant middleware ↔ API ↔ Postgres：启动真实 HTTP app，用两个真实 disposable session cookie 重复执行非法零写入、合法整行 diff 与双租户隔离；真验前为 `logic-done-pending`。
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
: "${DB_URL:?须指向隔离验收 Postgres}"
: "${AUTH_COOKIE_A:?须注入 disposable tenant A 的完整 better-auth Cookie header 值}"
: "${AUTH_COOKIE_B:?须注入 disposable tenant B 的完整 better-auth Cookie header 值}"
: "${TENANT_ID_A:?须注入 cookie A 对应的 UUID tenant_id}"
: "${TENANT_ID_B:?须注入 cookie B 对应的 UUID tenant_id}"
API_PORT="${API_PORT:-33181}"
CONFIG_URL="http://127.0.0.1:${API_PORT}/api/acquisition/config"
START=$(date +%s)
command -v curl >/dev/null && command -v jq >/dev/null && command -v psql >/dev/null && command -v node >/dev/null || { echo "FAIL: 缺 curl/jq/psql/node"; exit 1; }
[ -x node_modules/.bin/ts-node ] || { echo "FAIL: 依赖未安装，请先 npm ci"; exit 1; }
npm run build --workspace=apps/api >/tmp/kernel-acquisition-build.log 2>&1 || { tail -60 /tmp/kernel-acquisition-build.log; exit 1; }
export DATABASE_HOST="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')"
export DATABASE_PORT="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).port||"5432")')"
export DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))')"
export DATABASE_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')"
export DATABASE_PASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')"
export PORT="$API_PORT"
unset VITEST
cleanup() { set +e; if [ -n "${API_PID:-}" ]; then kill "$API_PID" 2>/dev/null; wait "$API_PID" 2>/dev/null; fi; psql "$DB_URL" -v ON_ERROR_STOP=1 -v ta="$TENANT_ID_A" -v tb="$TENANT_ID_B" -c "DELETE FROM zenithjoy.acquisition_config WHERE tenant_id IN (:'ta',:'tb')" >/dev/null 2>&1; CLEANUP_EXIT=$?; set -e; return "$CLEANUP_EXIT"; }
trap cleanup EXIT
node_modules/.bin/ts-node --transpile-only --project apps/api/tsconfig.json -e "import app from './apps/api/src/app'; app.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('kernel-e2e-api-ready'));" >/tmp/kernel-acquisition-api.log 2>&1 &
API_PID=$!
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null && break; kill -0 "$API_PID" 2>/dev/null || { tail -40 /tmp/kernel-acquisition-api.log; exit 1; }; [ "$i" -lt 30 ] || { echo "FAIL: API 30s 未就绪"; tail -40 /tmp/kernel-acquisition-api.log; exit 1; }; sleep 1; done
req_a() { curl -sS -H "Cookie: ${AUTH_COOKIE_A}" -H 'Content-Type: application/json' "$@"; }
req_b() { curl -sS -H "Cookie: ${AUTH_COOKIE_B}" -H 'Content-Type: application/json' "$@"; }
UNAUTH_CODE=$(curl -sS -o /tmp/kernel-unauth.json -w '%{http_code}' "$CONFIG_URL")
[ "$UNAUTH_CODE" = 401 ] && jq -e '.success==false and .error.code=="UNAUTHORIZED"' /tmp/kernel-unauth.json >/dev/null || { echo "FAIL: 无 session 未被 401 拒绝 code=$UNAUTH_CODE"; exit 1; }
req_a -f -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":5,"keywords_per_round_max":10}' | jq -e '.success==true and .data.keywords_per_round_min==5 and .data.keywords_per_round_max==10' >/dev/null
req_b -f -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":2,"keywords_per_round_max":8}' | jq -e '.success==true and .data.keywords_per_round_min==2 and .data.keywords_per_round_max==8' >/dev/null
req_a -f "$CONFIG_URL" >/tmp/kernel-a-before-response.json
req_b -f "$CONFIG_URL" >/tmp/kernel-b-before-response.json
jq -e --arg tenant "$TENANT_ID_A" '.success==true and .data.tenant_id==$tenant' /tmp/kernel-a-before-response.json >/dev/null
jq -e --arg tenant "$TENANT_ID_B" '.success==true and .data.tenant_id==$tenant' /tmp/kernel-b-before-response.json >/dev/null
jq -S '.data' /tmp/kernel-a-before-response.json >/tmp/kernel-a-before.json
jq -S '.data' /tmp/kernel-b-before-response.json >/tmp/kernel-b-before.json
CODE=$(req_a -o /tmp/kernel-invalid-put.json -w '%{http_code}' -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":11}')
[ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' /tmp/kernel-invalid-put.json >/dev/null || { echo "FAIL: invalid PUT code=$CODE"; exit 1; }
req_a -f "$CONFIG_URL" | jq -S '.data' | diff -u /tmp/kernel-a-before.json -
req_b -f "$CONFIG_URL" | jq -S '.data' | diff -u /tmp/kernel-b-before.json -
CODE=$(req_a -o /tmp/kernel-invalid-patch.json -w '%{http_code}' -X PATCH "$CONFIG_URL" -d '{"keywords_per_round_max":4}')
[ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' /tmp/kernel-invalid-patch.json >/dev/null || { echo "FAIL: invalid PATCH code=$CODE"; exit 1; }
req_a -f "$CONFIG_URL" | jq -S '.data' | diff -u /tmp/kernel-a-before.json -
req_b -f "$CONFIG_URL" | jq -S '.data' | diff -u /tmp/kernel-b-before.json -
req_a -f -X PATCH "$CONFIG_URL" -d '{"keywords_per_round_min":8}' | jq -e '.success==true and .data.keywords_per_round_min==8 and .data.keywords_per_round_max==10' >/dev/null
req_a -f -X PUT "$CONFIG_URL" -d '{"collect_rounds_per_day":4,"keywords_per_round_min":12,"keywords_per_round_max":12,"collect_active_start":"08:00","collect_active_end":"20:00","burner_count":4,"dm_per_hour":6,"dm_per_day":32,"dm_interval_min_sec":240,"dm_interval_max_sec":720,"dm_active_start":"10:00","dm_active_end":"21:00","nurture_per_day_min":2,"nurture_per_day_max":4,"cookie_check_interval_hours":8,"dm_message":"Kernel E2E complete update"}' | jq -e '.success==true and .data.keywords_per_round_min==12 and .data.keywords_per_round_max==12 and .data.dm_per_day==32' >/dev/null
req_a -f "$CONFIG_URL" | jq -e '.data.keywords_per_round_min==12 and .data.keywords_per_round_max==12 and .data.dm_per_day==32' >/dev/null
req_b -f "$CONFIG_URL" | jq -S '.data' | diff -u /tmp/kernel-b-before.json -
psql "$DB_URL" -v ON_ERROR_STOP=1 -v ta="$TENANT_ID_A" -v tb="$TENANT_ID_B" -Atc "SELECT count(*) FROM zenithjoy.acquisition_config WHERE tenant_id IN (:'ta',:'tb') AND keywords_per_round_min <= keywords_per_round_max" | grep -qx '2'
git diff --exit-code 0dc4e3c07ff19a0ac95440723986bf3cb78580b2 -- apps/api/tests/routes/acquisition-dispatch.test.ts
npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 120 ] || { echo "FAIL: E2E 耗时 ${ELAPSED}s > 120s"; exit 1; }
echo "OK: 真实 HTTP + session auth + 双租户 effective-config E2E 通过 elapsed=${ELAPSED}s"
```

通过标准：真实 local_api 进程已监听；无 cookie=401；两个真实 session cookie 分别解析到 A/B；非法 PUT/PATCH 均 400 + `INVALID_CONFIG` 且 A/B 全量配置不变；合法部分/完整更新可读回；B 不变；共享 Red fixture 1/1 且 fixture 未改；总耗时 ≤120s。cookie、DB 或解释器不可用一律 FAIL。

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
