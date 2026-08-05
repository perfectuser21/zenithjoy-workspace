# Sprint Contract Draft (Round 3)

## Notes

- contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo)
- 本轮删除 Round 2 自造 receipt 的验证路径。正例唯一事实源改为 Brain 中当前 `harness_initiative` 及 Runner 为该 attempt 注入的真实身份；负例必须调用同一校验入口并检查结构化失败分类。
- 本合同只验证既有 Fleet Worker 链路，不授权修改 PR #1581、Harness 调度或共享 CI 基础设施。
- validation identity 只从 Evaluator 实际执行时的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

本任务不新增 HTTP endpoint。Fleet 验收入口 `tests/fleet-worker-acceptance.mjs` 必须输出：

```json
{"status":"passed|failed|environment_failed","failure_class":null,"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","run_id":"<HARNESS_RUN_ID>","attempt_id":"<HARNESS_ATTEMPT_ID>"}
```

- 顶层 keys 精确为 `attempt_id,base_repo,base_sha,failure_class,gp_anchor,run_id,status,target_head_sha`。
- 输入错误：`status=failed` 且 `failure_class` 为 `base_repo_mismatch|target_head_sha_invalid|target_head_sha_mismatch|gp_anchor_invalid`。
- GitHub/Postgres 不可用：`status=environment_failed` 且 `failure_class=github_unavailable|postgres_unavailable`。
- 禁用字段：`repo`、`head_sha`、`anchor`、`ok`。

## 已知约束（来自回归测试与累积 FR）

- [回归测试] 仓库没有 Fleet Worker 生产源码；测试必须从 Brain 当前任务记录和 Runner 当前 attempt 取证，不得把仓内测试 helper 冒充 Worker。
- [累积FR] 本 line 暂无历史。
- [真实派发核对] Brain 当前任务 payload 已含 `base_repo`、`target_head_sha`、`gp_anchor`；Round 2 错把 `${HARNESS_TASK_BUNDLE_FILE}` 当成 `.inputs` 根对象，实际文件 envelope 为 `.task_bundle.inputs`。
- `git rev-parse` 必须带 `--verify "<sha>^{commit}"`；GitHub/Postgres 错误不得降级为 passed。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 真查当前 Harness Initiative、当前 Fleet attempt、GitHub PR head、git commits、GP SSOT 与 Postgres，再给出绑定同一目标的结论。 |
| NFR（做得多好） | 7200 秒内；结论记录 repo/head/anchor/base、run/attempt 与失败分类。 |
| Invariant（永不违反） | 不从标题或 workspace HEAD 补猜；所有负例走与正例相同的校验函数；环境错误不得报业务通过。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 仅对 PR #1581 和冻结 SHA 有效；PR head 改变即失效。 |
| 死亡告警（停了谁知道） | 入口非零退出并输出唯一 failure_class，Evaluator/Judge 收账阻塞。 |
| 失败语义（挂了怎么办） | 输入错误 fail-closed；依赖错误 environment_failed；可幂等重跑。 |
| 效果确认（已发≠已生效） | 必须同时看到 Brain 持久化 payload、当前 attempt 身份、PR head、commit、GP 与 Postgres 真响应。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 当前 Fleet Worker 是否真的消费该任务 | 仓内 helper 输出；Brain task + Runner attempt 身份联合取证 | 后者 | helper 自证不能证明真实派发 | 未跑 Worker 也会假绿 |
| ⚠️ PR #1581 head 是否匹配 | workspace HEAD；GitHub PR API `.head.sha` | GitHub API | PRD 明禁回退 workspace HEAD | 错验提交 |
| GP 锚点是否唯一 | 文本匹配；product-map 精确查询 | SSOT 精确查询 | 分类唯一源 | 锚错步骤 |

PrepPRD 已明确拍板以上判定方法。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| repo 缺失/不一致 | `failed/base_repo_mismatch`，非零 | 是 | 无 |
| SHA 非 40 位或与 PR head 不同 | `failed/target_head_sha_invalid|target_head_sha_mismatch`，非零 | 是 | 无 |
| anchor 缺失/不唯一 | `failed/gp_anchor_invalid`，非零 | 是 | 无 |
| GitHub/Postgres 不可用 | `environment_failed/github_unavailable|postgres_unavailable`，非零 | 是 | 恢复后重试 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Brain task payload | 不可信结构化输入 | 只读取三个白名单 key，严格类型和值校验 | 额外字段不参与选目标；缺失/冲突即失败 |

## 真实调用方请求 shape

真实生产调用方是 Brain 持久化的 `harness_initiative.payload`：

```json
{"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_environment":"local_api"}
```

正例通过 `GET $BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID` 真读此 shape；Runner 当前 attempt 则由 `HARNESS_TASK_ID/HARNESS_RUN_ID/HARNESS_ATTEMPT_ID` 关联。测试 helper 只负责断言，禁止自行构造正例 receipt。

## 禁 mock 边清单

- Brain 当前 Harness Initiative ↔ Fleet Runner 当前 attempt（必须真调 Brain 并核对 Runner 注入身份）。
- task payload ↔ GitHub PR #1581 / git object / product-map（必须真查）。
- 校验入口 ↔ Postgres（必须真连同一 `DB_URL`）。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据，N/A）

## 接缝清单

- [接缝×2] Brain task + GitHub PR head：正例重复两次，任一次不一致即 FLAKY。
- Postgres：只验证 Fleet 注入的 attempt-scoped `DB_URL` 可达；不可用分类为 environment_failed。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[入口] Brain 持久化 Harness Initiative → Fleet Runner 当前 attempt 消费 → 校验冻结目标 → [出口] 结构化验收结论

### Step 1: 证明真实 Fleet Worker 收到了 Brain 任务
**来源**: `[FROM_PRD]` — Golden Path 第 1 项。

**可观测行为**: Brain 当前任务为 `harness_initiative`，payload 三字段精确；返回 task id 与 Runner 当前 `HARNESS_TASK_ID` 相同，当前 run/attempt 变量非空。

**验证命令**:
```bash
bash -c 'set -euo pipefail; : "${BRAIN_URL:?}" "${HARNESS_TASK_ID:?}" "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}"; for n in 1 2; do curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -e --arg id "$HARNESS_TASK_ID" '\''.id==$id and .task_type=="harness_initiative" and .payload.base_repo=="perfectuser21/zenithjoy-workspace" and .payload.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .payload.gp_anchor=="line02/keyword_acquisition#step7"'\''; done'
```
**硬阈值**: 两次 3/3 字段和 task identity 全匹配；exit 0。

### Step 2: 真实校验冻结目标
**来源**: `[FROM_PRD]` — Golden Path 第 2 项。

**可观测行为**: base/target 都是 commit，GitHub head 等于 target，GP step 唯一，Postgres 可达。

**验证命令**:
```bash
bash -c 'set -euo pipefail; T=c305f6217da65bb69413c39e621b7e797e0fb189; B=676fed7de12023d355deac7849af8a525ae53f8d; git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; test "$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)" = "$T"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json; psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc "SELECT 1" | grep -qx 1'
```
**硬阈值**: 五项全部 exit 0；任何依赖失败不得跳过。

### Step 3: 从同一入口输出可审计结论
**来源**: `[FROM_PRD]` — Golden Path 第 3 项。

**可观测行为**: 入口真查 Brain/GitHub/git/SSOT/Postgres 后输出精确 schema，并绑定当前 run/attempt。

**验证命令**:
```bash
node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" | jq -e --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" 'keys==["attempt_id","base_repo","base_sha","failure_class","gp_anchor","run_id","status","target_head_sha"] and .status=="passed" and .failure_class==null and .run_id==$r and .attempt_id==$a'
```
**硬阈值**: keys 完整、目标 4/4、run/attempt 2/2 精确；exit 0。

### Step 4: 每个错误输入得到真实失败分类
**来源**: `[FROM_PRD]` — 边界情况。

**可观测行为**: 同一入口的 `--payload-json` 注入只替换输入，不绕过校验逻辑；六组负例均非零并输出唯一分类，绝不出现 passed。

**验证命令**:
```bash
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh
```
**硬阈值**: 6/6 分类逐字匹配，所有子进程非零，矩阵汇总 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${BRAIN_URL:?}" "${DB_URL:?}" "${HARNESS_TASK_ID:?}" "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}"
: "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}" "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
EVIDENCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$EVIDENCE_DIR"' EXIT
for n in 1 2; do
  node sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.mjs --task-id "$HARNESS_TASK_ID" > "$EVIDENCE_DIR/positive-$n.json"
  jq -e --arg r "$HARNESS_RUN_ID" --arg a "$HARNESS_ATTEMPT_ID" 'keys==["attempt_id","base_repo","base_sha","failure_class","gp_anchor","run_id","status","target_head_sha"] and .status=="passed" and .failure_class==null and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .run_id==$r and .attempt_id==$a' "$EVIDENCE_DIR/positive-$n.json"
done
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-negative-matrix.sh | tee "$EVIDENCE_DIR/negative.log"
npx vitest run sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts --reporter=verbose
sha256sum "$EVIDENCE_DIR"/*
echo 'PASS: 真实 Fleet task/attempt 与冻结 PR 目标绑定，负例分类 6/6'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 正例全链 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `真实 Fleet task 与当前 attempt 绑定冻结目标` | acceptance 入口不存在，ENOENT |
| Fleet 负例分类 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-worker-acceptance.test.ts` | `六种错误均由同一入口给出精确失败分类` | acceptance 入口不存在，ENOENT |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: repo 大小写、SHA 39/41 位、anchor step07
- 重复提交: 正例连续执行两次，结论一致
- 中途中断: GitHub/Postgres 断开不得残留 passed
- 边界值: payload 为 null/数组/多余字段
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。
