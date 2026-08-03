# Sprint Contract Draft (Round 3)

## Notes

- 本轮仅修 Round 2 的两个阻塞：所有产品检查必须在 detached `c305f6217da65bb69413c39e621b7e797e0fb189` worktree 内执行；证据新鲜度改由 Fleet 签名的 start/completion 双 attestation 证明。
- `GAN authoring identity` 只作本轮作者 provenance。未来 Generator、Evaluator、Judge 均 late-bind 自己的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，不得使用本 Proposer/Reviewer 的 UUID、account 或 snapshot。
- `contract-gate: skipped (file not found, third-party repo)`；api registry 可达但 stale，db/test registry 无本任务更强约束，按 PRD 与目标头现有测试字面定义。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（HTTP 404）。
- 本合同不要求角色自己签名：Fleet worker 在角色进程外用 Runner 私钥生成 receipt；角色只读公钥与已签名 receipt。私钥不得挂载到角色容器。

## Response Schema（推导来源: PRD字面 + NEW_PATTERN）

N/A — 不新增产品 HTTP/DB schema。证据合同如下：

- `runner-start-<role>.json/.sig`：Fleet 在启动角色前签名，含 `issuer/dispatch_id/role/run_id/attempt_id/capability_snapshot_id/from_target/to_target/machine/runner_digest/target_head_sha/started_at`。
- `<role>.json`：角色运行结果；provenance 从自身 `HARNESS_*` late-bind；Generator/Evaluator 的 `checks[]` 每项含 `check_id/command/executed_head_sha/started_at/finished_at/exit_code/log_tail`。
- `runner-complete-<role>.json/.sig`：Fleet supervisor 在角色退出后签名，含 start 同一身份、`observed_head_sha/pr_head_sha/pr_state/pr_merged_at/evidence_sha256/completed_at/exit_code`；Generator/Evaluator 另含 supervisor 实际执行捕获的 `checks[]`，Judge 含捕获的 `behavior_tests[]`。
- `judge.json`：另含 `generator_evidence_sha256/evaluator_evidence_sha256/verdict/verdict_at/behavior_tests[]`；行为项含 `check_id/verification_level/exit_code/log_tail/evidence`。

## 已知约束（来自回归测试）

- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → 真 Router/Service/Postgres 覆盖非法零写入、合法更新、并发与双租户隔离。
- `apps/api/tests/routes/acquisition-dispatch.test.ts` → `partial patch cannot make merged keyword bounds invalid` 是共享 Red fixture，只执行、不修改。
- `apps/api/db/migrations/run-migration.ts` → `DATABASE_URL` 优先，migration 任一步失败整体非零。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（HTTP 404）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 在严格 `us-mac-m4` Fleet 上为 PR #1581 精确头生成全新 Generator、Evaluator、Judge 证据及 verdict。 |
| NFR（做得多好） | 性能/可靠性 | 全链 ≤7200s；runner digest 精确匹配；每角色独立签名 start/completion receipt；必跑命令不可漂移。 |
| Invariant（永不违反） | 安全/一致性 | 不改目标实现/共享 Red，不读历史 candidate，不提前 merge；非零检查禁止 PASS。 |
| 判定点（怎么知道） | 模糊现实判断 | 见登记表。 |
| 保质期（何时过期） | 证据有效期 | 仅对本 run 与目标头有效；head 改变立即整链作废。 |
| 死亡告警（停了谁知道） | 故障发现 | Fleet/bridge/DB/test/signature 任一失败写 log_tail 并使 verdict FAIL/BLOCKED。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | fail-closed；恢复严格目标后用三个新 dispatch 重跑，禁止 fallback。 |
| 效果确认（已发≠已生效） | 回执 | Fleet 双签名时间窗 + completion 绑定 evidence SHA-256 + GitHub merge/verdict 时序。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 角色是否真在严格目标执行 | A. 角色自报；B. Fleet 外部签名 start/completion，from_target=to_target | B | 角色自写 JSON 可伪造，Fleet 私钥不进入角色环境 | 错机器/账号假绿 |
| ⚠️ 检查是否真在 c305f621 执行 | A. 合同分支跑命令；B. detached target worktree + 每项记录 executed_head_sha + completion 观察 head | B | 消除上一轮在合同分支执行的歧义 | 测到错误代码 |
| ⚠️ 证据是否本次新生成 | A. 文件时间；B. 签名 started/completed 窗口与 evidence digest | B | 文件时间可改，签名 receipt 不可由角色重造 | 历史证据冒充 |
| ⚠️ 非零如何映射 verdict | A. Judge 文本；B. exact checks 任一非零强制 verdict≠PASS | B | 失败语义可机检 | 失败被降级成功 |

judgment-pending-user: 上述判定均由 PRD 与 Round 2 Reviewer 明确，无新增产品判断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| Fleet 签名 receipt 缺失/无效 | FAIL/BLOCKED，证据不采信 | 新 dispatch 整链重跑 | 禁止角色自签或只看 mtime |
| target checkout、migration 或测试非零 | 原 exit/log 留证，禁止 PASS | 修复后新 dispatch 重跑 | 禁止在合同分支补跑 |
| head/摘要/签名时间窗错配 | 当前证据全作废 | 对新 head 完整重跑 | 禁止局部补证 |
| verdict 前已 merge | 流程违规并停止合格判定 | 否 | 无降级 |

### 输入对抗面

N/A：不新增对外 agent。validator 必须拒绝签名无效、路径/SHA/时间窗/命令漂移、重复 check ID、fallback 与非法 PASS。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

## 真实调用方请求 shape

- Fleet worker 给每角色注入自己的 `HARNESS_ATTEMPT_ID/HARNESS_PROVIDER/HARNESS_ACCOUNT/HARNESS_MACHINE/HARNESS_MODEL/HARNESS_RUNNER_DIGEST/CAPABILITY_SNAPSHOT_ID`；角色 evidence provenance 逐字段读取，禁止 UUID 字面值。
- Fleet worker 在角色进程外生成 start/completion JSON 并签名；`from_target/to_target` 逐字段相同；Fleet supervisor 执行 exact commands 并将捕获的 checks 写进 completion，completion 同时绑定 role evidence SHA-256、真实 observed head 与 GitHub PR state。
- Evaluator 以现场 SHA-256 引用 Generator；Judge 分别引用 Generator/Evaluator。三个 dispatch/attempt/capability 必须互异，不要求共用 account/snapshot。

## Risks 与 mitigation

| Risk | 影响 | Mitigation / 验收闸 |
|---|---|---|
| 在合同 HEAD 跑 PR 检查 | c305 的改动实际未执行 | 每角色 `git worktree add --detach <tmp> c305...`；Fleet supervisor 在该 worktree 执行并签名完整 checks，validator 逐项对比 role evidence。 |
| 角色自写 receipt/时间 | 旧证据可伪装新鲜 | Fleet 私钥不挂载；start/completion 两份 detached signature；completion 绑定 evidence digest。 |
| 空 DB 未建 schema | 真 PG 测试失败或误连旧库 | 只接收 attempt-scoped `DB_URL`，目标 worktree 内真实 migration 并机检表。 |
| 非零被 Judge 写成 PASS | 错误 merge 决策 | exact check set + `PASS => 全部 exit_code=0`。 |

## 禁 mock 边清单

- Fleet dispatcher/transport ↔ `us-mac-m4` Runner：必须真实派发并由 Fleet 外部私钥签双 receipt。
- Runner ↔ detached c305 worktree：Fleet supervisor 必须在该目录执行 exact checks，completion 签名实际 command/head/exit/log/time 并逐项绑定 role evidence。
- PR Router/Service ↔ attempt-scoped Postgres：真 migration、真相邻模块、真 Postgres，禁止 mock。
- Generator evidence ↔ Evaluator ↔ Judge：现场 SHA-256 串联，禁止预填。
- GitHub PR head/state/mergedAt ↔ verdict：真查 GitHub，禁止 fixture。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] Fleet transport → Runner 双签名 receipt：每角色独立派发；签名/route/head 任一不符即 FAIL。
- [接缝×2] detached c305 worktree → migration → Router/Service/Postgres：Generator 与 Evaluator 各自空库重复。
- [接缝×2] GitHub state → evidence digest chain → Judge verdict：head 变化、提前 merge 或摘要错配均作废。

## 必跑检查注册表

Generator 与 Evaluator都必须从自己的 detached target worktree 根目录执行以下五项，`command` 逐字记录：

| check_id | command | 硬阈值 |
|---|---|---|
| checkout-head | `git rev-parse HEAD` | stdout 精确为 `c305f6217da65bb69413c39e621b7e797e0fb189` |
| product-map-contract | `npm run product-map:check` | exit 0 |
| db-empty-bootstrap | `DATABASE_URL="$DB_URL" npm run migrate --workspace=apps/api && psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL" \| grep -qx t` | exit 0、目标表存在 |
| effective-config-integration | `DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose` | exit 0、7/7 pass |
| shared-red-smoke | `git diff --exit-code c305f6217da65bb69413c39e621b7e797e0fb189 -- apps/api/tests/routes/acquisition-dispatch.test.ts && npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose` | fixture diff 空、1/1 pass |

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[冻结 PR 精确头] → [Generator 签名派发并在 c305 真验] → [Evaluator 独立签名复验] → [Judge 签名 fail-closed verdict] → [未提前 merge 的出口]

### Step 1: Fleet 锁定目标并签发开始 receipt
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步与严格路由边界；`[AI_ADDED]` — Round 2 Reviewer 要求可信 Runner attestation。

**可观测行为**: 每个角色收到独立、签名有效的 start receipt；GitHub head 为 c305，PR 为 OPEN。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .state=="OPEN"'
```
**硬阈值**: 三个 dispatch 独立、签名有效、from_target=to_target、machine=us-mac-m4；上述命令 exit 0。

### Step 2: Generator 在 detached c305 空库真验
**来源**: `[FROM_PRD]` — PRD 第 2 步；`[AI_ADDED]` — 固定真实 checkout 与空库防伪。

**可观测行为**: worktree HEAD 精确等于 c305；migration + 五项 exact checks 完成；Fleet completion 签名绑定 evidence digest。

**验证命令**:
```bash
TARGET_WT=$(mktemp -d); rmdir "$TARGET_WT"; git worktree add --detach "$TARGET_WT" c305f6217da65bb69413c39e621b7e797e0fb189; test "$(git -C "$TARGET_WT" rev-parse HEAD)" = c305f6217da65bb69413c39e621b7e797e0fb189
```
**硬阈值**: checkout-head 精确相等；五项 check ID 各一次；completion signature/摘要有效；任一非零不允许 PASS。

### Step 3: Evaluator 独立复验同一目标头
**来源**: `[FROM_PRD]` — PRD 第 3 步与历史 r15 不得复用。

**可观测行为**: 新 dispatch/attempt/capability、新 detached worktree、新空库，重跑相同 exact checks；现场引用 Generator digest。

**验证命令**:
```bash
node sprints/08040522-kernel-pr1581-fleet-validation-r16/tests/validate-fleet-evidence.mjs sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"
```
**硬阈值**: 与 Generator dispatch/attempt/capability 不同；每项 executed_head_sha=c305；摘要匹配；validator exit 0。

### Step 4: Judge 只按本 run 签名证据给 verdict
**来源**: `[FROM_PRD]` — PRD 第 4 步与失败不得降级成功。

**可观测行为**: Judge 自身也有签名双 receipt；只引用本 run 两份 digest；任何必跑项非零时 verdict≠PASS。

**验证命令**:
```bash
node sprints/08040522-kernel-pr1581-fleet-validation-r16/tests/validate-fleet-evidence.mjs sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence /tmp/pr1581-final.json "$HARNESS_RUNNER_PUBLIC_KEY_PATH"
```
**硬阈值**: validator exit 0；Judge 四个 behavior check IDs 完整；PASS 蕴含全部检查 exit 0。

### Step 5: verdict 前未合并并输出原样结论
**来源**: `[FROM_PRD]` — PRD 第 5 步及提前 merge 边界。

**可观测行为**: capture 时 OPEN/null；若 verdict 后 merge，则 mergedAt≥verdict_at；PASS/FAIL/BLOCKED 原样可追溯。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"'
```
**硬阈值**: head 不变、verdict 前未 merge、全链≤7200s、最终 validator exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（Fleet 严格派发到 `us-mac-m4`）

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped empty Postgres DB_URL}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current Judge attempt}"
: "${HARNESS_PROVIDER:?}"; : "${HARNESS_ACCOUNT:?}"; : "${HARNESS_MACHINE:?}"; : "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"; : "${CAPABILITY_SNAPSHOT_ID:?}"; : "${HARNESS_RUNNER_PUBLIC_KEY_PATH:?}"
CONTRACT_ROOT="$PWD"
SPRINT_DIR="${SPRINT_DIR:-sprints/08040522-kernel-pr1581-fleet-validation-r16}"
EVIDENCE_DIR="$CONTRACT_ROOT/$SPRINT_DIR/evidence"
VALIDATOR="$CONTRACT_ROOT/$SPRINT_DIR/tests/validate-fleet-evidence.mjs"
TARGET_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
EXPECTED_DIGEST="sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a"
TARGET_WT=$(mktemp -d); rmdir "$TARGET_WT"
PR_JSON=$(mktemp); COOKIE_A=$(mktemp); COOKIE_B=$(mktemp); SIGNUP_A=$(mktemp); SIGNUP_B=$(mktemp)
APP_PID=""
cleanup() { [ -z "$APP_PID" ] || kill "$APP_PID" 2>/dev/null || true; git worktree remove --force "$TARGET_WT" 2>/dev/null || true; rm -f "$PR_JSON" "$COOKIE_A" "$COOKIE_B" "$SIGNUP_A" "$SIGNUP_B"; }
trap cleanup EXIT
[ "$HARNESS_MACHINE" = "us-mac-m4" ] && [ "$HARNESS_RUNNER_DIGEST" = "$EXPECTED_DIGEST" ]
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > "$PR_JSON"
jq -e --arg h "$TARGET_SHA" '.headRefOid==$h and .state=="OPEN" and .mergedAt==null' "$PR_JSON" >/dev/null
git fetch origin "$TARGET_SHA"
git worktree add --detach "$TARGET_WT" "$TARGET_SHA"
[ "$(git -C "$TARGET_WT" rev-parse HEAD)" = "$TARGET_SHA" ]
cd "$TARGET_WT"
npm ci
npm run product-map:check
export DATABASE_URL="$DB_URL"
npm run migrate --workspace=apps/api
psql "$DB_URL" -tAc "SELECT to_regclass('zenithjoy.acquisition_config') IS NOT NULL" | grep -qx t
export DATABASE_HOST="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).hostname)')"
export DATABASE_PORT="$(node -e 'process.stdout.write(new URL(process.env.DB_URL).port||"5432")')"
export DATABASE_NAME="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).pathname.slice(1)))')"
export DATABASE_USER="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).username))')"
export DATABASE_PASSWORD="$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.DB_URL).password))')"
export PORT=33181 BETTER_AUTH_URL=http://127.0.0.1:33181
export BETTER_AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
unset VITEST
node_modules/.bin/ts-node --transpile-only --project apps/api/tsconfig.json -e "import app from './apps/api/src/app'; app.listen(33181, '127.0.0.1');" >/tmp/kernel-r16-api.log 2>&1 & APP_PID=$!
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:33181/health >/dev/null && break; kill -0 "$APP_PID" 2>/dev/null || { tail -40 /tmp/kernel-r16-api.log; exit 1; }; [ "$i" -lt 60 ] || exit 1; sleep 1; done
EMAIL_A="harness-a-${RANDOM}-$(date +%s)@example.invalid"; EMAIL_B="harness-b-${RANDOM}-$(date +%s)@example.invalid"
curl -fsS -c "$COOKIE_A" -H 'content-type: application/json' -d "{\"name\":\"Harness A\",\"email\":\"$EMAIL_A\",\"password\":\"temporary-Aa1!\"}" http://127.0.0.1:33181/api/auth/sign-up/email > "$SIGNUP_A"
curl -fsS -c "$COOKIE_B" -H 'content-type: application/json' -d "{\"name\":\"Harness B\",\"email\":\"$EMAIL_B\",\"password\":\"temporary-Bb2!\"}" http://127.0.0.1:33181/api/auth/sign-up/email > "$SIGNUP_B"
USER_A=$(jq -er '.user.id' "$SIGNUP_A"); USER_B=$(jq -er '.user.id' "$SIGNUP_B")
TENANT_A=$(psql "$DB_URL" -v uid="$USER_A" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'uid' LIMIT 1")
TENANT_B=$(psql "$DB_URL" -v uid="$USER_B" -tAc "SELECT tenant_id FROM zenithjoy.tenant_members WHERE feishu_user_id=:'uid' LIMIT 1")
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] && [ "$TENANT_A" != "$TENANT_B" ]
curl -fsS -b "$COOKIE_A" -H 'content-type: application/json' -X PUT -d '{"keywords_per_round_min":5,"keywords_per_round_max":10}' http://127.0.0.1:33181/api/acquisition/config | jq -e '.success==true' >/dev/null
curl -fsS -b "$COOKIE_B" -H 'content-type: application/json' -X PUT -d '{"keywords_per_round_min":2,"keywords_per_round_max":8}' http://127.0.0.1:33181/api/acquisition/config | jq -e '.success==true' >/dev/null
psql "$DB_URL" -v a="$TENANT_A" -v b="$TENANT_B" -tAc "SELECT count(*)=2 FROM zenithjoy.acquisition_config WHERE tenant_id IN (:'a',:'b') AND created_at > NOW()-interval '5 minutes'" | grep -qx t
DB_URL="$DB_URL" npx vitest run sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts --reporter=verbose
git diff --exit-code "$TARGET_SHA" -- apps/api/tests/routes/acquisition-dispatch.test.ts
npm test --workspace=apps/api -- --run tests/routes/acquisition-dispatch.test.ts -t 'partial patch cannot make merged keyword bounds invalid' --reporter=verbose
cd "$CONTRACT_ROOT"
for r in generator evaluator judge; do for p in start complete; do test -s "$EVIDENCE_DIR/runner-$p-$r.json"; test -s "$EVIDENCE_DIR/runner-$p-$r.sig"; done; test -s "$EVIDENCE_DIR/$r.json"; done
jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg c "$CAPABILITY_SNAPSHOT_ID" --arg p "$HARNESS_PROVIDER" --arg ac "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg mo "$HARNESS_MODEL" '.attempt_id==$a and .capability_snapshot_id==$c and .to_target.provider==$p and .to_target.account==$ac and .to_target.machine==$m and .to_target.model==$mo' "$EVIDENCE_DIR/runner-start-judge.json" >/dev/null
node "$VALIDATOR" "$EVIDENCE_DIR" "$PR_JSON" "$HARNESS_RUNNER_PUBLIC_KEY_PATH"
```

## Test Contract

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| 签名 Fleet 证据链 | `Fleet start/completion attestation 签名有效`、`每项检查均记录在冻结目标 SHA 执行`、`completion receipt 绑定各角色 evidence`、`fail-closed verdict` | `tests/fleet-validation.test.ts` | evidence 与 Runner 公钥尚未生成，Vitest 因缺文件/环境变量失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 篡改一个 signed receipt 字节、signature、target SHA 或 completion evidence digest，validator 必须非零。
- 重复提交: 复用同一 dispatch/attempt/capability 给两个角色，必须非零。
- 中途中断: Fleet completion receipt 缺失或测试中断，只能 FAIL/BLOCKED。
- 边界值: PR head 在 Generator 与 Evaluator 间变化，旧链必须整体失效。
发现分级: P0/P1（错误 PASS/提前 merge）阻塞 merge；P2/P3 记录 findings。
