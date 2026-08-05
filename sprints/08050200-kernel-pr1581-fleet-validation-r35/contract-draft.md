# Sprint Contract Draft (Round 4)

## Notes

- contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo)
- 本轮只验证既有 Fleet Worker 链路，不授权修改 PR #1581、Harness 调度或共享 CI 基础设施。
- Runner 身份全部 late-bound；禁止固化 Proposer/Reviewer 的 attempt 或 capability snapshot。
- Round 3 closure：改用 Runner 实际注入的 task bundle 作为 Fleet 消费凭据，补齐三个字段各自的 missing/mismatch/invalid 负例，并把最终 evidence 持久化到 sprint 目录且提供 manifest 回读。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

本任务不新增 HTTP endpoint。验收入口输出：

```json
{"status":"passed|failed|environment_failed","failure_class":null,"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","run_id":"<HARNESS_RUN_ID>","attempt_id":"<HARNESS_ATTEMPT_ID>","execution_surface":"fleet-worker"}
```

- keys 精确为 `attempt_id,base_repo,base_sha,execution_surface,failure_class,gp_anchor,run_id,status,target_head_sha`。
- 输入错误：`base_repo_missing|base_repo_mismatch|target_head_sha_missing|target_head_sha_invalid|target_head_sha_mismatch|gp_anchor_missing|gp_anchor_invalid`。
- 依赖错误：`github_unavailable|postgres_unavailable`，且 `status=environment_failed`。
- 禁用字段：`repo`、`head_sha`、`anchor`、`ok`。

## 已知约束（来自回归测试与累积 FR）

- [回归测试] 仓库没有 Fleet Worker 生产源码；本 sprint 的测试只定义验收 oracle，不得自造正例 payload。
- [累积FR] 本 line 暂无历史。
- [真实派发] `${HARNESS_TASK_BUNDLE_FILE}` 的真实 envelope 是 `.task_bundle.inputs`；必须验证顶层 run/attempt、`execution_surface=fleet-worker`、workspace repo/base SHA 与 inputs 三字段。
- `git rev-parse` 必须使用 `--verify "<sha>^{commit}"`；GitHub/Postgres 错误不得降级为 passed。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 从当前 Runner 的真实 task bundle 读取 Fleet 输入，并与 Brain、GitHub、git、GP SSOT、Postgres 交叉核对后输出审计结论。 |
| NFR（做得多好） | 7200 秒内；结论记录 repo/head/anchor/base/run/attempt/execution_surface 与失败分类。 |
| Invariant（永不违反） | 不从标题或 workspace HEAD 补猜；所有负例走同一校验入口；环境错误不得报业务通过。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 仅对 PR #1581 与冻结 SHA 有效；PR head 改变即失效。 |
| 死亡告警（停了谁知道） | 入口非零退出且给唯一 failure_class，Evaluator/Judge 阻塞。 |
| 失败语义（挂了怎么办） | 输入错误 fail-closed；依赖错误 environment_failed；可幂等重跑。 |
| 效果确认（已发≠已生效） | task bundle、Brain payload、PR head、commit、GP、DB 均真读；证据落盘并能由 manifest 回读校验。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 当前执行是否真来自 Fleet Worker | 任务标题；Runner task bundle execution_surface + run/attempt | 后者 | bundle 是本次实际派发输入 | 非 Fleet 执行也会假绿 |
| ⚠️ PR #1581 head 是否匹配 | workspace HEAD；GitHub PR API | GitHub API | PRD 禁止回退 workspace HEAD | 错验提交 |
| GP 锚点是否唯一 | 文本猜测；product-map 精确查询 | SSOT 精确查询 | 产品分类唯一源 | 锚错步骤 |

PrepPRD 已明确上述判定方向。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 三字段缺失/不一致/不可解析 | `failed/<字段分类>`，非零 | 是 | 无 |
| task bundle 与当前 run/attempt/surface 不一致 | `failed/fleet_receipt_mismatch`，非零 | 是 | 无 |
| GitHub/Postgres 不可用 | `environment_failed/<依赖>_unavailable`，非零 | 是 | 恢复后重试 |
| evidence 无法写入或回读 | 非零退出 | 是 | 无，不产成功结论 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Runner task bundle / Brain payload | 不可信结构化输入 | 只读白名单 key，严格类型和值校验 | 缺失、冲突、额外替代字段均不参与补猜 |

## 真实调用方请求 shape

真实调用方是 Runner 派发给 Fleet Worker 的 task bundle：

```json
{"task_bundle":{"run_id":"<HARNESS_RUN_ID>","attempt_id":"<HARNESS_ATTEMPT_ID>","inputs":{"execution_surface":"fleet-worker","workspace_spec":{"repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d"},"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}}}
```

正例只允许从 `${HARNESS_TASK_BUNDLE_FILE}` 与 Brain 当前任务读取，禁止测试 helper 构造正例。若真实 bundle 把三字段置于 `inputs.task.payload`，入口按生产结构读取该对象；禁止从标题或 cwd 回退。

## 禁 mock 边清单

- Runner task bundle ↔ Fleet 验收入口（必须读取本次 `${HARNESS_TASK_BUNDLE_FILE}`）。
- Brain task payload ↔ GitHub PR #1581 / git object / product-map（必须真查）。
- 验收入口 ↔ Postgres（必须真连 Fleet 注入的 `DB_URL`）。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据，N/A）

## 接缝清单

- [接缝×2] Runner bundle + Brain task + GitHub PR head：正例重复两次，任一次不一致即 FLAKY。
- Postgres：真连 attempt-scoped `DB_URL`；不可用只能是 environment_failed。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[入口] Fleet Worker 收到真实 task bundle → 校验冻结对象 → [出口] 持久化可回读审计结论

### Step 1: 证明真实 Fleet Worker 消费了正确 payload
**来源**: `[FROM_PRD]` — Golden Path 第 1 项。

**可观测行为**: 当前 bundle 的 run/attempt 与 Runner 环境一致、execution_surface 为 fleet-worker，三字段逐字匹配；Brain 持久化 payload 同值。

**验证命令**:
```bash
bash -c 'set -euo pipefail; : "${HARNESS_TASK_BUNDLE_FILE:?}" "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}" "${BRAIN_URL:?}" "${HARNESS_TASK_ID:?}"; jq -e --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" '\'' .task_bundle.run_id==$r and .task_bundle.attempt_id==$a and .task_bundle.inputs.execution_surface=="fleet-worker" '\'' "$HARNESS_TASK_BUNDLE_FILE"; node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e '\''.status=="passed" and .execution_surface=="fleet-worker"'\'''
```
**硬阈值**: bundle identity/surface 3/3 与目标字段 3/3 匹配；Brain 同值；exit 0。

### Step 2: 校验冻结目标
**来源**: `[FROM_PRD]` — Golden Path 第 2 项。

**可观测行为**: base/target 是真实 commit，GitHub head 等于 target，GP step 唯一，Postgres 可达。

**验证命令**:
```bash
bash -c 'set -euo pipefail; T=c305f6217da65bb69413c39e621b7e797e0fb189; B=676fed7de12023d355deac7849af8a525ae53f8d; git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; test "$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)" = "$T"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json; psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc "SELECT 1" | grep -qx 1'
```
**硬阈值**: 五项全部 exit 0；依赖失败不得跳过。

### Step 3: 产出并回读持久化审计证据
**来源**: `[FROM_PRD]` — Golden Path 第 3 项“可审计验收结论”。

**可观测行为**: evidence 目录保留两份正例、负例日志、identity 元数据和 SHA-256 manifest；重新读取 manifest 时全通过。

**验证命令**:
```bash
bash -c 'set -euo pipefail; D="sprints/08050200-kernel-pr1581-fleet-validation-r35/evidence/$HARNESS_ATTEMPT_ID"; test -s "$D/positive-1.json"; test -s "$D/positive-2.json"; test -s "$D/negative.log"; test -s "$D/identity.json"; (cd "$D" && sha256sum -c SHA256SUMS)'
```
**硬阈值**: 4 个证据文件可回读且 manifest 4/4 OK；exit 0。

### Step 4: 所有 PRD 错误输入精确失败
**来源**: `[FROM_PRD]` — 三组边界情况及两类依赖失败。

**可观测行为**: 同一入口覆盖 repo 缺失/错值、SHA 缺失/非完整/错 head、anchor 缺失/不可解析、GitHub/Postgres 不可用；9/9 非零且无 passed。

**验证命令**:
```bash
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh
```
**硬阈值**: 9/9 failure_class 逐字匹配；所有子进程非零；汇总 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${BRAIN_URL:?}" "${DB_URL:?}" "${HARNESS_TASK_ID:?}" "${HARNESS_TASK_BUNDLE_FILE:?}"
: "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}" "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}" "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
EVIDENCE_DIR="sprints/08050200-kernel-pr1581-fleet-validation-r35/evidence/$HARNESS_ATTEMPT_ID"
rm -rf "$EVIDENCE_DIR"
mkdir -p "$EVIDENCE_DIR"
jq -n --arg run "$HARNESS_RUN_ID" --arg attempt "$HARNESS_ATTEMPT_ID" --arg provider "$HARNESS_PROVIDER" --arg account "$HARNESS_ACCOUNT" --arg machine "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg runner "$HARNESS_RUNNER_DIGEST" --arg snapshot "$CAPABILITY_SNAPSHOT_ID" '{run_id:$run,attempt_id:$attempt,provider:$provider,account:$account,machine:$machine,model:$model,runner_digest:$runner,capability_snapshot_id:$snapshot}' > "$EVIDENCE_DIR/identity.json"
for n in 1 2; do
  node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" > "$EVIDENCE_DIR/positive-$n.json"
  jq -e --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" '.status=="passed" and .failure_class==null and .execution_surface=="fleet-worker" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .run_id==$r and .attempt_id==$a' "$EVIDENCE_DIR/positive-$n.json"
done
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh | tee "$EVIDENCE_DIR/negative.log"
npx vitest run sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts --reporter=verbose
(cd "$EVIDENCE_DIR" && sha256sum identity.json negative.log positive-1.json positive-2.json > SHA256SUMS && sha256sum -c SHA256SUMS)
echo "PASS: evidence=$EVIDENCE_DIR"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 正例 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `真实 Fleet bundle 与当前 attempt 绑定冻结目标` | acceptance 入口不存在，ENOENT |
| Fleet 负例 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `九种错误均由同一入口给出精确失败分类` | acceptance 入口不存在，ENOENT |
| 审计回读 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `持久化证据 manifest 可回读` | evidence/manifest 不存在 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: bundle envelope 错层、repo 大小写、SHA 39/41 位、anchor step07
- 重复提交: 正例连续执行两次，结论一致
- 中途中断: GitHub/Postgres 断开不得留下新的 passed evidence
- 边界值: payload 为 null/数组/多余替代字段
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。
