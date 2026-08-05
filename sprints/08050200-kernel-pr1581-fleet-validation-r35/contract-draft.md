# Sprint Contract Draft (Round 5)

## Notes

- contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo)
- 本合同只验证既有 Fleet Worker 对 Brain task payload 的消费；不修改 PR #1581、Harness 调度或共享 CI 基础设施。
- GAN authoring task bundle 只提供本轮作者 provenance；未来 Evaluator/Judge 身份全部从 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。
- 当前 Proposer bundle 的 `.task_bundle.inputs.workspace_spec` 是工作区控制面，不是被验业务 payload；权威业务字段来自认证的 `GET /api/brain/tasks/$HARNESS_TASK_ID` 响应 `.payload`。

## Round 4 blocker closure

| 编号 | closure |
|---|---|
| R4-1 | 将真实调用方 shape 改为冻结 task bundle 实际结构：bundle 只绑定 task/run/attempt/workspace，业务三字段从 Brain task `.payload` 读取；删掉不存在的 `.task_bundle.inputs.base_repo/target_head_sha/gp_anchor`。这消除了合同与冻结 bundle 的结构冲突。 |
| R4-2 | E2E 首步新增仓库真实 `apps/api` migration，并用 `to_regclass` 机检空库 schema；之后所有 Postgres oracle 只使用同一个 Fleet 注入 `DB_URL`。本任务不创建业务用户或 session，故 signup/login N/A。 |
| R4-3 | ARTIFACT 改为 `node --check`、`bash -n` 和测试名内容断言，缺内容或语法错误即失败，不再只看文件存在。 |
| R4-4 | 范围断言基线改为 Runner 的 `HARNESS_WORKSPACE_START_SHA`，并核对其等于冻结 workspace `base_sha=49fa4e...`；PRD 的业务比较基线 `676fed...` 仅在业务 payload/验收中使用，不再冒充本工作区 git diff 基线。 |

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

本任务不新增 HTTP endpoint。Fleet 验收入口 stdout 必须是且仅是：

```json
{"status":"passed|failed|environment_failed","failure_class":null,"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","run_id":"<当前 HARNESS_RUN_ID>","attempt_id":"<当前 HARNESS_ATTEMPT_ID>","execution_surface":"fleet-worker"}
```

- 顶层 keys 精确为 `attempt_id,base_repo,base_sha,execution_surface,failure_class,gp_anchor,run_id,status,target_head_sha`。
- 输入失败分类：`base_repo_missing|base_repo_mismatch|target_head_sha_missing|target_head_sha_invalid|target_head_sha_mismatch|gp_anchor_missing|gp_anchor_invalid`。
- 依赖失败分类：`github_unavailable|postgres_unavailable`，且 `status=environment_failed`。
- 禁用字段：`repo`、`head_sha`、`anchor`、`ok`。

## 已知约束（来自回归测试与累积 FR）

- [回归测试] 仓库当前没有 Fleet Worker 验收实现或对应测试，按 PRD 字面定义 `[NEW_PATTERN]`。
- [累积FR] 本 line 暂无历史。
- [真实派发] authoring bundle 的 `.task_bundle.inputs.workspace_spec` 只描述当前工作区；Brain task `.payload` 才含 `base_repo`、`target_head_sha`、`gp_anchor` 与业务 `base_sha`。
- `git rev-parse` 必须使用 `--verify "<sha>^{commit}"`；GitHub/Postgres 错误不得降级为 passed。

## 八要素需求规范

| 要素 | 本次答案（必填，可 N/A） |
|---|---|
| FR（做什么） | 从 Brain 当前 task payload 读取三字段，与 PR、git、GP SSOT、Postgres 交叉核对并输出审计结论。 |
| NFR（做得多好） | 7200 秒内；结论记录 repo/head/anchor/base/run/attempt/surface 与失败分类。 |
| Invariant（永不违反） | 不从标题、thin PRD 文本或 workspace HEAD 补猜；环境错误不得报业务通过。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 只对 PR #1581 和冻结 head 有效；PR head 改变即失败。 |
| 死亡告警（停了谁知道） | 入口非零退出并给唯一 failure_class，Evaluator/Judge 阻塞。 |
| 失败语义（挂了怎么办） | 输入错误 fail-closed；依赖错误 environment_failed；可幂等重跑。 |
| 效果确认（已发≠已生效） | Brain payload、PR head、git commit、GP SSOT、已 bootstrap 的 DB 均真读，证据带 SHA-256。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 业务 payload 位于何处 | authoring bundle inputs；Brain task payload | Brain task payload | 当前冻结输入与 Brain 实际响应证明二者职责不同 | 验不存在字段导致全链假失败 |
| ⚠️ PR #1581 head 是否匹配 | workspace HEAD；GitHub PR API | GitHub API | PRD 明确禁止回退 workspace HEAD | 错验提交 |
| GP 锚点是否唯一 | 文本猜测；product-map 精确查询 | SSOT 精确查询 | 产品分类唯一源 | 锚错步骤 |

PrepPRD 已明确 PR/head/anchor 的判定方向；payload 层级由本轮真实派发证据校正。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 三字段缺失/不一致/不可解析 | `failed/<字段分类>`，非零 | 是 | 无 |
| bundle task/run/attempt/surface 与 Runner 不一致 | `failed/fleet_receipt_mismatch`，非零 | 是 | 无 |
| GitHub/Postgres 不可用 | `environment_failed/<依赖>_unavailable`，非零 | 是 | 恢复后重试 |
| evidence 无法写入或回读 | 非零退出 | 是 | 无，不产成功结论 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Brain task payload | 不可信结构化输入 | 只读白名单 key，严格类型和值校验 | 缺失、冲突或替代字段均不补猜 |

## 真实调用方请求 shape

Runner 的冻结 authoring envelope 与业务 payload 是两层数据，必须分别验证：

```json
{"task_bundle":{"run_id":"<当前 HARNESS_RUN_ID>","attempt_id":"<当前 HARNESS_ATTEMPT_ID>","inputs":{"task_id":"<当前 HARNESS_TASK_ID>","execution_surface":"fleet-worker","workspace_spec":{"repo":"perfectuser21/zenithjoy-workspace","base_sha":"<HARNESS_WORKSPACE_START_SHA>","frozen_baseline":true}}}}
```

Fleet 内网请求 `GET $BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID` 的生产响应关键 shape（当前真实调用无需额外请求 body 或自造 header）：

```json
{"id":"<当前 HARNESS_TASK_ID>","payload":{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","target_pr_url":"https://github.com/perfectuser21/zenithjoy-workspace/pull/1581","target_environment":"local_api"}}
```

DoD 逐字段读取 `.payload`；禁止把 callback token 误当查询认证、禁止从 title、thin_prd、cwd 或 workspace HEAD 回退。

## 禁 mock 边清单

- Runner task bundle ↔ Fleet 验收入口（必须读取当前 `${HARNESS_TASK_BUNDLE_FILE}`，不得 mock）。
- Brain task payload ↔ GitHub PR #1581 / git object / product-map（必须真查）。
- migration ↔ attempt-scoped Postgres（必须对同一个 `DB_URL` 真跑并查 schema）。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据，N/A）

## 接缝清单

- [接缝×2] Brain payload + GitHub PR head：正例重复两次，任一次不一致即 FLAKY。
- Postgres：对 attempt-scoped 空库先真实 migration，再由验收入口真连；不可用只能 environment_failed。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[入口] Fleet Worker 收到真实 task receipt → 从 Brain 读取业务 payload → 校验冻结对象 → [出口] 持久化可回读审计结论

### Step 1: 证明真实 Fleet receipt 与 Brain payload 各司其职
**来源**: `[FROM_PRD]` — Golden Path 第 1 项；payload 层级由当前冻结派发 shape 校正。

**可观测行为**: bundle 只绑定当前 task/run/attempt/workspace；三项业务字段从 Brain `.payload` 读取且逐字匹配。

**验证命令**:
```bash
bash -c 'set -euo pipefail; : "${HARNESS_TASK_BUNDLE_FILE:?}" "${HARNESS_TASK_ID:?}" "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}"; jq -e --arg t "$HARNESS_TASK_ID" --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" '\'' .task_bundle.inputs.task_id==$t and .task_bundle.run_id==$r and .task_bundle.attempt_id==$a and .task_bundle.inputs.execution_surface=="fleet-worker" '\'' "$HARNESS_TASK_BUNDLE_FILE"; node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e '\''.status=="passed"'\'''
```
**硬阈值**: receipt 4/4、payload 3/3 全匹配；exit 0。

### Step 2: 校验业务基线、目标和 GP
**来源**: `[FROM_PRD]` — Golden Path 第 2 项。

**可观测行为**: Brain payload base/target 是真实 commit，GitHub head 等于 target，GP step 唯一，Postgres schema 已初始化。

**验证命令**:
```bash
bash -c 'set -euo pipefail; P=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -ec .payload); B=$(jq -r .base_sha <<<"$P"); T=$(jq -r .target_head_sha <<<"$P"); git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; test "$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)" = "$T"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json; psql "$DB_URL" -XtAc "SELECT to_regclass('"'"'zenithjoy.schema_migrations'"'"') IS NOT NULL" | grep -qx t'
```
**硬阈值**: 五项全部 exit 0；依赖失败不得跳过。

### Step 3: 产出并回读持久化审计证据
**来源**: `[FROM_PRD]` — Golden Path 第 3 项“可审计验收结论”。

**可观测行为**: attempt 独享目录保留两份正例、负例日志、identity 元数据和 SHA-256 manifest。

**验证命令**:
```bash
bash -c 'set -euo pipefail; D="sprints/08050200-kernel-pr1581-fleet-validation-r35/evidence/$HARNESS_ATTEMPT_ID"; test -s "$D/SHA256SUMS"; (cd "$D" && sha256sum -c SHA256SUMS)'
```
**硬阈值**: manifest 4/4 OK；exit 0。

### Step 4: 所有 PRD 错误输入精确失败
**来源**: `[FROM_PRD]` — 三组边界情况及两类依赖失败。

**可观测行为**: repo 缺失/错值、SHA 缺失/非完整/错 head、anchor 缺失/不可解析、GitHub/Postgres 不可用均非零且无 passed。

**验证命令**:
```bash
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh
```
**硬阈值**: 9/9 failure_class 逐字匹配；汇总 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}" "${BRAIN_URL:?}" "${HARNESS_TASK_ID:?}" "${HARNESS_TASK_BUNDLE_FILE:?}"
: "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}" "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}" "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
: "${HARNESS_WORKSPACE_START_SHA:?}"
test "$HARNESS_WORKSPACE_START_SHA" = "49fa4ebddde73b8f3d2d800793f2a13c79434b06"
export DATABASE_URL="$DB_URL"
npm --prefix apps/api run migrate
psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc "SELECT to_regclass('zenithjoy.schema_migrations') IS NOT NULL" | grep -qx t
EVIDENCE_DIR="sprints/08050200-kernel-pr1581-fleet-validation-r35/evidence/$HARNESS_ATTEMPT_ID"
mkdir -p "$EVIDENCE_DIR"
rm -f "$EVIDENCE_DIR"/*
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

本任务不启动业务 API、不创建租户或 session；Postgres 仅用于依赖与 schema bootstrap 验证，因此 signup/login 自举不适用。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 正例 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `从 Brain payload 读取三字段并绑定当前 receipt` | acceptance 入口不存在，ERR_MODULE_NOT_FOUND |
| Fleet 负例 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `缺失和篡改均精确失败且不回退` | acceptance 入口不存在，ERR_MODULE_NOT_FOUND |
| DB bootstrap | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `空库 migration 后 schema 可验证` | acceptance 入口不存在，ERR_MODULE_NOT_FOUND |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: Brain payload 为 null、repo 大小写、SHA 39/41 位、anchor step07
- 重复提交: 正例连续执行两次，结论一致
- 中途中断: migration、GitHub 或 Postgres 断开不得留下新的 passed evidence
- 边界值: payload 有同义替代字段但权威字段缺失
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。
