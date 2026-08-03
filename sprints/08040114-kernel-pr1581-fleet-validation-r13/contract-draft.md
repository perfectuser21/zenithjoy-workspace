# Sprint Contract Draft (Round 3)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- Round 3 重绑定：本轮以 task bundle 顶层输入为 SSOT，`attempt_id=6b434554-d9c5-4a65-a31a-238eceb86d44`、`capability_snapshot_id=bd824197-70a6-48b6-9a26-93b452ed001f`、`provider/account/model/machine=codex/team2/gpt-5.6-sol/us-mac-m4`；Round 2 的 attempt/snapshot/account 证据全部过期，不得作为本轮证据。
- 本合同只验证 PR #1581 的固定候选，不修改其产品行为，也不读取其他候选实现。
- Registry 可达但快照已陈旧 386 小时；本任务无新增 HTTP schema，按 PRD 字面约束与目标 PR 已冻结测试翻译。context-manifest: unavailable（404 HTML）。
- `npm run product-map:check` 首次因依赖未安装报 `ERR_MODULE_NOT_FOUND: ajv`；执行 `npm ci` 后重跑，结果见自查证据。
- 本 attempt 的裁决证据目录固定为 `sprints/08040114-kernel-pr1581-fleet-validation-r13/evidence/`，不得复用 r12 或任何其他 run/attempt 的文件。

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 不新增 HTTP 响应。被验证的现有 `PUT/PATCH /api/acquisition/config` 继续沿用目标 PR 冻结合同：合法请求返回 `success=true`；合并后非法配置返回 HTTP 400、`success=false`、`error.code="INVALID_CONFIG"`，且不得持久化。

## 已知约束（来自回归测试）

- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts`（目标 SHA 内）→ 非法有效态零写入、合法部分/完整更新、已有与新租户并发串行化、双租户隔离。
- `apps/api/tests/routes/acquisition-dispatch.test.ts`（目标 SHA 内）→ `partial patch cannot make merged keyword bounds invalid`。
- `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` → Step 5b partial PUT 合并后边界校验、`INVALID_CONFIG` 与数据库 `3|5` 保持不变。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（404 HTML）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| **FR（做什么）** | 功能需求 | 在获准 US M4 对 PR #1581 精确 SHA 完成真实空库、真实登录的 provider-neutral 验证，并形成同 SHA 的 Evaluator 与 Independent Judge 新鲜双证据。 |
| **NFR（做得多好）** | 性能/可靠性 | 全流程 ≤7200 秒；runner digest 固定；旧证、缺证、SHA 漂移、机器/能力不符均 fail-closed。 |
| **Invariant（永不违反）** | 安全/一致性 | 不修改候选产品行为；不合并；不复用历史裁决；两个临时租户互不串；secret/cookie 不进日志或 git。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 证据时效 | 证据仅对本 run/attempt 与实际最终 SHA 有效；PR HEAD、attempt 或能力快照任一变化立即过期。 |
| **死亡告警（停了谁知道）** | 失效发现 | 任一脚本非零、7200 秒超时或 merge gate reasons 非空即由 Harness controller 标红；不得静默完成。 |
| **失败语义（挂了怎么办）** | 放行/重试/降级 | 一律拦截合并；保留 log_tail；针对新 HEAD/新 attempt 从头重跑，不降级到旧证据。 |
| **效果确认（已发≠已生效）** | 真实生效 | 真远端 PR ref、真目标提交 worktree、真空库 migration、真实 signup cookie、真 HTTP/DB 断言；最终双证据均绑定同一 SHA。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 本轮结果是否可合并 | A. 任一角色通过；B. Evaluator PASS 与 Independent Judge APPROVED 均新鲜且 SHA 完全一致 | B. 双裁决机械 AND 门 | PRD Golden Path 第 4 步明确要求 | 错误代码直接合并 |
| 证据是否为本轮新鲜产物 | A. 看文件名；B. 核对 run_id、attempt_id、produced_at、mtime 与 attempt_started_at | B. 身份与双时间信号 | 文件名可复制，历史文件可冒充 | 旧证据错误放行 |
| 实际机器是否获准 | A. 仅相信任务描述；B. 核对 Fleet attestation 的 provider/account/model/machine/snapshot/digest | B. 运行时 attestation | PRD 要求实际目标匹配能力快照 | 未授权机器结果被采信 |

`judgment-pending-user`：N/A — PRD 已明确拍板双裁决 AND 门、证据新鲜度和获准机器，不新增未确认判断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| PR HEAD 不等于固定 SHA | 立即非零退出，本 attempt 证据作废 | 是；新 SHA 需新 attempt | 禁止继续或复用旧证 |
| migration、真实登录或产品断言失败 | 非零退出并保留去敏日志 | attempt 级空库可从头重跑 | 禁止直接 INSERT 身份或注入 cookie |
| 任一裁决缺失/旧/非通过 | `merge_allowed=false` 且 reasons 非空 | 补齐同一 attempt 后重算 | 禁止单证放行 |
| Evaluator/Judge SHA 不一致 | 两份证据全部作废 | 对最终 PR HEAD 重跑两角色 | 禁止选择其中一份 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或用户输入接口；唯一外部输入为只读 Git ref 与 Fleet attestation，均按固定字面值比较。

## 真实调用方请求 shape

- 本 Sprint 不新增设备/agent→服务端协议。产品验证使用生产 Dashboard 同形请求：better-auth session 仅由真实 `POST /api/auth/sign-up/email` 创建并保存在临时 cookie jar；`PUT/PATCH /api/acquisition/config` 使用 `Cookie`、`Content-Type: application/json`，body 只含 `keywords_per_round_min`/`keywords_per_round_max`，不传 `tenant_id` 或 `X-Tenant-Id`。
- Harness 证据不是 HTTP 请求；其文件 schema 由本 Sprint `tests/fleet-validation-evidence.test.ts` 机械校验，Evaluator 与 Judge 均必须含顶层 `exit_code`、`log_tail`、`behavior_tests[]`。

## 禁 mock 边清单

- GitHub `refs/pull/1581/head` ↔ 实际候选 worktree：必须真 `git ls-remote` 与 detached worktree，禁止本地假 ref。
- 仓库 migration ↔ attempt 空 Postgres：必须在同一 `DB_URL` 运行真实 `npm run migrate` 并检查目标表，禁止预置 schema。
- better-auth signup/session ↔ acquisition route ↔ Postgres：必须真实 signup、cookie、HTTP 与 DB 读写，禁止 mock router、middleware、service 或 pool。
- Evaluator evidence ↔ Independent Judge evidence ↔ merge gate：必须读取两份独立新鲜文件并校验 SHA/时间/摘要，禁止 stub 任一裁决。
- 三份源证据 ↔ `scripts/recompute-merge-gate.mjs` ↔ `merge-gate.json`：门禁必须由脚本现场重算并记录三个源文件 SHA-256，禁止人工预制或直接信任已有 gate 文件。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] US M4 Fleet attestation ↔ 固定 PR ref/worktree：每次核对 provider/account/model/machine/snapshot/digest 与远端 PR HEAD；两次不一致判 FLAKY，真验前为 `logic-done-pending`。
- [接缝×2] 真实 signup cookie ↔ acquisition API ↔ attempt Postgres：两临时租户重复验证零写入与隔离；真验前为 `logic-done-pending`。
- [接缝×2] Evaluator ↔ Independent Judge ↔ merge gate：双证据必须独立新鲜且同 SHA；两次门禁结果不一致判 FLAKY，真验前为 `logic-done-pending`。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[接纳固定 PR/SHA 与获准机器] → [空库真实业务验证] → [产生双重独立新鲜裁决] → [同 SHA 机械门形成合并出口]

### Step 1: 接纳固定候选与获准 US M4
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1 步及 NFR runner digest。

**可观测行为**: 远端 PR #1581 HEAD 恰为固定 SHA；冻结基线是其祖先；运行时 attestation 逐字段匹配 capability snapshot。

**验证命令**:
```bash
npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "精确 PR HEAD 与冻结基线及获准 US M4 能力绑定" --reporter=verbose
```
**硬阈值**: 1/1 exit 0；repo/PR/base/final SHA、provider/account/model/machine/snapshot/digest 全部字面相等。

### Step 2: 在冻结基线之上的候选完成真实 provider-neutral 验证
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步与「边界情况」冻结合同产物缺失即失败。

**可观测行为**: 目标 SHA 的真实 migration 初始化空库；两个临时业务主体经 signup 获得 session；非法 effective-config 局部更新 400 `INVALID_CONFIG` 且 A/B 数据不变；同租户两次单独合法、组合非法的并发 PATCH 恰一成一拒并保持最终配置合法。

**验证命令**:
```bash
awk '/^## E2E 验收/{f=1;next} f&&/^## /{exit} f&&/^```bash/{b=1;next} b&&/^```/{exit} b{print}' sprints/08040114-kernel-pr1581-fleet-validation-r13/contract-draft.md > /tmp/kernel-pr1581-r13-e2e.sh && bash /tmp/kernel-pr1581-r13-e2e.sh
```
**硬阈值**: migration 与目标表检查 exit 0；真实 signup/login 双 tenant；顺序非法请求 2/2 拒绝且零写入；并发 statuses 恰为 `[200,400]`、最终 `min<=max`；真实 HTTP/DB 断言全部 exit 0；总耗时 ≤7200 秒。

### Step 3: Evaluator 与 Independent Judge 分别产生新鲜同 SHA 裁决
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步。

**可观测行为**: 两份不同角色证据均属于本 run/attempt，在 attempt 起点后 7200 秒内产生，均绑定固定最终 SHA 与当前 Fleet capability snapshot；Evaluator `PASS`，Judge `APPROVED`，每份均带真实 exit code/log_tail/behavior_tests。

**验证命令**:
```bash
npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "Evaluator 裁决|Independent Judge 裁决" --reporter=verbose
```
**硬阈值**: 2/2 exit 0；每份 run/attempt/provider/account/model/machine/snapshot/digest/final SHA 全匹配；`behavior_tests.length>=4` 且所有 exit_code=0；produced_at/mtime 新鲜；两份 `producer_execution_id` 不同；Judge 记录并精确匹配 Evaluator 文件真实 SHA-256。

### Step 4: 双证据机械 AND 门形成合并出口
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步及全部边界情况。

**可观测行为**: `scripts/recompute-merge-gate.mjs` 每次从 run-manifest、Evaluator、Judge 三个源文件重算并覆盖 `merge-gate.json`；仅当两份裁决通过、新鲜且 SHA 一致时 `merge_allowed=true`；任何缺证、旧证、漂移或能力不符时写出 reasons、非零退出并保持不可合并。输出必须记录三个源文件的真实 SHA-256，使修改源证据后旧 gate 无法继续放行。

**验证命令**:
```bash
npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts -t "机械合并门" --reporter=verbose
```
**硬阈值**: 正向重算 1/1 exit 0；`merge_allowed=true`、reasons=`[]`、Evaluator/Judge/gate 四处 final SHA 完全一致且 `source_sha256` 三项均为 64 位十六进制；SHA 漂移自测必须非零并输出 `merge_allowed=false` 与 `judge_final_sha_mismatch`；本角色与 Generator 均不得执行 merge。

### Step 5: 对历史证据与 SHA 漂移 fail-closed
**来源**: `[AI_ADDED]` — 将 PRD 边界情况转为可执行的负向 oracle，防止复制 r12 文件或只改文件名假绿。

**可观测行为**: 证据 run/attempt、produced_at/mtime、role、final SHA 任一不符即测试非零；远端 PR HEAD 漂移即 E2E 在产品测试前失败。

**验证命令**:
```bash
npx vitest run sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts --reporter=verbose
```
**硬阈值**: 正式证据 5/5 exit 0；缺任一必需文件或任一字段漂移时至少 1 test fail，禁止 404/skip/`|| true` 旁路。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet 必须注入本 attempt 的空 Postgres DB_URL}"
: "${HARNESS_MACHINE:?Fleet attestation 缺 machine}"
: "${HARNESS_PROVIDER:?Fleet attestation 缺 provider}"
: "${HARNESS_ACCOUNT:?Fleet attestation 缺 account}"
: "${HARNESS_MODEL:?Fleet attestation 缺 model}"
: "${HARNESS_RUNNER_DIGEST:?Fleet attestation 缺 runner digest}"
: "${CAPABILITY_SNAPSHOT_ID:?Fleet attestation 缺 capability snapshot id}"
export DB_URL
EXPECTED_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
BASE_SHA="676fed7de12023d355deac7849af8a525ae53f8d"
RUN_ID="a6e3ba3f-9856-4353-b05f-29f1049f7ca0"
ATTEMPT_ID="6b434554-d9c5-4a65-a31a-238eceb86d44"
SPRINT_DIR="sprints/08040114-kernel-pr1581-fleet-validation-r13"
ORIGIN_ROOT=$(git rev-parse --show-toplevel)
EVIDENCE_DIR="${HARNESS_EVIDENCE_DIR:-$ORIGIN_ROOT/$SPRINT_DIR/evidence}"
TMP_ROOT=$(mktemp -d)
CANDIDATE_DIR="$TMP_ROOT/candidate"
COOKIE_A="$TMP_ROOT/cookie-a.jar"
COOKIE_B="$TMP_ROOT/cookie-b.jar"
API_LOG="$TMP_ROOT/api.log"
API_PID=""
START_EPOCH=$(date +%s)
STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
cleanup() {
  set +e
  [ -z "$API_PID" ] || kill "$API_PID" 2>/dev/null
  [ -z "$API_PID" ] || wait "$API_PID" 2>/dev/null
  git -C "$ORIGIN_ROOT" worktree remove --force "$CANDIDATE_DIR" >/dev/null 2>&1
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT
[ "$HARNESS_MACHINE" = "us-mac-m4" ]
[ "$HARNESS_PROVIDER" = "codex" ]
[ "$HARNESS_ACCOUNT" = "team2" ]
[ "$HARNESS_MODEL" = "gpt-5.6-sol" ]
[ "$HARNESS_RUNNER_DIGEST" = "sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a" ]
[ "$CAPABILITY_SNAPSHOT_ID" = "bd824197-70a6-48b6-9a26-93b452ed001f" ]
REMOTE_SHA=$(git -C "$ORIGIN_ROOT" ls-remote origin refs/pull/1581/head | awk '{print $1}')
[ "$REMOTE_SHA" = "$EXPECTED_SHA" ] || { echo "FAIL: PR HEAD drift expected=$EXPECTED_SHA actual=$REMOTE_SHA"; exit 1; }
git -C "$ORIGIN_ROOT" fetch --no-tags origin refs/pull/1581/head
git -C "$ORIGIN_ROOT" cat-file -e "$EXPECTED_SHA^{commit}"
git -C "$ORIGIN_ROOT" merge-base --is-ancestor "$BASE_SHA" "$EXPECTED_SHA"
git -C "$ORIGIN_ROOT" worktree add --detach "$CANDIDATE_DIR" "$EXPECTED_SHA"
[ "$(git -C "$CANDIDATE_DIR" rev-parse HEAD)" = "$EXPECTED_SHA" ]
cd "$CANDIDATE_DIR"
npm ci
npm run product-map:check
export DATABASE_URL="$DB_URL"
export DATABASE_HOST="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')"
export DATABASE_PORT="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).port||"5432")')"
export DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))')"
export DATABASE_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')"
export DATABASE_PASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')"
npm run migrate --workspace=apps/api
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL" | grep -qx t
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.tenants') IS NOT NULL" | grep -qx t
npm run build --workspace=apps/api
export NODE_ENV=test
export PORT="${API_PORT:-35181}"
BASE_URL="http://127.0.0.1:$PORT"
export BETTER_AUTH_URL="$BASE_URL"
export BETTER_AUTH_SECRET
BETTER_AUTH_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
node apps/api/dist/index.js >"$API_LOG" 2>&1 &
API_PID=$!
for i in $(seq 1 60); do
  curl -sf "$BASE_URL/health" | jq -e '.status=="ok"' >/dev/null && break
  kill -0 "$API_PID" 2>/dev/null || { tail -60 "$API_LOG"; exit 1; }
  [ "$i" -lt 60 ] || { echo "FAIL: API 60s 未就绪"; tail -60 "$API_LOG"; exit 1; }
  sleep 1
done
EMAIL_A="harness-a-${RANDOM}-$(date +%s)@example.invalid"
EMAIL_B="harness-b-${RANDOM}-$(date +%s)@example.invalid"
curl -sfS -c "$COOKIE_A" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_A\",\"password\":\"Temporary-Aa1!\",\"name\":\"harness-a\"}" "$BASE_URL/api/auth/sign-up/email" >"$TMP_ROOT/signup-a.json"
curl -sfS -c "$COOKIE_B" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL_B\",\"password\":\"Temporary-Bb2!\",\"name\":\"harness-b\"}" "$BASE_URL/api/auth/sign-up/email" >"$TMP_ROOT/signup-b.json"
curl -sfS -b "$COOKIE_A" "$BASE_URL/api/account/me" >"$TMP_ROOT/me-a.json"
curl -sfS -b "$COOKIE_B" "$BASE_URL/api/account/me" >"$TMP_ROOT/me-b.json"
LICENSE_A=$(jq -er '.license.license_key' "$TMP_ROOT/me-a.json")
LICENSE_B=$(jq -er '.license.license_key' "$TMP_ROOT/me-b.json")
TENANT_A=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -v license="$LICENSE_A" -tAc "SELECT tenant_id FROM zenithjoy.licenses WHERE license_key=:'license'")
TENANT_B=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -v license="$LICENSE_B" -tAc "SELECT tenant_id FROM zenithjoy.licenses WHERE license_key=:'license'")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ "$TENANT_A" != "$TENANT_B" ]
CONFIG_URL="$BASE_URL/api/acquisition/config"
curl -sfS -b "$COOKIE_A" -H 'Content-Type: application/json' -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":3,"keywords_per_round_max":5}' | jq -e '.success==true and .data.keywords_per_round_min==3 and .data.keywords_per_round_max==5' >/dev/null
curl -sfS -b "$COOKIE_B" -H 'Content-Type: application/json' -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":2,"keywords_per_round_max":8}' | jq -e '.success==true and .data.keywords_per_round_min==2 and .data.keywords_per_round_max==8' >/dev/null
psql "$DB_URL" -v ta="$TENANT_A" -v tb="$TENANT_B" -Atc "SELECT tenant_id||'|'||keywords_per_round_min||'|'||keywords_per_round_max||'|'||updated_at FROM zenithjoy.acquisition_config WHERE tenant_id IN (:'ta',:'tb') ORDER BY tenant_id" >"$TMP_ROOT/before.txt"
CODE=$(curl -sS -b "$COOKIE_A" -o "$TMP_ROOT/invalid-put.json" -w '%{http_code}' -H 'Content-Type: application/json' -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":10}')
[ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' "$TMP_ROOT/invalid-put.json" >/dev/null
CODE=$(curl -sS -b "$COOKIE_A" -o "$TMP_ROOT/invalid-patch.json" -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$CONFIG_URL" -d '{"keywords_per_round_max":2}')
[ "$CODE" = 400 ] && jq -e '.success==false and .error.code=="INVALID_CONFIG" and (.error.message|type=="string")' "$TMP_ROOT/invalid-patch.json" >/dev/null
psql "$DB_URL" -v ta="$TENANT_A" -v tb="$TENANT_B" -Atc "SELECT tenant_id||'|'||keywords_per_round_min||'|'||keywords_per_round_max||'|'||updated_at FROM zenithjoy.acquisition_config WHERE tenant_id IN (:'ta',:'tb') ORDER BY tenant_id" >"$TMP_ROOT/after.txt"
diff -u "$TMP_ROOT/before.txt" "$TMP_ROOT/after.txt"
RECENT=$(psql "$DB_URL" -v ta="$TENANT_A" -v tb="$TENANT_B" -tAc "SELECT count(*) FROM zenithjoy.acquisition_config WHERE tenant_id IN (:'ta',:'tb') AND keywords_per_round_min <= keywords_per_round_max AND updated_at > NOW() - interval '5 minutes'")
[ "$RECENT" -eq 2 ]
curl -sfS -b "$COOKIE_A" -H 'Content-Type: application/json' -X PUT "$CONFIG_URL" -d '{"keywords_per_round_min":3,"keywords_per_round_max":10}' | jq -e '.success==true' >/dev/null
curl -sfS -b "$COOKIE_B" "$CONFIG_URL" | jq -S '.data' >"$TMP_ROOT/b-before-concurrency.json"
curl -sS -b "$COOKIE_A" -o "$TMP_ROOT/concurrent-min.json" -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$CONFIG_URL" -d '{"keywords_per_round_min":9}' >"$TMP_ROOT/concurrent-min.code" &
P1=$!
curl -sS -b "$COOKIE_A" -o "$TMP_ROOT/concurrent-max.json" -w '%{http_code}' -H 'Content-Type: application/json' -X PATCH "$CONFIG_URL" -d '{"keywords_per_round_max":8}' >"$TMP_ROOT/concurrent-max.code" &
P2=$!
wait "$P1"
wait "$P2"
STATUSES=$(printf '%s\n%s\n' "$(cat "$TMP_ROOT/concurrent-min.code")" "$(cat "$TMP_ROOT/concurrent-max.code")" | sort | paste -sd, -)
[ "$STATUSES" = "200,400" ] || { echo "FAIL: concurrent statuses=$STATUSES"; exit 1; }
if [ "$(cat "$TMP_ROOT/concurrent-min.code")" = 400 ]; then INVALID_BODY="$TMP_ROOT/concurrent-min.json"; else INVALID_BODY="$TMP_ROOT/concurrent-max.json"; fi
jq -e '.success==false and .error.code=="INVALID_CONFIG"' "$INVALID_BODY" >/dev/null
psql "$DB_URL" -v ta="$TENANT_A" -tAc "SELECT keywords_per_round_min <= keywords_per_round_max FROM zenithjoy.acquisition_config WHERE tenant_id=:'ta'" | grep -qx t
curl -sfS -b "$COOKIE_B" "$CONFIG_URL" | jq -S '.data' | diff -u "$TMP_ROOT/b-before-concurrency.json" -
mkdir -p "$EVIDENCE_DIR"
jq -n --arg run "$RUN_ID" --arg attempt "$ATTEMPT_ID" --arg started "$STARTED_AT" --arg sha "$EXPECTED_SHA" --arg base "$BASE_SHA" --arg snapshot "$CAPABILITY_SNAPSHOT_ID" --arg digest "$HARNESS_RUNNER_DIGEST" '{run_id:$run,attempt_id:$attempt,attempt_started_at:$started,repo:"perfectuser21/zenithjoy-workspace",pr_number:1581,frozen_base_sha:$base,requested_final_sha:$sha,actual_final_sha:$sha,provider:"codex",account:"team2",model:"gpt-5.6-sol",machine:"us-mac-m4",capability_snapshot_id:$snapshot,runner_digest:$digest}' >"$EVIDENCE_DIR/run-manifest.json"
ELAPSED=$(( $(date +%s) - START_EPOCH ))
[ "$ELAPSED" -le 7200 ] || { echo "FAIL: elapsed=${ELAPSED}s > 7200s"; exit 1; }
echo "OK: PR #1581 exact SHA real fleet product validation passed elapsed=${ELAPSED}s"
```

通过标准：唯一 Fleet 数据资源为本 attempt `DB_URL`；真实 migration→真实 signup/session→双租户 HTTP/DB 顺序零写入与并发一成一拒全绿；不直接 INSERT 业务身份，不预注入 cookie/tenant；attestation 与远端 SHA 精确匹配；总耗时 ≤7200 秒。脚本仅生成真实运行清单，不伪造 Evaluator/Judge verdict。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 把任一 evidence 的 `run_id`、`attempt_id`、`role` 或 `final_sha` 改 1 字符，确认门禁非零。
- 重复提交: 同一 attempt 重算 merge gate 两次，输出必须相同且不得复制旧 produced_at 冒充新裁决。
- 中途中断: Evaluator 完成后、Judge 前中断，确认 `merge_allowed` 不存在或为 false。
- 边界值: PR HEAD 在 E2E 前后各读取一次；若期间变化，确认本轮证据作废而非选择旧 SHA。
发现分级: P0/P1（旧证/错 SHA/单证放行或产品不变量破坏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 与候选绑定 | `sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts` | 精确 PR HEAD 与冻结基线及获准 US M4 能力绑定 | `run-manifest.json` 缺失，真实解释器报 ENOENT |
| Evaluator 新鲜证据 | `sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts` | Evaluator 裁决为本 attempt 新鲜 PASS 且绑定精确最终 SHA | evaluator evidence 缺失，真实解释器报 ENOENT |
| Judge 独立新鲜证据 | `sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts` | Independent Judge 裁决独立新鲜 APPROVED 且绑定同一最终 SHA | judge evidence 缺失，真实解释器报 ENOENT |
| 合并机械门 | `sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts` | 机械合并门仅在双裁决新鲜且 SHA 一致时放行 | merge gate 缺失，真实解释器报 ENOENT |
| 合并门负向重算 | `sprints/08040114-kernel-pr1581-fleet-validation-r13/tests/fleet-validation-evidence.test.ts` | 机械合并门重算会拒绝 SHA 漂移且留下不可合并原因 | 重算器缺失，真实解释器报 MODULE_NOT_FOUND |
