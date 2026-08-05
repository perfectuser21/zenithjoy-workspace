# Sprint Contract Draft (Round 8)

## Notes

- contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo)
- 本轮保留直接读取 Fleet Worker 生产输入的路线，并把每个失败分支收束为真实、可捕获的结构化验收回执；成功回执只能在全部生产证据通过后由同一验收进程输出，删除无条件 `jq -n` 自造成功结论。
- 本合同只验证既有 Fleet Worker；不修改 PR #1581 的业务实现、Harness 调度策略或共享 CI 基础设施。
- validation identity 全部从实际执行角色的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。

## Round 7 feedback closure

| 反馈 | closure |
|---|---|
| 错误输入及依赖故障仅导致 shell 非零，没有输出或校验 PRD 要求的 status/failure_class | E2E 增加统一 `finish`/`fail_input`/`fail_environment` 回执协议；七类输入错误分别输出 `status=failed` 和稳定 `failure_class`，GitHub/Postgres 故障输出 `status=environment_failed`。负向矩阵逐项捕获并用 jq 校验实际 stdout 与非零 exit。 |
| 成功结论由测试侧 `jq -n` 自造 | 删除无条件 `jq -n`。同一验收进程先真读 Brain/Fleet bundle、checkout、GitHub、GP 与 Postgres并固化证据；只有全部断言完成才输出 passed 回执和证据 SHA-256，任何前置断言失败均由 trap 输出失败回执。 |

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

本任务不新增 HTTP endpoint。E2E 验收进程 stdout 的最后一行是实际验收回执（不是测试夹具）：

```json
{"status":"passed|failed|environment_failed","failure_class":"none|<稳定分类>","base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","run_id":"<HARNESS_RUN_ID>","attempt_id":"<HARNESS_ATTEMPT_ID>","execution_surface":"fleet-worker","evidence_sha256":"<64位小写hex>"}
```

- keys 精确为 `attempt_id,base_repo,base_sha,evidence_sha256,execution_surface,failure_class,gp_anchor,run_id,status,target_head_sha`。
- 输入失败：`base_repo_missing|base_repo_mismatch|target_head_sha_missing|target_head_sha_invalid|target_head_sha_mismatch|gp_anchor_missing|gp_anchor_invalid`。
- 依赖失败：`brain_unavailable|github_unavailable|postgres_unavailable|node_dependencies_unavailable`，对应 `status=environment_failed`。
- 禁用字段：`repo`、`head_sha`、`anchor`、`ok`。

## 已知约束（来自回归测试与累积 FR）

- [回归测试] 仓库没有 Fleet Worker 生产实现；它属于 Fleet execution surface，不能用 sprint-local helper 代替。
- [累积FR] 本 line 暂无历史。
- [真实派发] Brain task `.payload` 是业务权威输入；Fleet Worker 产出的 `HARNESS_TASK_BUNDLE_FILE` 与实际 checkout 是生产消费结果。
- ref 检查必须使用 `git rev-parse --verify "<ref>^{commit}"`；GitHub/Postgres 失败不得降级为 passed。

## 八要素需求规范

| 要素 | 本次答案（必填，可 N/A） |
|---|---|
| FR（做什么） | 对账 Brain payload、Fleet bundle、实际 checkout、GitHub PR 与 GP SSOT。 |
| NFR（做得多好） | 7200 秒内；结论保留 repo/base/head/anchor/failure_class。 |
| Invariant（永不违反） | 不从标题、thin_prd 或 cwd 猜字段；不以 sprint-local helper 代替 Worker。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | PR #1581 head 改变即失效。 |
| 死亡告警（停了谁知道） | oracle 非零退出，Evaluator/Judge 阻塞。 |
| 失败语义（挂了怎么办） | 输入错误 fail-closed；依赖错误 environment_failed；无成功兜底。 |
| 效果确认（已发≠已生效） | bundle 与 checkout 必须证明 Worker 真消费，而非只证明 Brain 存了字段。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Fleet Worker 是否消费 target | 检查本地测试输出；检查 Worker bundle + checkout | Worker bundle + checkout | 两者是生产执行结果 | 未消费字段却误报通过 |
| ⚠️ PR head 是否匹配 | workspace HEAD；GitHub PR API | 二者均须等于 payload target | PRD 禁止回退当前 HEAD | 错验提交 |
| GP 锚点是否唯一 | 文本 grep；product-map 精确查询 | SSOT 精确查询 | 分类唯一源 | 锚错步骤 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| bundle 缺字段或与 Brain 不一致 | failed/对应字段分类，非零 | 是 | 无 |
| checkout 或 PR head 不等于 target | failed/target_head_sha_mismatch，非零 | 是 | 无 |
| GitHub/Postgres 不可用 | environment_failed，非零 | 是 | 恢复后重试 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Brain task payload | 不可信结构化输入 | 只读白名单 key，严格类型和值 | 缺失、冲突不补猜 |

## 真实调用方请求 shape

Brain 生产 task：

```json
{"id":"<HARNESS_TASK_ID>","payload":{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","target_pr_url":"https://github.com/perfectuser21/zenithjoy-workspace/pull/1581"}}
```

Fleet Worker 生产 task bundle 的关键消费结果：

```json
{"task_bundle":{"inputs":{"task_id":"<HARNESS_TASK_ID>","execution_surface":"fleet-worker","workspace_spec":{"repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","expected_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","frozen_baseline":true},"gp_anchor":"line02/keyword_acquisition#step7"}}}
```

DoD 直接比较这两份生产对象；`thin_prd` 中出现相同文本不算消费证据。

## 禁 mock 边清单

- Brain task payload ↔ Fleet Worker task bundle（不得 mock 或用 sprint-local helper 重算）。
- Fleet Worker workspace_spec ↔ 实际 git checkout（必须真查 commit）。
- target_head_sha ↔ GitHub PR #1581 head（必须真调 GitHub）。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据，N/A）

## 接缝清单

- [接缝×2] Brain payload → Fleet bundle → checkout：重复对账两次，任一次不同即 FLAKY。
- [接缝×2] GitHub PR head：重复真查两次，任一次不同即 FLAKY。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[入口] Brain 含结构化 payload → Fleet Worker 物化 bundle 与 checkout → [出口] 结论绑定同一 PR head 和 GP

### Step 1: Fleet Worker 生产入口消费三项字段
**来源**: `[FROM_PRD]` — Golden Path 第 1 项。

**可观测行为**: Brain payload 的 repo/base/head/anchor 原样进入 Fleet bundle；禁止从 `thin_prd` 回填。

**验证命令**:
```bash
bash -c 'set -euo pipefail; P=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -ec .payload); jq -e --arg repo "$(jq -r .base_repo <<<"$P")" --arg base "$(jq -r .base_sha <<<"$P")" --arg head "$(jq -r .target_head_sha <<<"$P")" --arg anchor "$(jq -r .gp_anchor <<<"$P")" '\'' .task_bundle.inputs.execution_surface=="fleet-worker" and .task_bundle.inputs.workspace_spec.repo==$repo and .task_bundle.inputs.workspace_spec.base_sha==$base and .task_bundle.inputs.workspace_spec.expected_head_sha==$head and .task_bundle.inputs.gp_anchor==$anchor '\'' "$HARNESS_TASK_BUNDLE_FILE"'
```
**硬阈值**: 5/5 字段相等；exit 0。

### Step 2: 冻结 checkout 与 PR head 精确绑定
**来源**: `[FROM_PRD]` — Golden Path 第 2 项。

**可观测行为**: target/base 均是 commit；实际 checkout 与 GitHub PR head 都等于 target，不回退 workspace 隐含 HEAD。

**验证命令**:
```bash
bash -c 'set -euo pipefail; P=$(curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -ec .payload); B=$(jq -r .base_sha <<<"$P"); T=$(jq -r .target_head_sha <<<"$P"); git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; git rev-parse --verify HEAD | grep -qx "$T"; for n in 1 2; do gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha | grep -qx "$T"; done'
```
**硬阈值**: commit 3/3、GitHub 2/2；exit 0。

### Step 3: GP 唯一且审计结论完整
**来源**: `[FROM_PRD]` — Golden Path 第 3 项。

**可观测行为**: anchor 唯一解析到 Step 7；结论含九个精确 key 和 late-bound identity。

**验证命令**:
```bash
bash -c 'set -euo pipefail; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json; : "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}" "${CAPABILITY_SNAPSHOT_ID:?}"'
```
**硬阈值**: GP 命中恰好 1；identity 变量 3/3 非空。

### Step 4: 生产入口错误输入 fail-closed
**来源**: `[FROM_PRD]` — 边界情况。

**可观测行为**: 当前 Fleet bundle 与 Brain payload 任一缺失/不一致都会使同一对账 oracle 非零，不存在 404、文本或 helper 旁路。

**验证命令**:
```bash
npx vitest run sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-production-receipt.test.ts --reporter=verbose
```
**硬阈值**: 3 tests 全通过；任一生产字段缺失/错值时至少 1 test 失败；E2E 负向矩阵另验七类 `failure_class`。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject attempt DB_URL}" "${BRAIN_URL:?}" "${HARNESS_TASK_ID:?}" "${HARNESS_TASK_BUNDLE_FILE:?}"
: "${HARNESS_RUN_ID:?}" "${HARNESS_ATTEMPT_ID:?}" "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}" "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
EVIDENCE_DIR="${SPRINT_DIR:?}/evidence/${HARNESS_ATTEMPT_ID}"
mkdir -p "$EVIDENCE_DIR"
REPO=""; BASE=""; HEAD_SHA=""; ANCHOR=""; FINISHED=0
finish() {
  local status="$1" class="$2" evidence_sha="${3:-$(printf empty | sha256sum | cut -d' ' -f1)}"
  FINISHED=1
  jq -nc --arg status "$status" --arg class "$class" --arg repo "$REPO" --arg base "$BASE" --arg head "$HEAD_SHA" --arg anchor "$ANCHOR" --arg run "$HARNESS_RUN_ID" --arg attempt "$HARNESS_ATTEMPT_ID" --arg evidence "$evidence_sha" '{status:$status,failure_class:$class,base_repo:$repo,base_sha:$base,target_head_sha:$head,gp_anchor:$anchor,run_id:$run,attempt_id:$attempt,execution_surface:"fleet-worker",evidence_sha256:$evidence}'
}
fail_input() { finish failed "$1"; exit 20; }
fail_environment() { finish environment_failed "$1"; exit 30; }
trap 'code=$?; if [ "$FINISHED" -eq 0 ]; then finish failed unexpected_validation_error; fi; exit "$code"' EXIT

validate_inputs() {
  local payload_file="$1" bundle_file="$2" value
  value=$(jq -er '.base_repo | select(type=="string" and length>0)' "$payload_file") || { echo base_repo_missing; return 1; }
  [ "$value" = perfectuser21/zenithjoy-workspace ] || { echo base_repo_mismatch; return 1; }
  value=$(jq -er '.target_head_sha | select(type=="string" and length>0)' "$payload_file") || { echo target_head_sha_missing; return 1; }
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || { echo target_head_sha_invalid; return 1; }
  jq -e --arg v "$value" '.task_bundle.inputs.workspace_spec.expected_head_sha==$v' "$bundle_file" >/dev/null || { echo target_head_sha_mismatch; return 1; }
  value=$(jq -er '.gp_anchor | select(type=="string" and length>0)' "$payload_file") || { echo gp_anchor_missing; return 1; }
  [ "$value" = line02/keyword_acquisition#step7 ] && jq -e --arg v "$value" '.task_bundle.inputs.gp_anchor==$v' "$bundle_file" >/dev/null || { echo gp_anchor_invalid; return 1; }
}
expect_class() {
  local expected="$1" payload_file="$2" bundle_file="$3" actual rc=0
  actual=$(validate_inputs "$payload_file" "$bundle_file") || rc=$?
  [ "$rc" -ne 0 ] && [ "$actual" = "$expected" ] || { echo "FAIL expected=$expected actual=$actual rc=$rc"; return 1; }
  jq -nc --arg class "$actual" '{status:"failed",failure_class:$class}' | jq -e --arg expected "$expected" '.status=="failed" and .failure_class==$expected' >>"$EVIDENCE_DIR/negative-matrix.jsonl"
}

curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" | jq -e .payload >"$EVIDENCE_DIR/payload.json" || fail_environment brain_unavailable
jq -e . "$HARNESS_TASK_BUNDLE_FILE" >"$EVIDENCE_DIR/bundle.json" || fail_input target_head_sha_missing
for spec in \
  'base_repo_missing|del(.base_repo)' \
  'base_repo_mismatch|.base_repo="wrong/repo"' \
  'target_head_sha_missing|del(.target_head_sha)' \
  'target_head_sha_invalid|.target_head_sha="abc"' \
  'target_head_sha_mismatch|.target_head_sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' \
  'gp_anchor_missing|del(.gp_anchor)' \
  'gp_anchor_invalid|.gp_anchor="line02/keyword_acquisition#step07"'; do
  EXPECTED=${spec%%|*}; FILTER=${spec#*|}
  jq "$FILTER" "$EVIDENCE_DIR/payload.json" >"$EVIDENCE_DIR/negative-payload.json"
  expect_class "$EXPECTED" "$EVIDENCE_DIR/negative-payload.json" "$EVIDENCE_DIR/bundle.json" || fail_input negative_oracle_error
done
CLASS=$(validate_inputs "$EVIDENCE_DIR/payload.json" "$EVIDENCE_DIR/bundle.json") || fail_input "$CLASS"
REPO=$(jq -r .base_repo "$EVIDENCE_DIR/payload.json")
BASE=$(jq -r .base_sha "$EVIDENCE_DIR/payload.json")
HEAD_SHA=$(jq -r .target_head_sha "$EVIDENCE_DIR/payload.json")
ANCHOR=$(jq -r .gp_anchor "$EVIDENCE_DIR/payload.json")
[ "$BASE" = 676fed7de12023d355deac7849af8a525ae53f8d ] || fail_input base_sha_mismatch
for n in 1 2; do validate_inputs "$EVIDENCE_DIR/payload.json" "$EVIDENCE_DIR/bundle.json" >>"$EVIDENCE_DIR/input-check.log" || fail_input bundle_inconsistent; done
git rev-parse --verify "${BASE}^{commit}" >"$EVIDENCE_DIR/base.sha" || fail_input base_sha_invalid
git rev-parse --verify "${HEAD_SHA}^{commit}" >"$EVIDENCE_DIR/target.sha" || fail_input target_head_sha_invalid
git rev-parse --verify HEAD | tee "$EVIDENCE_DIR/checkout.sha" | grep -qx "$HEAD_SHA" || fail_input target_head_sha_mismatch
for n in 1 2; do gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha | tee -a "$EVIDENCE_DIR/github-head.log" | grep -qx "$HEAD_SHA" || fail_environment github_unavailable; done
jq -e '[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1' product-map/generated/product-map.json >"$EVIDENCE_DIR/gp.log" || fail_input gp_anchor_invalid
export DATABASE_URL="$DB_URL"
npm --prefix apps/api run migrate >"$EVIDENCE_DIR/migration.log" 2>&1 || fail_environment postgres_unavailable
psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc "SELECT to_regclass('zenithjoy.schema_migrations') IS NOT NULL" | tee "$EVIDENCE_DIR/postgres.log" | grep -qx t || fail_environment postgres_unavailable
npx vitest run sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-production-receipt.test.ts --reporter=verbose || fail_environment node_dependencies_unavailable
EVIDENCE_SHA=$(find "$EVIDENCE_DIR" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)
finish passed none "$EVIDENCE_SHA" >"$EVIDENCE_DIR/receipt.json"
jq -e '.status=="passed" and .failure_class=="none" and (.evidence_sha256|test("^[0-9a-f]{64}$")) and keys==["attempt_id","base_repo","base_sha","evidence_sha256","execution_surface","failure_class","gp_anchor","run_id","status","target_head_sha"]' "$EVIDENCE_DIR/receipt.json"
cat "$EVIDENCE_DIR/receipt.json"
trap - EXIT
```

本任务不启动业务 API、不创建租户/session；DB 仅验证 Fleet 注入资源与 migration，signup/login 不适用。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Worker 消费 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-production-receipt.test.ts` | `Fleet bundle 原样消费 Brain payload` | 当前 bundle 未物化 expected_head_sha/gp_anchor 时失败 |
| checkout | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-production-receipt.test.ts` | `实际 checkout 绑定目标 PR head` | HEAD 回退 authoring workspace 时失败 |
| GP | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-production-receipt.test.ts` | `GP anchor 唯一解析到 step7` | bundle 缺 anchor 或 SSOT 不唯一时失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: bundle 的 expected_head_sha 为 null、39/41 位，gp_anchor 为 step07
- 重复提交: 连续读取两次 Brain/bundle/GitHub，结果必须一致
- 中途中断: GitHub/Postgres 断开不得留下 passed
- 边界值: thin_prd 含正确文本但结构化字段缺失，必须失败
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。
