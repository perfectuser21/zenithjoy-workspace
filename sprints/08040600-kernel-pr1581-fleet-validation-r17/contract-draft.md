# Sprint Contract Draft (Round 6)

## Notes

- 本轮仅验证 PR #1581；不修改目标业务代码、不复用旧证据、不修改共享 fixture、不执行合并。
- contract-gate: skipped (file not found, third-party repo)
- Registry 未提供本验证流程专属 HTTP schema，按 PRD 字面协议定义证据 envelope；`context-manifest` 无累积 FR。
- `product-map:check` 首次执行因当前 workspace 未安装 `ajv` 而未启动校验逻辑；锁定依赖安装后须重跑并以 exit 0 为准。
- Round 5 修复 reviewer 阻塞：Generator 必须在独立候选 worktree 内机检 `git rev-parse HEAD`；B-01 将真实 migration、目标表 bootstrap、动态 signup/session/tenant 与双租户隔离分别写成可机检 evidence 字段，禁止仅用笼统的 `product_validation` 声明代替。
- Round 6 修复 reviewer 阻塞：每个 Fleet receipt 携带 Runner late-bound 的 `logical_cycle_id`；Evaluator/Judge receipt 另携带上游 attempt、capability 与 evidence SHA-256 provenance。同 run/SHA 的旧 attempt 重放必须被负向 oracle 拒绝。

## Response Schema（推导来源: PRD 字面 + NEW_PATTERN）

本 Sprint 不新增业务 HTTP 响应。角色证据统一为 schema v2：顶层必含 `schema_version`、`role`、`run_id`、`logical_cycle_id`、`attempt_id`、`final_sha`、`provider`、`account`、`machine`、`model`、`runner_digest`、`capability_snapshot_id`、`fleet_receipt_sha256`、`exit_code`、`log_tail`、`behavior_tests`；Evaluator/Judge 另含 `verdict`、上游摘要与 `upstream_provenance`。禁用：把 authoring attempt/snapshot UUID 写成期望值、只凭 run/SHA 接受上游证据、缺失败条目的空 `behavior_tests`、用角色脚本生成 `fleet-receipt.json`。

## Kernel validation identity（late-bound 与 Fleet 前置签发）

稳定对象：run_id `5172f36e-d86c-45cf-a417-b2678c2ec3e4`、PR #1581、base SHA `676fed7de12023d355deac7849af8a525ae53f8d`、target SHA `c305f6217da65bb69413c39e621b7e797e0fb189`。角色身份必须 late-bound：

1. Fleet 在启动每个角色命令前写出 checkout 外的 receipt，并注入 `HARNESS_FLEET_RECEIPT_PATH` 与 `HARNESS_LOGICAL_CYCLE_ID`。receipt 包含 `issued_by=fleet-runner`、`issued_before_role_start=true`、唯一 `receipt_id`、角色、run、logical cycle 以及该角色实际 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID`。
2. 角色入口第一步只读 receipt，要求普通文件、路径不在 repo/worktree、mtime 不晚于 `HARNESS_ROLE_STARTED_AT`，并逐字段匹配当前 Runner 环境；角色不得创建、覆盖、chmod 或回写 receipt。缺路径或不匹配立即失败。
3. evidence 复制 receipt 原始字节到 `evidence/<role>.fleet-receipt.json` 留证并记录 SHA-256；复制品不是信任根，信任根仍是 Fleet 注入的外部文件。
4. Generator、Evaluator、Judge 各用自己的 attempt/capability。Evaluator receipt 由 Runner 注入 `HARNESS_UPSTREAM_ATTEMPT_ID`、`HARNESS_UPSTREAM_CAPABILITY_SNAPSHOT_ID`、`HARNESS_UPSTREAM_EVIDENCE_SHA256` 并逐字段绑定 Generator；Judge 同理绑定 Evaluator。角色不得从待验文件自行推导这些期望值。
5. 验收必须构造“同 run、同 target SHA、不同 logical cycle/旧 attempt”的旧证副本；Evaluator 和 Judge 均须返回非零并记录 `old-attempt-replay-rejected`，禁止只比较身份互异或文件摘要。

## 已知约束（来自回归测试）

- `apps/api/tests/routes/acquisition-dispatch.test.ts` → partial patch 不得形成非法 merged keyword bounds。
- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → 真 Postgres 下覆盖有效态、并发串行和双租户隔离。
- `[累积FR]` 本 line 暂无历史。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|---|---|---|
| FR | 做什么 | 精确 SHA 在 strict us-mac-m4 完成新鲜 Generator、Evaluator、Judge 链并输出最终 verdict。 |
| NFR | 做得多好 | 总预算 7200s；身份、SHA、receipt、结果逐字可核查。 |
| Invariant | 永不违反 | 不复用旧证、不 fallback、不自签 Fleet receipt、不在 verdict 前合并。 |
| 判定点 | 怎么知道 | 见登记表。 |
| 保质期 | 何时过期 | PR head、attempt 或 capability 变化即失效，全量新跑。 |
| 死亡告警 | 停了谁知道 | 每个失败都写非零 exit_code、失败 behavior 和 log_tail；控制面阻断放行。 |
| 失败语义 | 挂了怎么办 | 缺证为 INSUFFICIENT_EVIDENCE；完整失败为 FAIL；只在全绿时 PASS。 |
| 效果确认 | 已发≠生效 | 真产品结果、Evaluator 复核、Judge 摘要链和 PR 未合并状态联合确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR head 是否仍为目标提交 | 本地 ref / GitHub API | 执行前后查 GitHub API | 本地 ref 可陈旧 | 错代码获裁决 |
| ⚠️ 身份是否由 Fleet 前置签发 | 角色自报 / 外部只读 receipt | Fleet 命令启动前签发的外部 receipt | 角色事后自写不能证明来源 | 身份冒充 |
| ⚠️ 最终 verdict 是否与失败一致 | 自由文本 / 确定性函数 | PASS=证据齐且全 exit 0；缺证=INSUFFICIENT；其余=FAIL | 防局部成功覆盖失败 | 错误放行 |

judgment-pending-user: PR head 是否仍为目标提交
judgment-pending-user: 身份是否由 Fleet 前置签发
judgment-pending-user: 最终 verdict 是否与失败一致

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| receipt 缺失/可写/晚于角色启动/字段不符 | 记录失败 behavior，非零退出 | 新 attempt 可重跑 | 无，不准角色补写 |
| 产品或断言失败 | 保留原 exit code、stderr/log_tail 和已完成 behavior | 新空库可重跑 | 无，不吞错 |
| 上游 evidence 缺失/损坏 | Judge=INSUFFICIENT_EVIDENCE | 补齐须新角色 attempt | 禁止猜测 PASS |
| 同 run/SHA 的旧 attempt evidence 重放 | provenance mismatch，非零退出并留拒绝证据 | 否；须由 Runner 派发当前 cycle 新角色 | 禁止按摘要或身份互异放行 |
| 上游 evidence 完整但含失败 | Judge=FAIL | 修复后全链新跑 | 禁止局部成功覆盖 |
| PR 漂移/提前合并 | FAIL 并保留 GitHub 响应摘要 | 新 SHA/new attempt | 无 |

### 输入对抗面

N/A — 不新增对外 agent 或用户输入接口。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

## 真实调用方请求 shape

产品链沿用生产 Web 调用方：`Content-Type: application/json`；`POST /api/auth/sign-up/email` 建真实 session cookie；`PUT/PATCH/GET /api/acquisition/config` 用 cookie 鉴权；请求体只使用 `keywords_per_round_min`、`keywords_per_round_max`，禁止 body 伪造 tenant。

## 禁 mock 边清单

- Fleet dispatch ↔ role process：测试必须消费 Fleet 前置外部 receipt，禁止角色自写身份 attestation。
- GitHub PR ↔ exact-SHA worktree：必须查询真实远端 head 并检出目标 commit。
- acquisition route ↔ service ↔ Postgres：同一空库做 migration、真实 signup/cookie 与配置写读，禁止 mock route/service/DB。
- Generator ↔ Evaluator ↔ Judge：真实文件 SHA-256 串联；成功与失败都保留完整 envelope。
- Runner provenance ↔ 上游 evidence：logical cycle、attempt、capability、SHA-256 四项逐字匹配，禁止从被测 evidence 自举期望值。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] Fleet 前置 receipt ↔ 角色身份：外部路径、前置时间、逐字段与 SHA-256 均真验；未真验为 `logic-done-pending`。
- [接缝×2] 真 Postgres ↔ auth/router/service：同一 `DB_URL` 空库真实执行；未真验为 `logic-done-pending`。
- [接缝×2] 三角色证据链 ↔ Judge：成功、断言失败、缺证三种结果重复核验；不一致为 FLAKY。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[冻结目标] → [Fleet 前置签发身份] → [Generator 真链] → [Evaluator 完整验收] → [Judge 一致裁决且未合并]

### Step 1: 冻结目标与严格机器
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步。

**可观测行为**: PR head 为目标 SHA；Generator 为候选提交创建独立 worktree，并在该 worktree 内读取 `git rev-parse HEAD`，结果必须等于目标 SHA；机器为 us-mac-m4；Fleet receipt 在角色命令前已存在且不在 checkout。

**验证命令**: `H=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha) && [ "$H" = c305f6217da65bb69413c39e621b7e797e0fb189 ] && A=$(jq -er '.actual_checkout_sha' sprints/08040600-kernel-pr1581-fleet-validation-r17/evidence/generator.json) && [ "$A" = "$H" ] && [ "$HARNESS_MACHINE" = us-mac-m4 ] && [ -f "$HARNESS_FLEET_RECEIPT_PATH" ] && case "$HARNESS_FLEET_RECEIPT_PATH" in "$PWD"/*) exit 1;; esac`

**硬阈值**: 所有字面相等且命令 exit 0。

### Step 2: Generator 跑真实产品链
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步和范围限定。

**可观测行为**: 同一 Fleet 注入的全新 `DB_URL` 上运行仓库真实 migration；用 `to_regclass` 机检 acquisition 配置目标表；经真实 signup/login API 动态创建两个 session cookie 与两个非空且不同的 tenant；tenant A 写入后 tenant B 读取不到 A 的值；同租户冲突 PATCH 真实执行。cookie、密码和 DB_URL 不进入证据。无论成败均写完整 Generator envelope。

**验证命令**: `npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Generator 新鲜证据绑定 Fleet 前置 receipt 和目标 SHA" --reporter=verbose`

**硬阈值**: `actual_checkout_sha=target_sha`；`migration.exit_code=0`；`bootstrap.target_table_exists=true`；`auth.signup_count=2`、`session_cookie_count=2`、两个动态 tenant ID 非空且互异；`tenant_isolation.cross_tenant_leak_count=0`；成功路径 response statuses=`[200,400]`、错误码 `INVALID_CONFIG`、最终 min≤max、exit 0。上述每项都必须在 `behavior_tests` 有独立 L2 记录；失败路径 evidence.exit_code 非零且 log_tail/失败 behavior 非空。

### Step 3: Evaluator 完整保留成功或失败
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2-3 步。

**可观测行为**: Evaluator 用自身前置 receipt，引用 Generator 摘要；每项断言保留实际 exit code/log_tail/evidence。`verdict=PASS` 当且仅当顶层和全部 behavior exit 0，否则 `FAIL`。

Evaluator 还必须以 Runner receipt 中的当前 `logical_cycle_id` 和上游 Generator attempt/capability/SHA-256 为期望，拒绝同 run/SHA 但来自旧 cycle/attempt 的 evidence；期望 provenance 不得从 Generator 文件本身读取。

**验证命令**: `npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Evaluator 保留失败证据并由 exit code 确定 verdict" --reporter=verbose`

**硬阈值**: envelope 完整、摘要一致、verdict 确定性一致，命令 exit 0。

### Step 4: Judge 产生唯一一致的最终 verdict
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步及边界情况。

**可观测行为**: Judge 用自己的前置 receipt 并引用 Evaluator 文件摘要。上游证据缺失/不可解析=`INSUFFICIENT_EVIDENCE`；证据完整但任一失败=`FAIL`；证据齐全且全绿=`PASS`。Judge 自身每项核验也保留实际结果。

Judge 必须用 Runner receipt 注入的 Evaluator provenance 做同样的新鲜度核验；旧 Evaluator attempt 重放归 `INSUFFICIENT_EVIDENCE`，不得因 run/SHA 和摘要自洽而 PASS。

**验证命令**: `PR=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581) && echo "$PR" | jq -e '.state=="open" and .merged==false and .merged_at==null and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189"' && npx vitest run sprints/08040600-kernel-pr1581-fleet-validation-r17/tests/fleet-validation-evidence.test.ts -t "Judge 引用 Evaluator 摘要并给出与证据一致的最终裁决" --reporter=verbose`

**硬阈值**: verdict 属三值且与规则唯一一致；PR 未合并；命令 exit 0。

### Step 5: 禁止角色自签与 authoring identity 固化
**来源**: `[AI_ADDED]` — 修复 Round 3 reviewer 指出的事后自写 attestation 假证明面，并落实 Kernel late-binding。

**可观测行为**: role command 只读 `HARNESS_FLEET_RECEIPT_PATH`，没有创建 receipt 的代码；合同/测试不含 authoring attempt/capability UUID。

**验证命令**: `! rg -n '(writeFile|writeFileSync|cp |install ).*(fleet-receipt|HARNESS_FLEET_RECEIPT_PATH)|(attempt_id|capability_snapshot_id).*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' sprints/08040600-kernel-pr1581-fleet-validation-r17/contract-dod.md sprints/08040600-kernel-pr1581-fleet-validation-r17/tests`

**硬阈值**: 搜索无命中，命令 exit 0。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: receipt 的 role/machine/final_sha/attempt/capability 与环境不一致。
- 重复提交: 重放旧 receipt、Generator 或 Evaluator 文件。
- 中途中断: 每个角色在首项、产品链中间、写最终文件前被终止，核验 trap/finalizer 留证。
- 边界值: PR head 两次查询间漂移；7200s 临界；空 log_tail。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Generator | `tests/fleet-validation-evidence.test.ts` | Generator 新鲜证据绑定 Fleet 前置 receipt 和目标 SHA | evidence 不存在，ENOENT |
| Evaluator | `tests/fleet-validation-evidence.test.ts` | Evaluator 保留失败证据并由 exit code 确定 verdict | evidence 不存在，ENOENT |
| Judge | `tests/fleet-validation-evidence.test.ts` | Judge 引用 Evaluator 摘要并给出与证据一致的最终裁决 | evidence 不存在，ENOENT |
| 反自签/缺证 | `tests/fleet-validation-evidence.test.ts` | 角色不得自行生成 Fleet receipt 且缺证不得判 PASS | receipt 不存在，ENOENT |
| 旧证重放 | `tests/fleet-validation-evidence.test.ts` | 同 run 和 SHA 的旧 attempt 重放必须被 provenance 拒绝 | replay rejection evidence 不存在 |

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（Fleet strict affinity: us-mac-m4）

```bash
#!/bin/bash
set -uo pipefail
: "${DB_URL:?Fleet injects an attempt-scoped empty DB_URL}"
: "${HARNESS_FLEET_RECEIPT_PATH:?Fleet must issue receipt before role command}"
: "${HARNESS_ROLE_STARTED_AT:?Fleet must inject role start timestamp}"
: "${HARNESS_LOGICAL_CYCLE_ID:?Runner must inject the current logical cycle}"
for k in HARNESS_ATTEMPT_ID HARNESS_PROVIDER HARNESS_ACCOUNT HARNESS_MACHINE HARNESS_MODEL HARNESS_RUNNER_DIGEST CAPABILITY_SNAPSHOT_ID; do [ -n "${!k:-}" ] || { echo "missing $k"; exit 1; }; done
[ "$HARNESS_MACHINE" = us-mac-m4 ] || exit 1
RUN_ID=5172f36e-d86c-45cf-a417-b2678c2ec3e4
TARGET_SHA=c305f6217da65bb69413c39e621b7e797e0fb189
SPRINT_DIR=sprints/08040600-kernel-pr1581-fleet-validation-r17
EVIDENCE_DIR="$PWD/$SPRINT_DIR/evidence"
ROLE="${HARNESS_ROLE:?Runner injects generator, evaluator, or judge}"
LOG=$(mktemp)
RESULT=$(mktemp)
mkdir -p "$EVIDENCE_DIR"
EXIT_CODE=1
finalize(){ rc=$?; [ "$EXIT_CODE" -ne 1 ] || EXIT_CODE=$rc; node "$SPRINT_DIR/scripts/finalize-role-evidence.mjs" --role "$ROLE" --exit-code "$EXIT_CODE" --log "$LOG" --result "$RESULT" --fleet-receipt "$HARNESS_FLEET_RECEIPT_PATH" --output "$EVIDENCE_DIR/$ROLE.json"; exit "$EXIT_CODE"; }
trap finalize EXIT INT TERM

# Runner trust root: only read; never create/modify. Copying for audit is done by the Fleet finalizer, not this role script.
[ -f "$HARNESS_FLEET_RECEIPT_PATH" ] || { echo 'fleet receipt missing' | tee -a "$LOG"; exit 1; }
case "$HARNESS_FLEET_RECEIPT_PATH" in "$PWD"/*) echo 'receipt inside role checkout' | tee -a "$LOG"; exit 1;; esac
node "$SPRINT_DIR/scripts/verify-fleet-receipt.mjs" --path "$HARNESS_FLEET_RECEIPT_PATH" --role "$ROLE" --run-id "$RUN_ID" --logical-cycle-id "$HARNESS_LOGICAL_CYCLE_ID" --started-at "$HARNESS_ROLE_STARTED_AT" 2>&1 | tee -a "$LOG" || exit 1

# Each role command records every behavior before returning; finalizer always emits envelope, including failures.
case "$ROLE" in
  generator) "$SPRINT_DIR/scripts/run-pr1581-generator-e2e.sh" --db-url "$DB_URL" --target-sha "$TARGET_SHA" --result "$RESULT" 2>&1 | tee -a "$LOG"; EXIT_CODE=${PIPESTATUS[0]} ;;
  evaluator) for k in HARNESS_UPSTREAM_ATTEMPT_ID HARNESS_UPSTREAM_CAPABILITY_SNAPSHOT_ID HARNESS_UPSTREAM_EVIDENCE_SHA256; do [ -n "${!k:-}" ] || exit 1; done; node "$SPRINT_DIR/scripts/evaluate-pr1581-evidence.mjs" --generator "$EVIDENCE_DIR/generator.json" --logical-cycle-id "$HARNESS_LOGICAL_CYCLE_ID" --upstream-attempt-id "$HARNESS_UPSTREAM_ATTEMPT_ID" --upstream-capability-snapshot-id "$HARNESS_UPSTREAM_CAPABILITY_SNAPSHOT_ID" --upstream-evidence-sha256 "$HARNESS_UPSTREAM_EVIDENCE_SHA256" --result "$RESULT" 2>&1 | tee -a "$LOG"; EXIT_CODE=${PIPESTATUS[0]} ;;
  judge) for k in HARNESS_UPSTREAM_ATTEMPT_ID HARNESS_UPSTREAM_CAPABILITY_SNAPSHOT_ID HARNESS_UPSTREAM_EVIDENCE_SHA256; do [ -n "${!k:-}" ] || exit 1; done; node "$SPRINT_DIR/scripts/judge-pr1581-evidence.mjs" --generator "$EVIDENCE_DIR/generator.json" --evaluator "$EVIDENCE_DIR/evaluator.json" --logical-cycle-id "$HARNESS_LOGICAL_CYCLE_ID" --upstream-attempt-id "$HARNESS_UPSTREAM_ATTEMPT_ID" --upstream-capability-snapshot-id "$HARNESS_UPSTREAM_CAPABILITY_SNAPSHOT_ID" --upstream-evidence-sha256 "$HARNESS_UPSTREAM_EVIDENCE_SHA256" --result "$RESULT" 2>&1 | tee -a "$LOG"; EXIT_CODE=${PIPESTATUS[0]} ;;
  *) echo "invalid role=$ROLE" | tee -a "$LOG"; EXIT_CODE=1 ;;
esac

PR=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 2>>"$LOG") || EXIT_CODE=1
echo "$PR" | jq -e '.state=="open" and .merged==false and .merged_at==null and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189"' >>"$LOG" 2>&1 || EXIT_CODE=1
exit "$EXIT_CODE"
```

E2E 所引用的三个 role helper 由 Generator 按本合同实现：Generator helper 必须 `git fetch origin pull/1581/head`，以 `git rev-parse --verify '<ref>^{commit}'` 解出候选后创建独立 worktree，并在该 worktree 内执行 `git rev-parse HEAD`；不等于目标 SHA 时必须在启动依赖前失败。随后在同一 `DB_URL` 执行仓库真实 `npm ci`、migration、`to_regclass` 目标表断言、API 启动、两个动态 signup cookie、两个动态 tenant 与交叉读取隔离断言、并发 PATCH。每个阶段必须写独立 `behavior_tests`，不得只写总括成功字段；finalizer 必须在任意退出路径输出 schema v2 完整 envelope，且不得写/改 Fleet receipt。Evaluator/Judge helper 必须把 Runner 注入的 upstream provenance 当独立信任根，并各自执行一次同 run/SHA 旧 attempt 重放负向 oracle；Judge helper必须严格按 Step 4 三值函数裁决。
