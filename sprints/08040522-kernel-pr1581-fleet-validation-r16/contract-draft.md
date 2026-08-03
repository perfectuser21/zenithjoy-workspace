# Sprint Contract Draft (Round 2)

## Notes

- 本轮只修 Round 1 Reviewer 的四项阻塞：空 Postgres 自举、非零检查 fail-closed、三角色独立 Runner 路由 attestation、精确命令与 stable check ID；不扩大 PRD 范围。
- `contract-gate: skipped (file not found, third-party repo)`。
- PRD 的 `step_id=line02/keyword_acquisition#step7` 仍作为父路覆盖声明；本 Sprint 只验 PR、禁止修改该 GP smoke file，因此 CI 声明使用 `keep-green`，不虚报推进业务步骤。
- api/db/test registry 已读取；本 Sprint 不新增 HTTP response/schema，证据 JSON 是 `[NEW_PATTERN]`，PR #1581 的产品端点格式继续由冻结目标头原合同约束。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（HTTP 404）。
- `npm run product-map:check` 首次因 workspace 缺 `ajv` exit 1，已执行锁文件对应的 `npm ci`；环境未就绪不记 PASS。
- `GAN authoring identity` 只记录本轮作者 provenance。Generator、Evaluator、Judge 必须各自 late-bind Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，禁止固化或共用本 proposer 的 attempt/account/snapshot。

## Response Schema（推导来源: PRD字面 + NEW_PATTERN）

N/A — 本 Sprint 不新增 HTTP 响应或 DB schema。验收对象为 Runner 生成的证据 JSON：

- `run-manifest.json`：冻结 `run_id/repo/pr_number/target_head_sha/strict_machine/runner_digest/started_at`，不得含未来角色 identity。
- `routing-<role>.json`：每个角色一份独立 Runner attestation，含 `role/run_id/attempt_id/capability_snapshot_id/from_target/to_target/fallback_reason/failure_class/runner_digest/receipt_id/issued_at`。
- `<role>.json`：含 `role/run_id/target_head_sha/provenance/routing_attestation_sha256/created_at/exit_code/log_tail`；Generator/Evaluator 另含 `checks[]`，Judge 另含摘要链、`verdict/verdict_at/behavior_tests[]`。
- 每个 `checks[]` 项固定含 `check_id/command/exit_code/log_tail`；Judge 每个行为项固定含 `check_id/verification_level/exit_code/log_tail/evidence`。

## 已知约束（来自回归测试）

- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → 真 Router/Service/Postgres 验非法零写入、合法更新、并发串行和双租户隔离。
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid` 是共享 Red fixture，只能执行不得修改。
- `apps/api/db/migrations/run-migration.ts` → `DATABASE_URL` 优先、migration 按文件排序、任一步失败整体 exit 1。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（HTTP 404）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 在严格 `us-mac-m4` Fleet 路由上依次生成 PR #1581 精确头的全新 Generator、Evaluator、Judge 证据和 verdict。 |
| NFR（做得多好） | 性能/可靠性 | 全链 ≤7200s；runner digest 精确匹配；每个角色有独立 routing receipt；五个必跑 check ID 与命令不可漂移。 |
| Invariant（永不违反） | 安全/一致性 | 不改 PR 产品实现/共享 Red，不读历史 candidate，不提前 merge；任一必跑检查非零时 verdict 禁止 PASS。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 证据有效期 | 仅对本 run 与目标头有效；PR head 变化立即作废并整链重跑。 |
| 死亡告警（停了谁知道） | 故障发现 | Fleet/bridge/DB/test 任一非零进入 evidence log_tail 与 Judge verdict，Harness 报 FAIL/BLOCKED。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | fail-closed；恢复原严格目标后以三个新 attempts 重跑，禁止换路由或复用 r15。 |
| 效果确认（已发≠已生效） | 回执 | 三份独立 Runner attestation + 精确命令结果 + SHA-256 证据链 + GitHub mergedAt/verdict_at 时序。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 每个角色是否命中自己的严格 Fleet 目标 | A. 看任务文字；B. Runner 独立 attestation 绑定该角色 attempt/capability 且 from_target=to_target | B | PRD 禁止换机器或账号；角色 account 可独立，不能把作者 identity 固化为验收 identity | 错环境假绿并形成错误 merge 决策 |
| ⚠️ 三方证据是否同 run/同 head 且全新 | A. 文件名；B. 独立 receipt、时间序列和 SHA-256 摘要链 | B | 文件名可复制，独立 Runner receipt 与摘要链可机检 | 历史证据冒充本轮证据 |
| ⚠️ 非零检查如何映射 verdict | A. 只看 Judge 文本；B. exact check set 中任一非零强制 verdict≠PASS | B | 直接消除失败降级成功 | 缺测试/DB 失败却被合并 |
| ⚠️ verdict 前是否未合并 | A. 只看当前 state；B. 各阶段 capture 与 `mergedAt/verdict_at` 时序 | B | verdict 后可能合法改变 state | 提前 merge 违规被漏报 |

judgment-pending-user: 上述判定均由 PRD/Reviewer 已明确，本合同仅机械固化，无新增产品判断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| Fleet/bridge/strict target 不可用 | 记录非零与 failure_class，流程 FAIL/BLOCKED | 恢复后以新 attempts 整链重跑 | 禁止换机器/账号 |
| 空库 migration 或任一必跑测试非零 | 原 exit_code/log_tail 留证，Judge verdict 禁止 PASS | 修复环境/代码后整链重跑 | 禁止 warning 或空检查集 |
| PR head/证据摘要错配 | 当前证据全部作废 | 对新 head 完整重跑 | 禁止局部补证 |
| verdict 前 PR 已合并 | 标流程违规并停止合格判定 | 否 | 无降级 |

### 输入对抗面

N/A：不新增对外 agent。证据 validator 仍须拒绝缺字段、额外/重复 check ID、命令漂移、route 降级、摘要错配和非法 verdict。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

## 真实调用方请求 shape

- Fleet Runner 给每个未来角色注入其自己的 `HARNESS_ATTEMPT_ID/HARNESS_PROVIDER/HARNESS_ACCOUNT/HARNESS_MACHINE/HARNESS_MODEL/HARNESS_RUNNER_DIGEST/CAPABILITY_SNAPSHOT_ID`；角色 evidence 的 `provenance` 逐字段取这些运行时值。
- Runner 同步生成该角色不可复用的 `routing-<role>.json`；`attempt_id/capability_snapshot_id` 必须匹配该角色 provenance，`from_target` 与 `to_target` 的 provider/account/machine/model 逐字段相等，`to_target.machine=us-mac-m4`，receipt ID 三角色互异。
- Evaluator 仅以 `generator_evidence_sha256` 引用输入；Judge 引用 Generator/Evaluator 两个现场摘要。三个角色不得共用 attempt/account/capability snapshot，也不得写入本轮 Proposer UUID。

## Risks 与 mitigation

| Risk | 影响 | Mitigation / 验收闸 |
|---|---|---|
| 空 DB 未建 schema | 真 Postgres 测试以缺表失败，或误连旧库假绿 | 每个执行角色仅接收 attempt-scoped `DB_URL`；先跑仓库 migration 并机检目标表。 |
| check 存在非零但 Judge 给 PASS | 失败被降级成功 | Generator/Evaluator exact check set + validator 的 `PASS => 所有 exit_code=0` 硬蕴含。 |
| 只证明一个角色路由正确 | 其他角色可 fallback | 每角色独立 Runner attestation、独立 receipt/attempt/capability，分别校验 from/to。 |
| 检查名称相似但命令被缩减 | 漏跑关键测试 | stable check ID 到完整 command 的 1:1 常量映射，缺项/重复/命令一字符漂移均 FAIL。 |

## 禁 mock 边清单

- Fleet dispatcher/transport ↔ 三个 `us-mac-m4` Runner：每角色必须有真实独立 route attestation，禁止本地/fake runner。
- Runner runtime identity ↔ role evidence：必须从该角色运行时变量写入并与 attestation 互相绑定。
- PR #1581 checkout ↔ Router/Service/Postgres：必须真 migration、真 Postgres、真目标测试，禁止 mock 被改边。
- Generator evidence ↔ Evaluator 摘要 ↔ Judge 摘要：现场 SHA-256，禁止预填。
- GitHub PR head/state/mergedAt ↔ verdict：真查 GitHub，禁止 fixture 响应。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] Fleet transport → 三角色 Runner attestation：三个角色分别真派发；任一 receipt/fallback/target 不符即 FAIL。
- [接缝×2] attempt-scoped 空 Postgres → migration → PR 原集成测试：Generator/Evaluator 各自从空库重复一次。
- [接缝×2] GitHub head/state → 证据摘要链 → Judge verdict：head 变化、提前 merge 或摘要错配均使整链失效。

## 必跑检查注册表（stable check ID → 精确命令）

Generator 与 Evaluator 各自必须执行下列五项；`command` 必须逐字写入 evidence，禁止别名、缩短或只记测试文件名。

- `product-map-contract`
  ```bash
  npm run product-map:check
  ```
- `db-empty-bootstrap`
  ```bash
  DATABASE_URL="$DB_URL" npm run migrate --workspace=apps/api && psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL" | grep -qx t
  ```
- `effective-config-integration`
  ```bash
  DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose
  ```
- `shared-red-smoke`
  ```bash
  npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
  ```
- `fixture-unchanged`
  ```bash
  git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts
  ```

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[冻结 PR 精确头] → [Generator 严格路由与空库真验] → [Evaluator 独立复验] → [Judge fail-closed verdict] → [未提前 merge 的可决策出口]

### Step 1: 锁定 PR 精确头与每角色严格路由
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步及 Fleet 不可用边界。

**可观测行为**: GitHub head 精确匹配；每个角色独立 attestation 均显示 from_target=to_target、machine=`us-mac-m4`、无 fallback/failure。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .state=="OPEN"'
```
**硬阈值**: head 逐字匹配；verdict 前 state=OPEN；三份 receipt ID 唯一。上述命令及最终 validator 任一非零即 FAIL。

### Step 2: Generator 从空库生成全新真实证据
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步；`[AI_ADDED]` — Reviewer 要求在 attempt 空库先执行真实 schema bootstrap。

**可观测行为**: Generator 使用本角色 DB_URL 运行 migration，目标表存在；五个 stable check ID 各执行一次并保存完整命令、真实 exit_code/log_tail。

**验证命令**:
```bash
DATABASE_URL="${DB_URL:?}" npm run migrate --workspace=apps/api && psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL" | grep -qx t
DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose
```
**硬阈值**: migration 与目标表检查 exit 0；集成测试 7/7 pass；证据的五个 check IDs/commands 精确匹配 validator 常量。

### Step 3: Evaluator 在独立 Runner/空库复验同一头
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与禁止复用 r15。

**可观测行为**: Evaluator 使用自己的 attempt/capability/receipt 与空 DB 重跑同一五项检查，并引用 Generator 文件现场 SHA-256。

**验证命令**:
```bash
bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence"; G=$(shasum -a 256 "$D/generator.json"|awk "{print \\$1}"); jq -e --arg g "$G" '\''(.generator_evidence_sha256==$g) and (.checks|length==5)'\'' "$D/evaluator.json"'
```
**硬阈值**: Generator/Evaluator attempt、capability、receipt 均不同；Evaluator exact checks 5/5 留证；摘要匹配。

### Step 4: Judge 独立路由并按失败语义给 verdict
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 4 步与失败不得降级成功。

**可观测行为**: Judge 使用自己的 runtime provenance/route receipt，只引用本 run 两份摘要；任一 Generator/Evaluator 顶层或必跑 check 非零时 verdict 不得 PASS。

**验证命令**:
```bash
bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json; node "$D/tests/validate-fleet-evidence.mjs" "$D/evidence" /tmp/pr1581-final.json'
```
**硬阈值**: validator exit 0；Judge stable behavior check IDs 恰为四项；`verdict=PASS` 蕴含所有 Generator/Evaluator/Judge checks exit 0。

### Step 5: verdict 前未合并并输出可追溯结论
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 5 步及提前 merge 边界。

**可观测行为**: Judge capture 记录 OPEN/null；当前 head 未变化；若 verdict 后发生 merge，`mergedAt>=verdict_at`；PASS/FAIL/BLOCKED 原样输出。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"'
```
**硬阈值**: 固定 head；verdict 前未 merge；全链 ≤7200s；最终 validator 非零即不可形成合格验证。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（Fleet 将实际脚本严格派发到 `us-mac-m4`）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped empty Postgres DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current Judge attempt}"
: "${HARNESS_PROVIDER:?}"
: "${HARNESS_ACCOUNT:?}"
: "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"
: "${CAPABILITY_SNAPSHOT_ID:?}"
SPRINT_DIR="${SPRINT_DIR:-sprints/08040522-kernel-pr1581-fleet-validation-r16}"
EVIDENCE_DIR="$SPRINT_DIR/evidence"
TARGET_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
EXPECTED_DIGEST="sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a"
API_PORT="${API_PORT:-33181}"
BASE_URL="http://127.0.0.1:${API_PORT}"
COOKIE_A=$(mktemp)
COOKIE_B=$(mktemp)
SIGNUP_A=$(mktemp)
SIGNUP_B=$(mktemp)
PR_JSON=$(mktemp)
APP_PID=""
START=$(date +%s)
cleanup() { [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true; rm -f "$COOKIE_A" "$COOKIE_B" "$SIGNUP_A" "$SIGNUP_B" "$PR_JSON"; }
trap cleanup EXIT
command -v gh >/dev/null && command -v jq >/dev/null && command -v psql >/dev/null && command -v node >/dev/null || { echo "FAIL: 缺 gh/jq/psql/node"; exit 1; }
[ "$HARNESS_MACHINE" = "us-mac-m4" ] || { echo "FAIL: Judge target machine mismatch"; exit 1; }
[ "$HARNESS_RUNNER_DIGEST" = "$EXPECTED_DIGEST" ] || { echo "FAIL: runner digest mismatch"; exit 1; }

# 空库真实 bootstrap；不得复制生产 schema/data。
export DATABASE_URL="$DB_URL"
npm run migrate --workspace=apps/api
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL" | grep -qx t

# connection.ts 使用离散变量，全部从同一个 DB_URL 推导。
export DATABASE_HOST="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')"
export DATABASE_PORT="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).port||"5432")')"
export DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))')"
export DATABASE_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')"
export DATABASE_PASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')"
export PORT="$API_PORT"
export BETTER_AUTH_URL="$BASE_URL"
export BETTER_AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
unset VITEST
node_modules/.bin/ts-node --transpile-only --project apps/api/tsconfig.json -e "import app from './apps/api/src/app'; app.listen(Number(process.env.PORT), '127.0.0.1');" >/tmp/kernel-r16-api.log 2>&1 &
APP_PID=$!
for i in $(seq 1 60); do curl -fsS "$BASE_URL/health" >/dev/null && break; kill -0 "$APP_PID" 2>/dev/null || { tail -40 /tmp/kernel-r16-api.log; exit 1; }; [ "$i" -lt 60 ] || { echo "FAIL: API 未就绪"; exit 1; }; sleep 1; done

# 真实 signup 自动创建两个隔离 tenant；cookie 仅存临时 jar，不预注入业务身份。
EMAIL_A="harness-a-${RANDOM}-$(date +%s)@example.invalid"
EMAIL_B="harness-b-${RANDOM}-$(date +%s)@example.invalid"
curl -fsS -c "$COOKIE_A" -H 'content-type: application/json' -d "{\"name\":\"Harness A\",\"email\":\"$EMAIL_A\",\"password\":\"temporary-Aa1!\"}" "$BASE_URL/api/auth/sign-up/email" > "$SIGNUP_A"
curl -fsS -c "$COOKIE_B" -H 'content-type: application/json' -d "{\"name\":\"Harness B\",\"email\":\"$EMAIL_B\",\"password\":\"temporary-Bb2!\"}" "$BASE_URL/api/auth/sign-up/email" > "$SIGNUP_B"
USER_A=$(jq -er '.user.id' "$SIGNUP_A")
USER_B=$(jq -er '.user.id' "$SIGNUP_B")
TENANT_A=$(psql "$DB_URL" -v uid="$USER_A" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'uid' LIMIT 1")
TENANT_B=$(psql "$DB_URL" -v uid="$USER_B" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'uid' LIMIT 1")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ "$TENANT_A" != "$TENANT_B" ] || { echo "FAIL: signup tenant bootstrap failed"; exit 1; }
curl -fsS -b "$COOKIE_A" -H 'content-type: application/json' -X PUT -d '{"keywords_per_round_min":5,"keywords_per_round_max":10}' "$BASE_URL/api/acquisition/config" | jq -e '.success==true and .data.keywords_per_round_min==5 and .data.keywords_per_round_max==10' >/dev/null
curl -fsS -b "$COOKIE_B" -H 'content-type: application/json' -X PUT -d '{"keywords_per_round_min":2,"keywords_per_round_max":8}' "$BASE_URL/api/acquisition/config" | jq -e '.success==true and .data.keywords_per_round_min==2 and .data.keywords_per_round_max==8' >/dev/null

# PR #1581 必跑检查；命令与 stable IDs 的常量映射由 validator 再核对。
npm run product-map:check
DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose
npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
git diff --exit-code "$TARGET_SHA" -- apps/api/tests/routes/acquisition-dispatch.test.ts

for f in run-manifest.json routing-generator.json routing-evaluator.json routing-judge.json generator.json evaluator.json judge.json; do [ -s "$EVIDENCE_DIR/$f" ] && jq -e . "$EVIDENCE_DIR/$f" >/dev/null || { echo "FAIL: missing/invalid evidence $f"; exit 1; }; done
jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg c "$CAPABILITY_SNAPSHOT_ID" --arg p "$HARNESS_PROVIDER" --arg ac "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg mo "$HARNESS_MODEL" --arg d "$EXPECTED_DIGEST" '.attempt_id==$a and .capability_snapshot_id==$c and .from_target.provider==$p and .from_target.account==$ac and .from_target.machine==$m and .from_target.model==$mo and .from_target==.to_target and .runner_digest==$d' "$EVIDENCE_DIR/routing-judge.json" >/dev/null
jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg c "$CAPABILITY_SNAPSHOT_ID" --arg p "$HARNESS_PROVIDER" --arg ac "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg mo "$HARNESS_MODEL" '.provenance.attempt_id==$a and .provenance.capability_snapshot_id==$c and .provenance.provider==$p and .provenance.account==$ac and .provenance.machine==$m and .provenance.model==$mo' "$EVIDENCE_DIR/judge.json" >/dev/null
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > "$PR_JSON"
node "$SPRINT_DIR/tests/validate-fleet-evidence.mjs" "$EVIDENCE_DIR" "$PR_JSON"
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 7200 ] || { echo "FAIL: E2E 超过 7200s"; exit 1; }
echo "OK: strict Fleet evidence chain verified elapsed=${ELAPSED}s"
```

通过标准：空库 migration/目标表、真实 signup 双 tenant/cookie、五项必跑检查、三份独立 Runner attestation、摘要链与 merge 时序均通过；任何非零均传播失败，Judge PASS 不得覆盖非零检查。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 删除 route attempt/capability、修改目标 SHA 一位、伪造未知 check ID 或 verdict。
- 重复提交: 复用同一 routing receipt 或旧 evidence，确认唯一性/时间/摘要链拒绝。
- 中途中断: migration、Generator 后、Evaluator 后分别中断 DB/Fleet，确认缺证/非零不能 PASS。
- 边界值: check 数量正确但 command 漂移；PR 在 Evaluator 与 Judge 间变 head/merge；Judge behavior exit 非零。
发现分级: P0/P1（错路由、错 SHA、历史证据、非零映射 PASS、提前 merge）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| 独立路由证明 | `三角色均有独立 Runner 路由 attestation` | `tests/fleet-validation.test.ts` | routing/evidence 尚未生成，读文件失败 |
| 精确必跑检查 | `Generator 与 Evaluator 固化相同 stable check ID 和精确命令` | `tests/fleet-validation.test.ts` | evidence 尚无 exact check set |
| 失败语义 | `任一非零必跑检查均不得映射为 PASS` | `tests/fleet-validation.test.ts` | Judge evidence 尚未生成 |
| 摘要与 merge 时序 | `摘要链、目标头与 verdict 前未合并保持一致` | `tests/fleet-validation.test.ts` | 三角色摘要链尚不存在 |
