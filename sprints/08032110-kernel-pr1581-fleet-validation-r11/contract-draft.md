# Sprint Contract Draft（Round 1）

## Response Schema（推导来源: PRD 字面）

N/A — 本 sprint 不新增或修改 HTTP 端点。验收输出是本次 Fleet 运行的 `fleet-validation-report.json`；字段由下方“证据报告合同”定义。API/DB/test registry 已读取，但 registry 快照已陈旧且没有本任务的 Fleet 报告模式，因此不据此臆造端点或数据库结构。

## 已知约束（来自回归测试与历史上下文）

- （未找到与 Kernel provider-neutral Fleet 验证报告直接对应的仓内回归测试；本轮在 `tests/fleet-validation-report.test.ts` 建立 Red。）
- [累积 FR] context-manifest 端点返回 HTTP 404 HTML，记为 `context-manifest: unavailable`；PRD 同时明确本 line 暂无历史 FR。
- [仓库事实] `refs/pull/1581/head` 与分支 `cp-08030452-kernel-acquisition-config-v2` 当前都解析为 `c305f6217da65bb69413c39e621b7e797e0fb189`；Final E2E 必须重新查询，禁止借用本次起草时的结果。
- [仓库事实] 目标提交修改 acquisition config 的 route/service 写路径；本 sprint 只验证该提交，不修改其功能代码、共享 Red fixture 或共享 CI 基础设施。
- [历史失败] PRD 记录上一轮死因为 `callback_runner_failure`；本轮任何 callback/阶段缺席必须明确 FAIL，不得降级为 warning。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

`product-map/generated/product-map.json` 已用 `jq` 核实该组合存在；本次保持关键词获客第 7 步依赖的 acquisition effective-config 修复可合并门禁可信。

## 证据报告合同

`sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json` 是本次运行的唯一验收输入，必须由 Controller/Fleet 从本 attempt 的真实派发、阶段回执与 GitHub PR 状态汇总，禁止 Generator 手填 verdict。至少包含：

```json
{
  "schema_version": "1.0",
  "run_id": "b3c74dad-0e21-4758-8a71-499c61d0736e",
  "attempt_id": "b3d6e266-f0ad-476e-9574-7b0b9943db4b",
  "target": {
    "repo": "perfectuser21/zenithjoy-workspace",
    "pr_number": 1581,
    "expected_sha": "c305f6217da65bb69413c39e621b7e797e0fb189",
    "observed_pr_head_sha": "<40-hex>",
    "checkout_sha": "<40-hex>"
  },
  "runner": {
    "machine": "us-mac-m4",
    "version": "1.267.97",
    "admitted": true,
    "fallback_used": false,
    "xian_used": false
  },
  "pipeline": {
    "provider_neutral": true,
    "started_at": "<RFC3339>",
    "finished_at": "<RFC3339>",
    "elapsed_seconds": 0,
    "stages": [
      {"name":"planner","status":"PASS","run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空>"},
      {"name":"contract_gan","status":"PASS","run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空>"},
      {"name":"generator","status":"PASS","run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空>"},
      {"name":"evaluator","status":"PASS","run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空>"},
      {"name":"independent_judge","status":"PASS","run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空>"}
    ]
  },
  "evaluator": {"status":"PASS","fresh":true,"run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空且不同于 Judge>","exit_code":0,"log_tail":"<非空>","behavior_tests":[{"name":"<非空>","exit_code":0,"log_tail":"<非空>"}]},
  "independent_judge": {"status":"PASS","fresh":true,"run_id":"<本次 run>","attempt_id":"<本次 attempt>","target_sha":"<40-hex>","evidence_uri":"<非空且不同于 Evaluator>","exit_code":0,"log_tail":"<非空>","behavior_tests":[{"name":"<非空>","exit_code":0,"log_tail":"<非空>"}]},
  "forbidden_checks": {"other_candidate_read":false,"shared_red_fixture_modified":false,"merged_before_blind_verdict":false},
  "merge": {"allowed":true,"merged":false,"reason":"evaluator_and_independent_judge_passed"}
}
```

所有阶段 `run_id`、`attempt_id`、`target_sha` 必须逐字段相等；`evaluator` 与 `independent_judge` 必须是不同角色的独立回执，不能复制同一 verdict/evidence URI。报告不得包含 cookie、token、业务凭据或 PII。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

入口：PR #1581 精确 head → US M4 严格亲和派发 → provider-neutral 全阶段链 → 新鲜 Evaluator 与 Independent Judge 双闸 → 只报告“可合并”，不执行合并。

### Step 1：锁定目标 SHA 与唯一 Runner

**来源**：`[FROM_PRD]` — PRD Golden Path 第 1 步、边界情况与 NFR 版本要求。

**可观测行为**：运行对象、实际 checkout 与实时 PR head 都是 `c305f6217da65bb69413c39e621b7e797e0fb189`；Runner 仅为已准入的 `us-mac-m4` 版本 `1.267.97`，无 fallback，Xian 未参与。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check affinity
```

**硬阈值**：三个 SHA 完全相等；`machine=us-mac-m4`、`version=1.267.97`、`admitted=true`、`fallback_used=false`、`xian_used=false`。任一不符 exit 非 0。

### Step 2：完成 provider-neutral 全链并保持同源追溯

**来源**：`[FROM_PRD]` — PRD Golden Path 第 2 步。

**可观测行为**：Planner、合同对抗、Generator、Evaluator、Independent Judge 五个阶段均有本 run、本 attempt、同一 SHA 的真实回执与非空 evidence URI；总耗时不超过 7200 秒。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check pipeline
```

**硬阈值**：五个必需阶段集合完全覆盖且无重复/缺席，全部 `PASS`，`provider_neutral=true`，`0 < elapsed_seconds <= 7200`；阶段回执任一断链即 FAIL。

### Step 3：新鲜 Evaluator 给出同 SHA 的可审计结论

**来源**：`[FROM_PRD]` — PRD Golden Path 第 2–3 步及 NFR 可观测要求。

**可观测行为**：Evaluator 回执属于本 run/attempt，锚定精确目标 SHA，`status=PASS`、`fresh=true`、`exit_code=0`，且 `log_tail` 与逐条 `behavior_tests` 均可审计。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check evaluator
```

**硬阈值**：Evaluator 顶层及所有 behavior test 的 `exit_code=0`、日志非空；任何历史 verdict、缺字段、SHA/run/attempt 不同均 exit 非 0。

### Step 4：Independent Judge 独立给出同 SHA 的可审计结论

**来源**：`[FROM_PRD]` — PRD Golden Path 第 2–3 步及边界情况。

**可观测行为**：Independent Judge 在 Evaluator 后独立产生本 run/attempt 的新鲜回执，锚定精确 SHA，且证据身份不同于 Evaluator。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check judge
```

**硬阈值**：Judge `status=PASS`、`fresh=true`、`exit_code=0`、逐条退出码为 0、日志非空；Judge 与 Evaluator 的 stage/evidence identity 不得相同。

### Step 5：双闸与禁区核对后仅报告可合并

**来源**：`[FROM_PRD]` — PRD Golden Path 第 3 步、范围限定与禁止项。

**可观测行为**：只有前四步全过且三个禁止项均为 false，报告才允许 `merge.allowed=true`；本 sprint 不实际合并，`merge.merged` 必须仍为 false。任何失败必须 `allowed=false` 并给出非空明确原因。

**验证命令**：

```bash
node sprints/08032110-kernel-pr1581-fleet-validation-r11/verify-fleet-validation.mjs --report sprints/08032110-kernel-pr1581-fleet-validation-r11/fleet-validation-report.json --check merge-gate
```

**硬阈值**：成功态只能是 `allowed=true, merged=false, reason=evaluator_and_independent_judge_passed`；禁区触碰、失败、缺席、非新鲜或漂移必须 fail closed，禁止自动放宽机器/provider 或重试到其他 candidate。

### Step 6：失败路径明确且不可旁路

**来源**：`[AI_ADDED]` — 把 PRD 的多个 fail-closed 边界固化成可执行负向 oracle，防止报告只在 happy path 自证。

**可观测行为**：Verifier 对缺 Judge、旧 run verdict、SHA 漂移、Xian 参与、callback 缺席、提前合并中的任一输入返回非 0，并在 stderr 给出对应原因码。

**验证命令**：

```bash
npx vitest run sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts --reporter=verbose
```

**硬阈值**：所有负向 fixture 都被拒绝；不得接受 404、空 verdict、历史 evidence 或 `warning` 降级。

## 接缝清单

- [接缝×2] Fleet 调度器 ↔ US M4 Runner attestation：在真实 Fleet 记录中两次核对 machine/version/admitted/fallback/Xian 字段；两次不一致判 FLAKY。
- [接缝×2] GitHub PR head ↔ Runner checkout：Final E2E 开始和双闸后分别 `git ls-remote`，两次均须与报告 checkout/expected SHA 相等；漂移立即 FAIL。
- [接缝×2] Evaluator ↔ Independent Judge ↔ merge gate：读取真实独立回执并重复执行 verifier；任一次 verdict 缺席或不同步均保持未合并。

未执行 Final E2E 前上述接缝均为 `logic-done-pending`；只有 US M4 真目标上的证据与双闸实跑后才可标 done。

## 禁 mock 边清单

- Fleet 调度派发 ↔ `us-mac-m4` Runner attestation（必须读取本 attempt 真实派发记录，禁止 fixture 替代）。
- Runner checkout ↔ GitHub PR #1581 live head（必须用 `git ls-remote --exit-code` 复核，禁止硬编码报告自证）。
- Planner/合同对抗/Generator/Evaluator/Judge 阶段 ↔ 本 run 证据链（必须真实相邻阶段回执，禁止复制历史 candidate）。
- Evaluator/Judge verdict ↔ merge gate（必须真双闸；禁止 mock PASS 或复用同一回执）。

## 真实调用方请求 shape

N/A — 本 sprint 不新增设备/agent 到业务服务端的请求，也不定义新 API。Fleet/Controller 的运行报告由执行面生成；验收只消费文件和 GitHub Git ref。若 Controller 实际通过 API 提供证据，必须保留原始 response 作为 evidence URI，不能转换成另一条旁路认证协议。

## 未覆盖真实链路清单

- Verifier 的 L2 负向合同测试使用内存 fixture｜仅验证恶意/错误报告会被拒绝，不替代任何 Fleet、GitHub、Evaluator 或 Judge 接缝｜补位：B-01 至 B-05 和 Final E2E 必须消费本 attempt 的真实报告与 live Git ref；只有这些 L3 证据可决定 merge.allowed。
- Xian 固定镜像离线 NAS 中继｜PRD 明确范围外且节点必须 drained｜补位：另行立项完成离线中继；本轮不得以未覆盖为由让 Xian 参与。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能需求 | 对 PR #1581 精确 SHA 在 US M4 跑完整 provider-neutral Pipeline，双闸后报告可合并。 |
| NFR（做得多好） | 性能/可靠性 | 7200 秒内；Runner `1.267.97`；0 次 commander 重试；全链可追溯。 |
| Invariant（永不违反） | 安全/一致性 | 不读其他 candidate、不改共享 Red、不在 blind verdict 前合并、不回退 Runner、不复用历史 verdict。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表；均用 live ref、runner attestation 和独立 verdict 交叉核对。 |
| 保质期（何时过期） | 证据有效期 | 仅对本 run/attempt 与精确 SHA 有效；PR head 或 attempt 变化立即过期。 |
| 死亡告警（停了谁知道） | 停止工作通知 | 任何阶段/callback 缺席使 verifier 非零退出并由 Harness Controller 标记失败，不静默。 |
| 失败语义（挂了怎么办） | 放行/拦截 | 全部 fail closed；不重试、不换机、不借历史 verdict，明确 reason。 |
| 效果确认（已发≠已生效） | 真实生效回执 | live PR ref + checkout SHA + 五阶段 evidence + 双独立 verdict + merge 未发生共同确认。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Runner 是否为已准入 US M4 | A. 机器名字符串；B. Fleet attestation 的 machine/version/admitted/fallback | B | 单看名称可伪造或已退准入 | 错机结果被当真并进入合并出口 |
| ⚠️ Verdict 是否新鲜且同源 | A. `fresh` 布尔；B. run_id+attempt_id+target_sha+阶段时间+独立 evidence 联合 | B | 单布尔不可防历史 verdict 复制 | 未验证代码被错误放行 |
| ⚠️ 双闸是否独立 | A. 两个 PASS 字符串；B. 不同角色、不同阶段/evidence identity 且均有逐条日志 | B | 两字符串可能来自同一回执复制 | 独立 Judge 实际缺席却错误合并 |
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

N/A — 本任务不新增对外 agent 或可写业务接口。报告仍按不可信输入解析：拒绝未知/缺失字段、重复 stage、非 40 位 SHA、非 RFC3339 时间、超时、角色 evidence identity 重用与额外 candidate。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作

高风险面:
- 错输入: 把 `observed_pr_head_sha` 改一位、删掉 Judge 的 `behavior_tests`、把 runner version 改为旧版，均须 fail closed。
- 重复提交: 同一真实报告重复验证两次结果必须一致，不得产生合并副作用。
- 中途中断: 删除 contract_gan/callback 对应阶段或令其 status=FAIL，报告必须明确缺席/失败而非 warning。
- 边界值: `elapsed_seconds=7200` 可接受，`7201` 必须拒绝；空 `log_tail`、空 evidence URI 必须拒绝。
- 对抗复制: 令 Judge 与 Evaluator 使用同一 evidence URI 或相同阶段 identity，必须拒绝。

发现分级: P0/P1（错误合并、读其他 candidate、共享 fixture 污染、SHA/机器漂移）阻塞 merge；P2/P3 记录 findings 不阻塞。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api（执行面严格亲和 `us-mac-m4`；本任务不依赖业务数据库，故不启动 schema/signup 流程）

```bash
#!/usr/bin/env bash
set -euo pipefail
SPRINT_DIR="sprints/08032110-kernel-pr1581-fleet-validation-r11"
REPORT="$SPRINT_DIR/fleet-validation-report.json"
EXPECTED_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
STARTED_AT=$(date +%s)
test -s "$REPORT"
LIVE_HEAD_1=$(git ls-remote --exit-code origin refs/pull/1581/head | awk '{print $1}')
[ "$LIVE_HEAD_1" = "$EXPECTED_SHA" ] || { echo "FAIL: sha_drift before gate live=$LIVE_HEAD_1 expected=$EXPECTED_SHA"; exit 1; }
node "$SPRINT_DIR/verify-fleet-validation.mjs" --report "$REPORT" --check affinity
node "$SPRINT_DIR/verify-fleet-validation.mjs" --report "$REPORT" --check pipeline
node "$SPRINT_DIR/verify-fleet-validation.mjs" --report "$REPORT" --check evaluator
node "$SPRINT_DIR/verify-fleet-validation.mjs" --report "$REPORT" --check judge
node "$SPRINT_DIR/verify-fleet-validation.mjs" --report "$REPORT" --check merge-gate
LIVE_HEAD_2=$(git ls-remote --exit-code origin refs/pull/1581/head | awk '{print $1}')
[ "$LIVE_HEAD_2" = "$EXPECTED_SHA" ] || { echo "FAIL: sha_drift after gate live=$LIVE_HEAD_2 expected=$EXPECTED_SHA"; exit 1; }
[ "$LIVE_HEAD_1" = "$LIVE_HEAD_2" ]
[ $(( $(date +%s) - STARTED_AT )) -le 7200 ]
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(r.merge.merged!==false)throw Error("blind verdict 前不得合并");console.log(JSON.stringify({run_id:r.run_id,attempt_id:r.attempt_id,target_sha:r.target.expected_sha,machine:r.runner.machine,evaluator:r.evaluator.status,judge:r.independent_judge.status,merge_allowed:r.merge.allowed}))' "$REPORT"
echo "OK: PR #1581 同 SHA 双闸通过且仍未合并"
```

## Test Contract

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| 严格亲和与精确 SHA | `拒绝非 US M4、版本漂移、Xian 或 SHA 漂移` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier/真实报告尚未产出，测试失败 |
| 全阶段同源追溯 | `要求五阶段属于同一 run、attempt 和目标 SHA` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier/真实报告尚未产出，测试失败 |
| Evaluator 与 Judge 双闸 | `拒绝缺失、陈旧或复制的 Evaluator 与 Judge verdict` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier/真实报告尚未产出，测试失败 |
| 合并出口 fail closed | `只有双闸和禁区核对全过才报告可合并且不执行合并` | `sprints/08032110-kernel-pr1581-fleet-validation-r11/tests/fleet-validation-report.test.ts` | verifier/真实报告尚未产出，测试失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- judgment-pending-user: Runner 是否为已准入 US M4
- judgment-pending-user: Verdict 是否新鲜且同源
- judgment-pending-user: 双闸是否独立
- 本合同只授权生成 sprint 内 verifier、测试、真实运行证据与报告；不授权修改 PR #1581 功能、共享 Red、共享 CI 或执行 merge。
