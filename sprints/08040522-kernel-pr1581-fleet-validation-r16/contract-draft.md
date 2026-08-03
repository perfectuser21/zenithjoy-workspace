# Sprint Contract Draft (Round 1)

## Notes

- 本合同只验证 PR #1581 的冻结目标头，不修改该 PR 的产品实现、不读取其他 candidate、不修改共享 Red fixture。
- `contract-gate: skipped (file not found, third-party repo)`。
- api/db/test registry 已读取；本任务无新增 HTTP/DB schema，registry 不提供本次证据格式，因此按 PRD 字面定义 `[NEW_PATTERN]`。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（端点返回 404 HTML）。
- `npm run product-map:check` 首次因 workspace 尚未安装锁定依赖 `ajv` 而 exit 1；这属于环境未就绪，不记为 PASS。
- `GAN authoring identity` 只作本轮作者 provenance；未来 Generator、Evaluator、Judge 必须各自从 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` 写入证据，禁止复制本轮 proposer 的 attempt/account/snapshot。

## Response Schema（推导来源: PRD字面 + NEW_PATTERN）

N/A — 本 Sprint 不新增 HTTP 响应或数据库 schema。验收对象是三份角色证据 JSON；字段由下方「证据格式」逐字定义。

### 证据格式

- `evidence/run-manifest.json`：稳定对象 `run_id`、`repo`、`pr_number`、`target_head_sha`、`strict_machine`、`runner_digest`、`started_at`。
- `evidence/generator.json`：`role="generator"`、稳定对象、当前角色 `provenance`、真实 checkout/test 结果、`pr_state_at_capture="OPEN"`。
- `evidence/evaluator.json`：`role="evaluator"`、自己的 `provenance`、`generator_evidence_sha256`、同一 SHA 的执行结果及失败信号。
- `evidence/judge.json`：`role="judge"`、自己的 `provenance`、Generator/Evaluator 两个 SHA-256 摘要、`verdict`、`verdict_at`、`pr_state_before_verdict="OPEN"`，并含顶层及逐行为 `exit_code`、`log_tail`、`behavior_tests`。
- 每份 `provenance` 必含 `attempt_id/provider/account/machine/model/runner_digest/capability_snapshot_id`；由该角色运行时环境写入，禁止 UUID/account/snapshot 字面固化。

## 已知约束（来自回归测试）

- `sprints/08030017-kernel-acquisition-config-recovery-181/tests/acquisition-config-effective-validation.integration.test.ts` → PR #1581 原合同以真 Router/Service/Postgres 验 effective-config 的非法零写入、合法更新、并发串行与双租户隔离。
- `apps/api/tests/routes/acquisition-dispatch.test.ts`（PR 目标头）→ `partial patch cannot make merged keyword bounds invalid` 是共享 Red fixture；本 Sprint 只能执行，不得修改。
- `[累积FR]` 本 line 暂无历史；context-manifest: unavailable（404 HTML）。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|---|---|---|
| FR（做什么） | 功能承诺 | 在严格 `us-mac-m4` 上，为 PR #1581 精确头依次生成全新 Generator、Evaluator、Judge 证据与最终 verdict。 |
| NFR（做得多好） | 性能/可靠性 | 全链 ≤7200s；runner digest 精确匹配 PRD；路由、缺证、错 SHA、测试失败均 fail-closed。 |
| Invariant（永不违反） | 安全/一致性 | 不改产品实现/共享 Red，不读其他 candidate，不提前 merge，不把失败降级为成功。 |
| 判定点（怎么知道） | 模糊现实判断 | 见下方登记表。 |
| 保质期（何时过期） | 证据有效期 | 仅对目标头 `c305f6217da65bb69413c39e621b7e797e0fb189` 和本 run 有效；PR head 变化立即作废。 |
| 死亡告警（停了谁知道） | 故障发现 | 任一角色非零退出/缺证/超时进入 Harness 失败或阻塞结果，Judge log 明确失败信号。 |
| 失败语义（挂了怎么办） | 放行/重试/降级 | fail-closed；只能恢复原严格目标后整链重跑，不换机器/账号、不复用 r15。 |
| 效果确认（已发≠已生效） | 回执 | GitHub 实时 PR 头与三份证据交叉核对；Evaluator 摘要引用 Generator，Judge 摘要引用两者。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Fleet 是否命中严格目标而非降级目标 | A. 看任务文本；B. 校验每个角色真实 provenance、routing receipt 与 `machine=us-mac-m4` | B. 真实 receipt 逐角色校验 | PRD 明确禁止换机器或账号 | 错环境假绿，直接形成错误 merge 决策 |
| ⚠️ 三方证据是否属于本 run 与同一候选头 | A. 文件名推断；B. 固定 run/head 字段并以 SHA-256 串联 | B. 字段 + 摘要链 | 文件名与历史复制均可伪造新鲜度 | 历史证据冒充、错 SHA verdict |
| ⚠️ verdict 前 PR 是否未合并 | A. 当前 state；B. 各阶段 capture + Judge 前状态与 GitHub mergedAt 时间序列 | B. 时间序列 | verdict 后允许继续决策，单看当前 state 不足 | 提前 merge 违规被漏报 |

judgment-pending-user: Fleet 是否命中严格目标而非降级目标；三方证据是否属于本 run 与同一候选头；verdict 前 PR 是否未合并（PRD 已给方法约束，本合同据此执行，无新增产品判断）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| Fleet/bridge/严格目标不可用 | 角色非零退出，记录 failure_class，流程 BLOCKED/FAIL | 恢复后用新 role attempts 整链重跑 | 禁止换机器、账号或复用旧证据 |
| PR head 变化或证据 SHA 不一致 | 当前证据全部失效，停止 verdict | 对新头整链重跑 | 禁止局部补证 |
| Generator/Evaluator 测试失败 | 保留真实 exit_code/log_tail，Judge 不得给 PASS | 修复另起 run | 禁止 warning/成功降级 |
| verdict 前 PR 已合并 | 标记流程违规并停止合格判定 | 否 | 无降级 |

### 输入对抗面

N/A：本任务不新增对外 agent；输入为冻结 Harness bundle、GitHub PR 元数据和角色证据。证据解析仍必须拒绝缺字段、额外候选、摘要错配与不合法 verdict。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## 真实调用方请求 shape

- Fleet worker 接收冻结对象：`repo=perfectuser21/zenithjoy-workspace`、`pr_number=1581`、`target_head_sha=c305f6217da65bb69413c39e621b7e797e0fb189`、`run_id=5a037785-2708-489e-9912-b20494f11fd9`、严格目标 `machine=us-mac-m4` 与 runner digest。
- 每个执行角色由 Runner 环境提供 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID`；证据中的 `provenance` 必须逐字段来自该角色自己的运行时变量。
- Evaluator 输入引用 `generator_evidence_sha256`；Judge 输入同时引用 `generator_evidence_sha256` 与 `evaluator_evidence_sha256`。禁止 body/文件内另设不受校验的 candidate SHA 或 authoring attempt 路径。

## 禁 mock 边清单

- Harness dispatcher/Fleet transport ↔ `us-mac-m4` Runner：必须真实路由并保留 receipt，禁止 fake runner/本地替代。
- Runner runtime identity ↔ 每个角色 provenance：必须由各角色自己的 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID` 写入，禁止 fixture 或复用其他角色身份。
- PR #1581 GitHub head/state ↔ checkout/verdict：必须真查 GitHub 与真 checkout，禁止固定响应替身。
- Generator 证据 ↔ Evaluator 摘要 ↔ Judge 摘要：必须对真实文件计算 SHA-256，禁止预填摘要。
- PR #1581 产品代码/共享 Red fixture ↔ 真实测试：只能在目标头执行，禁止 mock 被改 Router/Service/Postgres 边或改 fixture。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] Fleet transport → `us-mac-m4`：每个角色均校验真实 routing/provenance；任一次不一致即 FLAKY/FAIL，不得换路由。
- [接缝×2] GitHub PR 元数据 → 精确 checkout → 证据摘要链：重复查询 PR head 并核对三角色稳定对象与摘要；head 改变立即失效。
- Judge verdict → merge 时序：真查 `mergedAt` 并与 `verdict_at` 比较；verdict 前 merge 直接流程违规。

## Golden Path

覆盖父路 `line02/keyword_acquisition#step7` 第 7-7 步

[冻结 PR #1581 精确头] → [严格 Fleet Generator] → [同头 Evaluator] → [独立 Judge] → [可追溯 verdict]

### Step 1: 锁定 PR、目标头与严格 Fleet 路由
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体第 1 步与 NFR。

**可观测行为**: GitHub PR #1581 的 head 精确等于目标 SHA；Generator receipt 显示 `us-mac-m4`、固定 runner digest、无 fallback，PR 在 capture 时为 OPEN。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .state=="OPEN"'
```
**硬阈值**: head 逐字相等、state=OPEN、机器逐字为 `us-mac-m4`；任一不符 exit 非 0。

### Step 2: Generator 生成本 run 独立证据
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体第 2 步与范围限定。

**可观测行为**: Generator 从目标头真执行 PR 原合同测试，证据带当前角色 runtime provenance、真实 exit code/log_tail，不包含其他 candidate，且共享 Red fixture 与目标头字节一致。

**验证命令**:
```bash
bash -c 'F="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence/generator.json"; jq -e '\''(.role=="generator") and (.run_id=="5a037785-2708-489e-9912-b20494f11fd9") and (.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189") and (.provenance.machine=="us-mac-m4") and (.provenance.runner_digest=="sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a") and (.checks|length>0) and ([.checks[].exit_code]|all(.==0)) and (.pr_state_at_capture=="OPEN")'\'' "$F"'
```
**硬阈值**: 证据存在；所有真实 checks exit 0；固定 run/head/machine/digest 精确匹配；fixture diff check exit 0。

### Step 3: Evaluator 对同一头生成全新证据
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体第 3 步与边界情况。

**可观测行为**: Evaluator 使用自己的 attempt/capability，在同一目标头独立重跑，并引用 Generator 文件的真实 SHA-256；失败信号不可吞掉。

**验证命令**:
```bash
bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence"; G=$(shasum -a 256 "$D/generator.json"|awk "{print \\$1}"); jq -e --arg g "$G" '\''(.role=="evaluator") and (.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189") and (.generator_evidence_sha256==$g) and (.provenance.machine=="us-mac-m4") and (.checks|length>0) and ([.checks[].exit_code]|all(.==0))'\'' "$D/evaluator.json"'
```
**硬阈值**: Evaluator attempt 与 Generator attempt 不同；摘要精确；所有行为项保存 exit_code/log_tail；失败即非 0。

### Step 4: Judge 只基于本次两份证据给 verdict
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体第 4 步。

**可观测行为**: Judge 用自己的 provenance，引用 Generator/Evaluator 的真实摘要，verdict 只允许 PASS/FAIL/BLOCKED，且锚定同一目标头。

**验证命令**:
```bash
bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence"; G=$(shasum -a 256 "$D/generator.json"|awk "{print \\$1}"); E=$(shasum -a 256 "$D/evaluator.json"|awk "{print \\$1}"); jq -e --arg g "$G" --arg e "$E" '\''(.role=="judge") and (.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189") and (.generator_evidence_sha256==$g) and (.evaluator_evidence_sha256==$e) and (.verdict|IN("PASS","FAIL","BLOCKED")) and (.behavior_tests|length>=4) and ([.behavior_tests[]|has("exit_code") and has("log_tail")]|all)'\'' "$D/judge.json"'
```
**硬阈值**: 三个 attempt ID 两两不同；摘要全匹配；Judge 当前运行身份与其 evidence provenance 匹配；verdict 合法且失败不变成功。

### Step 5: verdict 前未合并并输出可决策结论
**来源**: `[FROM_PRD]` — PRD「Golden Path」具体第 5 步及边界情况。

**可观测行为**: Judge 记录 verdict 前 PR=OPEN/mergedAt=null；若之后已 merge，GitHub `mergedAt` 不早于 `verdict_at`。目标 head 改变则整链失效。

**验证命令**:
```bash
bash -c 'D="sprints/08040522-kernel-pr1581-fleet-validation-r16/evidence"; gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,mergedAt,state > /tmp/pr1581-final.json; node "$D/../tests/validate-fleet-evidence.mjs" "$D" /tmp/pr1581-final.json'
```
**硬阈值**: validator exit 0；固定 head；`pr_state_before_verdict=OPEN`、`pr_merged_at_before_verdict=null`；任何失败/阻塞保持原 verdict。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api（业务验证通过 Fleet 严格派发到 `us-mac-m4`；本脚本不依赖数据库）

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner 必须注入 Judge 当前 attempt}"
: "${HARNESS_PROVIDER:?Runner 必须注入 Judge 当前 provider}"
: "${HARNESS_ACCOUNT:?Runner 必须注入 Judge 当前 account}"
: "${HARNESS_MACHINE:?Runner 必须注入 Judge 当前 machine}"
: "${HARNESS_MODEL:?Runner 必须注入 Judge 当前 model}"
: "${HARNESS_RUNNER_DIGEST:?Runner 必须注入当前 runner digest}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner 必须注入 Judge 当前 capability snapshot}"
SPRINT_DIR="${SPRINT_DIR:-sprints/08040522-kernel-pr1581-fleet-validation-r16}"
EVIDENCE_DIR="$SPRINT_DIR/evidence"
TARGET_SHA="c305f6217da65bb69413c39e621b7e797e0fb189"
RUN_ID="5a037785-2708-489e-9912-b20494f11fd9"
EXPECTED_DIGEST="sha256:e0797f5a440d61827d1ea86afee629e6f5a687da6f958608671ba9c873e5e94a"
START=$(date +%s)
command -v gh >/dev/null && command -v jq >/dev/null && command -v shasum >/dev/null && command -v node >/dev/null || { echo "FAIL: 缺 gh/jq/shasum/node"; exit 1; }
[ "$HARNESS_MACHINE" = "us-mac-m4" ] || { echo "FAIL: Judge 错机器 $HARNESS_MACHINE"; exit 1; }
[ "$HARNESS_RUNNER_DIGEST" = "$EXPECTED_DIGEST" ] || { echo "FAIL: runner digest 错配"; exit 1; }
for f in run-manifest.json generator.json evaluator.json judge.json; do [ -s "$EVIDENCE_DIR/$f" ] || { echo "FAIL: 缺证 $f"; exit 1; }; jq -e . "$EVIDENCE_DIR/$f" >/dev/null; done
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,state,mergedAt > /tmp/pr1581-final.json
jq -e --arg h "$TARGET_SHA" '.headRefOid==$h' /tmp/pr1581-final.json >/dev/null
jq -e --arg r "$RUN_ID" --arg h "$TARGET_SHA" --arg d "$EXPECTED_DIGEST" '.run_id==$r and .repo=="perfectuser21/zenithjoy-workspace" and .pr_number==1581 and .target_head_sha==$h and .strict_machine=="us-mac-m4" and .runner_digest==$d' "$EVIDENCE_DIR/run-manifest.json" >/dev/null
G_SHA=$(shasum -a 256 "$EVIDENCE_DIR/generator.json" | awk '{print $1}')
E_SHA=$(shasum -a 256 "$EVIDENCE_DIR/evaluator.json" | awk '{print $1}')
jq -e --arg r "$RUN_ID" --arg h "$TARGET_SHA" --arg d "$EXPECTED_DIGEST" '.role=="generator" and .run_id==$r and .target_head_sha==$h and .provenance.machine=="us-mac-m4" and .provenance.runner_digest==$d and .routing.fallback_used==false and .pr_state_at_capture=="OPEN" and (.checks|length>0) and ([.checks[]|has("exit_code") and has("log_tail")]|all)' "$EVIDENCE_DIR/generator.json" >/dev/null
jq -e --arg r "$RUN_ID" --arg h "$TARGET_SHA" --arg d "$EXPECTED_DIGEST" --arg g "$G_SHA" '.role=="evaluator" and .run_id==$r and .target_head_sha==$h and .provenance.machine=="us-mac-m4" and .provenance.runner_digest==$d and .routing.fallback_used==false and .generator_evidence_sha256==$g and (.checks|length>0) and ([.checks[]|has("exit_code") and has("log_tail")]|all)' "$EVIDENCE_DIR/evaluator.json" >/dev/null
jq -e --arg r "$RUN_ID" --arg h "$TARGET_SHA" --arg d "$EXPECTED_DIGEST" --arg g "$G_SHA" --arg e "$E_SHA" --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg ac "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg mo "$HARNESS_MODEL" --arg c "$CAPABILITY_SNAPSHOT_ID" '.role=="judge" and .run_id==$r and .target_head_sha==$h and .provenance.attempt_id==$a and .provenance.provider==$p and .provenance.account==$ac and .provenance.machine==$m and .provenance.model==$mo and .provenance.runner_digest==$d and .provenance.capability_snapshot_id==$c and .generator_evidence_sha256==$g and .evaluator_evidence_sha256==$e and (.verdict|IN("PASS","FAIL","BLOCKED")) and has("exit_code") and has("log_tail") and (.behavior_tests|length>=4) and ([.behavior_tests[]|has("exit_code") and has("log_tail")]|all)' "$EVIDENCE_DIR/judge.json" >/dev/null
node "$SPRINT_DIR/tests/validate-fleet-evidence.mjs" "$EVIDENCE_DIR" /tmp/pr1581-final.json
ELAPSED=$(( $(date +%s) - START ))
[ "$ELAPSED" -le 7200 ] || { echo "FAIL: E2E 超过 7200s"; exit 1; }
echo "OK: PR #1581 严格 Fleet 三角色证据链与 verdict 验证通过 elapsed=${ELAPSED}s"
```

通过标准：命令 exit 0；PR head 精确匹配；三角色各自 runtime provenance 完整且 attempts 两两不同；均为 `us-mac-m4`/固定 runner digest/无 fallback；摘要链匹配；Judge 前 PR 未 merge；失败/阻塞 verdict 不被改写。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 在 evidence 中删除 `target_head_sha`、将 SHA 改一位、使用未知 verdict。
- 重复提交: 同一 run 重放 Generator/Evaluator 文件，确认 attempt/timestamp/摘要链能拒绝历史替换。
- 中途中断: Generator 后、Evaluator 后分别中断 Fleet/bridge，确认缺证非零且不会生成 PASS。
- 边界值: PR head 在 Evaluator 与 Judge 之间变化；PR 在 verdict 前被 merge；routing receipt 出现 fallback。
发现分级: P0/P1（错 SHA、历史证据、提前 merge、失败降级成功）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | BEHAVIOR 覆盖 | Test File | 预期红证据 |
|---|---|---|---|
| 严格 Fleet 与证据摘要链 | `严格 us-mac-m4 三角色证据链` | `tests/fleet-validation.test.ts` | evidence 目录尚无三角色文件，测试真实失败 |
| verdict 与 merge 时序 | `verdict 前保持未合并且失败不降级` | `tests/fleet-validation.test.ts` | Judge evidence 尚不存在，测试真实失败 |
| 证据格式/时间/late-bound identity | `角色 provenance 独立且时间顺序有效` | `tests/fleet-validation.test.ts` | runtime provenance 尚未生成，测试真实失败 |
