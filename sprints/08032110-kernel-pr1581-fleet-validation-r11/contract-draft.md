# Sprint Contract Draft（Round 2）

## Response Schema（推导来源: PRD 字面）

N/A — 本 sprint 不新增或修改 HTTP 端点。API/DB/test registry 已读取，但没有本任务的 Fleet 权威证据模式，因此不据此臆造端点或数据库结构。验收器只读 Fleet/Controller 挂载的 attempt 级权威目录，派生报告不是验收输入。

## 已知约束（来自回归测试与历史上下文）

- （未找到与 Kernel provider-neutral Fleet 验证报告直接对应的仓内回归测试；本轮在 `tests/fleet-validation-report.test.ts` 建立 Red。）
- [累积 FR] context-manifest 端点返回 HTTP 404 HTML，记为 `context-manifest: unavailable`；PRD 同时明确本 line 暂无历史 FR。
- [仓库事实] `refs/pull/1581/head` 与分支 `cp-08030452-kernel-acquisition-config-v2` 当前都解析为 `c305f6217da65bb69413c39e621b7e797e0fb189`；Final E2E 必须重新查询，禁止借用本次起草时的结果。
- [仓库事实] 目标提交修改 acquisition config 的 route/service 写路径；本 sprint 只验证该提交，不修改其功能代码、共享 Red fixture 或共享 CI 基础设施。
- [历史失败] PRD 记录上一轮死因为 `callback_runner_failure`；本轮任何 callback/阶段缺席必须明确 FAIL，不得降级为 warning。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition keep-green

`product-map/generated/product-map.json` 已用 `jq` 核实该组合存在；本 sprint 只验证既有 PR #1581，不推进或修改产品步骤，因此使用 keep-green，并要求真实 pipeline 执行该 GP 的 smoke 文件。

## 权威证据输入合同

Final E2E 只接受 Fleet 以只读方式挂载的 `${HARNESS_AUTHORITY_DIR:?}`，禁止以 sprint 内 JSON、自填布尔值或命令行覆盖替代。权威目录必须属于当前外部锚点：

- `run_id=b3c74dad-0e21-4758-8a71-499c61d0736e`
- `attempt_id=711732ab-481a-4ab7-90ba-84c79f6403a3`
- `capability_snapshot_id=20adc26e-4753-49f4-bfcf-1fcbceb155c2`
- `repo=perfectuser21/zenithjoy-workspace`、`pr_number=1581`、`target_sha=c305f6217da65bb69413c39e621b7e797e0fb189`

目录由 Fleet/Controller 在 evaluator 执行面挂载，至少包含下列不可由 Generator 写入的文件：

```json
{
  "dispatch.json": {
  "run_id": "b3c74dad-0e21-4758-8a71-499c61d0736e",
  "attempt_id": "711732ab-481a-4ab7-90ba-84c79f6403a3",
  "execution_surface": "fleet-worker",
  "repo": "perfectuser21/zenithjoy-workspace",
  "pr_number": 1581,
  "target_sha": "c305f6217da65bb69413c39e621b7e797e0fb189",
  "issued_at": "<RFC3339>",
  "source": "fleet-controller"
  },
  "capability-snapshot.json": {
    "capability_snapshot_id": "20adc26e-4753-49f4-bfcf-1fcbceb155c2",
    "to_target": {"provider":"codex","account":"team2","model":"gpt-5.6-sol","machine":"us-mac-m4"},
    "fallback_reason": "preferred_target_healthy",
    "failure_class": "none",
    "runner_version": "1.267.97",
    "admitted": true
  },
  "receipts/<stage>.json": {
    "receipt_id": "<各阶段唯一>",
    "role": "planner|contract_gan|generator|evaluator|independent_judge",
    "run_id": "<同 dispatch>",
    "attempt_id": "<同 dispatch>",
    "target_sha": "<同 dispatch>",
    "status": "PASS",
    "started_at": "<RFC3339>",
    "finished_at": "<RFC3339>",
    "exit_code": 0,
    "evidence_path": "evidence/<receipt_id>.json",
    "evidence_sha256": "<64-hex>"
  },
  "controller-audit.json": {
    "source": "controller-audit",
    "finalized": true,
    "run_id": "<同 dispatch>",
    "attempt_id": "<同 dispatch>",
    "finalized_at": "<RFC3339>",
    "events": [{"occurred_at":"<RFC3339>","actor":"<角色>","action":"<动作>","target_sha":"<同 dispatch>"}]
  }
}
```

Verifier 必须先校验目录真实路径不位于仓库或 sprint 内，再读取这些外部文件；所有 `evidence_path` 必须 `realpath` 后仍位于权威目录、文件非空、SHA-256 匹配，并解析原始证据中的 role/run/attempt/SHA/exit_code/log_tail/behavior_tests。Evaluator 与 Judge 的 `receipt_id`、证据真实路径、SHA-256、角色均须不同。时序必须满足 `dispatch.issued_at <= planner.started_at <= ... <= generator.finished_at <= evaluator.started_at < evaluator.finished_at <= independent_judge.started_at < independent_judge.finished_at <= controller-audit.finalized_at`，全程不超过 7200 秒。派生的 `fleet-validation-report.json` 只能由 verifier 在全部检查通过后写出，Verifier 不提供 `--report` 输入参数。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

入口：PR #1581 精确 head → US M4 严格亲和派发 → provider-neutral 全阶段链 → 新鲜 Evaluator 与 Independent Judge 双闸 → 只报告“可合并”，不执行合并。

### Step 1：锁定目标 SHA 与唯一 Runner

**来源**：`[FROM_PRD]` — PRD Golden Path 第 1 步、边界情况与 NFR 版本要求。

**可观测行为**：Fleet 权威 dispatch、capability snapshot、Runner checkout 与实时 PR head 都锚定目标 SHA；Runner 是快照准入的 `us-mac-m4` 版本 `1.267.97`，无 fallback，Controller audit 中无 Xian 派发事件。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --authority-dir "$HARNESS_AUTHORITY_DIR" --check affinity
```

**硬阈值**：run、attempt、capability snapshot、repo、PR、SHA 与本合同外部常量逐字相等；`machine=us-mac-m4`、`version=1.267.97`、`admitted=true`，audit 无其他 machine/fallback/Xian 事件。任一不符 exit 非 0。

### Step 2：完成 provider-neutral 全链并保持同源追溯

**来源**：`[FROM_PRD]` — PRD Golden Path 第 2 步。

**可观测行为**：Planner、合同对抗、Generator、Evaluator、Independent Judge 五个阶段均有 Fleet/Controller 权威回执；每条证据可解引用、摘要匹配、身份同源，且 Path 2 smoke 的原始退出码与日志可从 Generator/Evaluator evidence 中核对。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --authority-dir "$HARNESS_AUTHORITY_DIR" --check pipeline
```

**硬阈值**：五阶段集合完全覆盖且无重复，全部 `PASS/exit_code=0`；每条 evidence 文件非空、SHA-256 正确、内层身份与 receipt 一致；阶段严格按时序串联且总耗时 `0 < elapsed <= 7200s`；Golden Path smoke `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` 有目标 SHA 上的新鲜 exit 0 原始证据。任一断链即 FAIL。

### Step 3：新鲜 Evaluator 给出同 SHA 的可审计结论

**来源**：`[FROM_PRD]` — PRD Golden Path 第 2–3 步及 NFR 可观测要求。

**可观测行为**：Evaluator 权威 receipt/evidence 属于固定 run/attempt，锚定精确目标 SHA，`status=PASS`、`exit_code=0`，且 `log_tail` 与逐条 `behavior_tests` 均可审计；新鲜性由外部 attempt 与时序推导，不读取自报 `fresh` 布尔。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --authority-dir "$HARNESS_AUTHORITY_DIR" --check evaluator
```

**硬阈值**：Evaluator receipt 与解引用证据均属于固定 run/attempt/SHA，`started_at >= generator.finished_at`，顶层及所有 behavior test `exit_code=0`、日志非空；`fresh` 由权威时序推导，不接受报告中的自报布尔值。

### Step 4：Independent Judge 独立给出同 SHA 的可审计结论

**来源**：`[FROM_PRD]` — PRD Golden Path 第 2–3 步及边界情况。

**可观测行为**：Independent Judge 在 Evaluator 后独立产生本 run/attempt 的新鲜回执，锚定精确 SHA，且证据身份不同于 Evaluator。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --authority-dir "$HARNESS_AUTHORITY_DIR" --check judge
```

**硬阈值**：Judge `started_at >= evaluator.finished_at`，权威 receipt 与解引用证据 `PASS/exit_code=0`、逐条退出码为 0、日志非空；Judge 与 Evaluator 的 receipt_id、role、evidence realpath、SHA-256 均不同。

### Step 5：双闸与禁区核对后仅报告可合并

**来源**：`[FROM_PRD]` — PRD Golden Path 第 3 步、范围限定与禁止项。

**可观测行为**：只有前四步全过、Controller audit 完成禁区扫描且 GitHub live PR 仍未合并，verifier 才生成 `merge.allowed=true` 的派生报告；本 sprint 不执行合并。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --authority-dir "$HARNESS_AUTHORITY_DIR" --check merge-gate
```

**硬阈值**：audit 必须 `source=controller-audit, finalized=true`，事件流中不存在读取其他 candidate、修改共享 Red fixture、blind verdict 前 merge、fallback/换机事件；GitHub API 的 `merged_at` 为空且 live head 未漂移。证据缺失、URI/摘要不可解引用、时序逆序或禁区触碰全部 fail closed。

### Step 6：失败路径明确且不可旁路

**来源**：`[AI_ADDED]` — 把 PRD 的多个 fail-closed 边界固化成可执行负向 oracle，防止报告只在 happy path 自证。

**可观测行为**：Verifier 对错误外部 attempt、仓内伪造 authority、证据路径逃逸/摘要错、时序逆序、缺 Judge、SHA 漂移、Xian/fallback、禁区事件或提前合并中的任一输入返回非 0，并给出原因码。

**验证命令**：

```bash
npx vitest run sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts --reporter=verbose
```

**硬阈值**：所有负向 fixture 都被拒绝；`--report` 参数也必须被拒绝，杜绝内部自洽报告成为信任根。不得接受空 evidence、历史回执或 warning 降级。

## 接缝清单

- [接缝×2] Fleet dispatch/capability snapshot ↔ US M4 Runner attestation：从只读 authority mount 与 Controller audit 两个权威文件核对 machine/version/admitted/fallback/Xian；重复两次不一致判 FLAKY。
- [接缝×2] GitHub PR head ↔ Runner checkout：Final E2E 开始和双闸后分别 live 查询 Git ref，并与权威 checkout receipt 的 SHA 相等；漂移立即 FAIL。
- [接缝×2] Evaluator ↔ Independent Judge ↔ Controller audit：解引用两个不同 receipt 的原始证据并核对严格时序、摘要与 merge 事件；任一次缺席或不同步均保持未合并。

未执行 Final E2E 前上述接缝均为 `logic-done-pending`；只有 US M4 真目标上的证据与双闸实跑后才可标 done。

## 禁 mock 边清单

- Fleet/Controller authority mount ↔ `us-mac-m4` Runner attestation（必须读取本 attempt 真实派发与 capability snapshot，禁止 sprint 内 JSON 替代）。
- Runner checkout ↔ GitHub PR #1581 live head（必须用 `git ls-remote --exit-code` 复核，禁止硬编码报告自证）。
- Planner/合同对抗/Generator/Evaluator/Judge receipt ↔ 可解引用 evidence（必须校验 realpath、SHA-256、内外身份与时序，禁止非空 URI 自证）。
- Evaluator/Judge verdict ↔ Controller audit/GitHub merge gate（必须真双闸并回查权威事件，禁止 mock PASS 或复用同一回执）。

## 真实调用方请求 shape

N/A — 本 sprint 不新增设备/agent 到业务服务端的请求，也不定义新 API。真实调用形态是 Fleet 只读 authority mount + GitHub live ref/API；verifier 不接受 body/参数传入 run、attempt、runner 或 verdict 覆盖权威文件。

## 未覆盖真实链路清单

- Verifier 的 L2 负向合同测试使用临时目录 fixture｜仅验证伪造/错误 evidence 会被拒绝，不替代 Fleet、GitHub、Evaluator 或 Judge 接缝｜补位：B-01 至 B-05 和 Final E2E 必须消费只读 `${HARNESS_AUTHORITY_DIR}` 与 live GitHub；只有这些 L3 证据可决定 merge.allowed。
- Xian 固定镜像离线 NAS 中继｜PRD 明确范围外且节点必须 drained｜补位：另行立项完成离线中继；本轮不得以未覆盖为由让 Xian 参与。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能需求 | 对 PR #1581 精确 SHA 在 US M4 跑完整 provider-neutral Pipeline，双闸后报告可合并。 |
| NFR（做得多好） | 性能/可靠性 | 7200 秒内；Runner `1.267.97`；0 次 commander 重试；全链可追溯。 |
| Invariant（永不违反） | 安全/一致性 | 不读其他 candidate、不改共享 Red、不在 blind verdict 前合并、不回退 Runner、不复用历史 verdict。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表；均用外部 authority mount、可解引用证据、Controller audit 与 live GitHub 交叉核对。 |
| 保质期（何时过期） | 证据有效期 | 仅对本 run/attempt 与精确 SHA 有效；PR head 或 attempt 变化立即过期。 |
| 死亡告警（停了谁知道） | 停止工作通知 | 任何阶段/callback 缺席使 verifier 非零退出并由 Harness Controller 标记失败，不静默。 |
| 失败语义（挂了怎么办） | 放行/拦截 | 全部 fail closed；不重试、不换机、不借历史 verdict，明确 reason。 |
| 效果确认（已发≠已生效） | 真实生效回执 | live PR ref/API + authority checkout + 五阶段 evidence 摘要/内容 + 双独立 verdict 严格时序 + audit 无 merge 共同确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Runner 是否为已准入 US M4 | A. 报告机器名；B. Fleet dispatch + capability snapshot + Controller audit 联合 | B | 三者是执行面权威来源，单一报告字段可伪造 | 错机结果被当真并进入合并出口 |
| ⚠️ Verdict 是否新鲜且同源 | A. `fresh` 布尔；B. 外部固定 attempt + receipt/evidence 身份 + 摘要 + 严格时序 | B | 新鲜性必须从不可写外锚与时间关系推导 | 历史 verdict 被错误放行 |
| ⚠️ 双闸是否独立 | A. 两个 PASS 字符串；B. 不同 receipt_id/role/evidence realpath/SHA-256 且 Judge 晚于 Evaluator | B | 可同时防复制证据与并发抢跑 | 独立 Judge 实际缺席却错误合并 |
| PR head 是否漂移 | A. 报告字段；B. Final E2E 前后 live `git ls-remote` 与 checkout 交叉核对 | B | 报告可能在 head 变化后陈旧 | verdict 锚定旧 SHA |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| US M4 不可用或 attestation 不符 | 非零退出，`merge.allowed=false` | commander 重试预算 0 | 无；不回退其他机器 |
| PR head/checkout/SHA 漂移 | 非零退出并记录 `sha_drift` | 否；需新 attempt | 无 |
| callback 或任一阶段缺席/失败 | 非零退出并列缺失阶段 | 否；本 attempt 终止 | 不降级 warning |
| Evaluator/Judge 缺席、旧、非 PASS | 非零退出并列角色原因 | 否；需新鲜重跑 | 不借历史 verdict |
| 禁区触碰或提前合并 | 非零退出并记录对应 forbidden reason | 否 | 阻塞并人工处置 |

### 输入对抗面

N/A — 本任务不新增对外 agent 或可写业务接口。authority 文件仍按不可信内容解析：拒绝路径逃逸、symlink 逃逸、摘要不符、未知/缺失字段、重复 stage、非 40 位 SHA、非 RFC3339 时间、时序逆转、角色 evidence 重用与额外 candidate。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 把权威 receipt 的 attempt 改一位、evidence SHA-256 改错、runner version 改旧，均须 fail closed。
- 重复提交: 对同一只读 authority mount 重复验证两次结果必须一致，除覆盖派生报告外不得产生副作用。
- 中途中断: 缺 contract_gan/callback receipt、evidence 文件不可解引用或 status=FAIL，必须明确失败而非 warning。
- 边界值: 权威首尾时序恰好 7200 秒可接受，7201 秒拒绝；空 log_tail、零字节 evidence、路径逃逸均拒绝。
- 对抗复制: Judge 与 Evaluator 共用 receipt_id、realpath、SHA-256 或 Judge 开始早于 Evaluator 完成，必须拒绝。

发现分级: P0/P1（错误合并、读其他 candidate、共享 fixture 污染、SHA/机器漂移）阻塞 merge；P2/P3 记录 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api（执行面严格亲和 `us-mac-m4`；本任务不依赖业务数据库，故不启动 schema/signup 流程）

```bash
#!/usr/bin/env bash
set -euo pipefail
SPRINT_DIR="sprints/08032110-kernel-pr1581-fleet-validation-r11"
REPORT="$SPRINT_DIR/fleet-validation-report.json"
EXPECTED_RUN="b3c74dad-0e21-4758-8a71-499c61d0736e"
EXPECTED_ATTEMPT="711732ab-481a-4ab7-90ba-84c79f6403a3"
EXPECTED_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
STARTED_AT=$(date +%s)
: "${HARNESS_AUTHORITY_DIR:?Fleet must mount the attempt-scoped read-only authority directory}"
AUTH_REAL=$(cd "$HARNESS_AUTHORITY_DIR" && pwd -P)
REPO_REAL=$(pwd -P)
case "$AUTH_REAL/" in "$REPO_REAL/"*) echo "FAIL: authority_dir_must_be_external"; exit 1;; esac
test -r "$AUTH_REAL/dispatch.json"
test -r "$AUTH_REAL/capability-snapshot.json"
test -r "$AUTH_REAL/controller-audit.json"
LIVE_HEAD_1=$(git ls-remote --exit-code origin refs/pull/1581/head | awk '{print $1}')
[ "$LIVE_HEAD_1" = "$EXPECTED_SHA" ] || { echo "FAIL: sha_drift before gate live=$LIVE_HEAD_1 expected=$EXPECTED_SHA"; exit 1; }
PR_STATE_1=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581)
echo "$PR_STATE_1" | jq -e --arg sha "$EXPECTED_SHA" '.head.sha==$sha and .merged_at==null' >/dev/null
node "$SPRINT_DIR/verify-fleet-validation.mjs" --authority-dir "$AUTH_REAL" --check affinity
node "$SPRINT_DIR/verify-fleet-validation.mjs" --authority-dir "$AUTH_REAL" --check pipeline
node "$SPRINT_DIR/verify-fleet-validation.mjs" --authority-dir "$AUTH_REAL" --check evaluator
node "$SPRINT_DIR/verify-fleet-validation.mjs" --authority-dir "$AUTH_REAL" --check judge
node "$SPRINT_DIR/verify-fleet-validation.mjs" --authority-dir "$AUTH_REAL" --check merge-gate --emit-report "$REPORT"
LIVE_HEAD_2=$(git ls-remote --exit-code origin refs/pull/1581/head | awk '{print $1}')
[ "$LIVE_HEAD_2" = "$EXPECTED_SHA" ] || { echo "FAIL: sha_drift after gate live=$LIVE_HEAD_2 expected=$EXPECTED_SHA"; exit 1; }
[ "$LIVE_HEAD_1" = "$LIVE_HEAD_2" ]
PR_STATE_2=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581)
echo "$PR_STATE_2" | jq -e --arg sha "$EXPECTED_SHA" '.head.sha==$sha and .merged_at==null' >/dev/null
[ $(( $(date +%s) - STARTED_AT )) -le 7200 ]
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(r.run_id!==process.argv[2]||r.attempt_id!==process.argv[3]||r.merge?.allowed!==true||r.merge?.merged!==false)process.exit(1)' "$REPORT" "$EXPECTED_RUN" "$EXPECTED_ATTEMPT"
echo "OK: PR #1581 同 SHA 双闸通过且仍未合并"
```

## Test Contract

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| 严格亲和与精确 SHA | `拒绝非 US M4、版本漂移、Xian 或 SHA 漂移` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier/真实报告尚未产出，测试失败 |
| 全阶段同源追溯 | `要求五阶段属于外部固定 run、attempt 和目标 SHA且证据可解引用` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier 尚未产出，测试失败 |
| Evaluator 与 Judge 双闸 | `拒绝缺失、陈旧、时序逆转或复制的 Evaluator 与 Judge verdict` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier 尚未产出，测试失败 |
| 合并出口 fail closed | `只有权威双闸和 Controller 禁区审计全过才报告可合并且不执行合并` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier 尚未产出，测试失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- Round 1 reviewer receipt 的 attempt `58d80c43-70b7-4f4d-b291-4d844aa047c3` 只标识上一轮审查，不是本轮执行 attempt；Round 2 固定当前 task bundle 的外部 authority attempt `711732ab-481a-4ab7-90ba-84c79f6403a3`，禁止从派生报告自推。
- judgment-pending-user: Runner 是否为已准入 US M4
- judgment-pending-user: Verdict 是否新鲜且同源
- judgment-pending-user: 双闸是否独立
- 本合同只授权生成 sprint 内 verifier、测试、真实运行证据与报告；不授权修改 PR #1581 功能、共享 Red、共享 CI 或执行 merge。
