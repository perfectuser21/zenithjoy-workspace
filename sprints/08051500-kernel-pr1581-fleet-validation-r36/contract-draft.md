# Sprint Contract Draft (Round 4)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- Round 3 案卷的 `blockers[]` 为空；依据 reviewer summary 登记三项修订：R3-1 改为直接执行生产 Fleet Worker；R3-2 测试改为 spawn 生产 Worker 的真实 TDD Red；R3-3 GitHub/Postgres 故障必须由 Worker 输出 `environment_failure` receipt。
- 本合同不修改 PR #1581 业务实现或 Harness 调度；Evaluator/Judge 身份只从各自 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

N/A — 任务无新 HTTP 响应。生产 Fleet receipt 的成功结论必须记录 `status=passed`、`base_repo`、`base_sha`、`target_head_sha`、`gp_anchor`、`failure_class=none`；失败必须 exit 非零且 `failure_class!=none`。

## 已知约束（来自回归测试与累积 FR）

- `[PRD 铁律]` ref 判定必须使用 `git rev-parse --verify '<ref>^{commit}'`。
- `[PRD 铁律]` 判变端与终验端都以 payload、GitHub PR 与冻结 checkout 为权威，不回退当前工作区 HEAD。
- `[累积FR]` 本 line 暂无历史；`context-manifest: unavailable`。
- `[回归测试]` 当前基线不存在生产 Fleet Worker 及其 receipt migration；本轮测试必须因此真实 Red。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 生产 Fleet Worker 消费 `base_repo`、`target_head_sha`、`gp_anchor`，把结论绑定 PR #1581 的 head。 |
| NFR（做得多好） | 7200 秒内完成；字段逐字一致；依赖失败与业务不一致可区分。 |
| Invariant（永不违反） | 不从标题、分支名或当前 HEAD 猜目标；任一权威字段不符不得成功。 |
| 判定点（怎么知道） | 见判定点登记表。 |
| 保质期（何时过期） | PR head 改变后旧 receipt 失效。 |
| 死亡告警（停了谁知道） | Worker 非零退出并产出 failure receipt，Harness 收账阻塞。 |
| 失败语义（挂了怎么办） | fail-closed；字段错不重试，依赖故障可重试但不降级为 PASS。 |
| 效果确认（已发≠已生效） | receipt 与 GitHub PR、冻结 checkout、product-map 和新鲜 DB 行交叉核对。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 head 是否等于 payload target | workspace HEAD；GitHub PR API | GitHub PR API 与 payload 精确相等 | PRD 禁止回退工作区 HEAD | 错提交被误报通过 |
| GP 锚点是否唯一 | 字符串正则；product-map SSOT | SSOT 精确 line/id/step 数量为 1 | 产品分类 SSOT | 验错父路步骤 |

judgment-pending-user: PR #1581 head 是否严格等于 PRD target（PRD 标为 assumption，执行时由 GitHub 真值裁决）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| payload 缺失/格式错 | 非零退出，`payload_invalid` + `failed_field` | 是 | 无 |
| repo/head/anchor 与权威不一致 | 非零退出，`target_mismatch` + `failed_field` | 是 | 无 |
| GitHub/Postgres/product-map 不可用 | 非零退出，`environment_failure` + `failed_dependency` | 是 | 依赖恢复后重跑 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness Initiative payload | 不可信结构化输入 | 只读取固定 keys、完整 SHA 与严格 anchor grammar | 未知解释、缺失或冲突字段 fail-closed，不执行字段内容 |

## 真实调用方请求 shape

Kernel 真实派发 bundle 的字段路径为 `.inputs.payload.base_repo`、`.inputs.payload.base_sha`、`.inputs.payload.target_head_sha`、`.inputs.payload.gp_anchor`。生产同形执行体为：

```bash
node packages/brain/src/harness/fleet-worker.js validate --bundle "$BUNDLE" --workspace "$WORKTREE" --receipt "$RECEIPT"
```

合同和测试禁止自行生成成功 receipt；只有上述生产 Worker 可写 receipt/DB。认证走 Runner/GitHub 短期环境身份，不进入 payload。

## 禁 mock 边清单

- Kernel bundle ↔ 生产 Fleet Worker payload parser（禁止 fixture verifier）。
- Fleet Worker ↔ GitHub PR #1581、冻结 checkout、product-map SSOT（必须真调/真读）。
- Fleet Worker ↔ attempt-scoped Postgres receipt 表（必须真实 migration 与写入，禁止直接 INSERT）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- `[接缝×2]` 同一正确 bundle 经生产 Worker 执行两次，receipt 目标字段必须一致，否则 FLAKY。
- `[接缝×2]` GitHub/Postgres 依赖故障各执行两次，均须由 Worker 分类为 `environment_failure`。

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步

[正确 Initiative payload] → [生产 Fleet Worker 校验] → [对账冻结 base、PR head 与 GP] → [同 SHA 审计 receipt]

### Step 1: 生产 Worker 接收权威 payload
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 1 项。

**可观测行为**: Worker 的成功 receipt 原样记录 repo、target SHA 与 Step 7 anchor。

**验证命令**:
```bash
node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$RECEIPT"
jq -e '.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' "$RECEIPT"
```
**硬阈值**: Worker 与 jq 均 exit 0，三字段逐字相等。

### Step 2: 对账冻结基线、PR head 与 GP
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 2 项。

**可观测行为**: receipt 的 base/head 与 GitHub PR #1581 一致，anchor 在 SSOT 唯一。

**验证命令**:
```bash
gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '.head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .base.sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .head.repo.full_name=="perfectuser21/zenithjoy-workspace"'
jq -e '[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1' product-map/generated/product-map.json
git -C "${FLEET_TARGET_WORKTREE:?}" rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}'
```
**硬阈值**: 三条命令均 exit 0；repo/base/head/anchor 唯一精确匹配。

### Step 3: 输出绑定当前执行身份的新鲜审计结论
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 3 项与 NFR 可观测要求。

**可观测行为**: receipt 记录目标四元组、当前 Runner provenance，且 DB 五分钟窗出现本 attempt 新行。

**验证命令**:
```bash
jq -e '.failure_class=="none" and .runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID' "$RECEIPT"
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_validation_receipts WHERE attempt_id='${HARNESS_ATTEMPT_ID}' AND target_head_sha='c305f6217da65bb69413c39e621b7e797e0fb189' AND created_at>NOW()-interval '5 minutes'" | grep -qx 1
```
**硬阈值**: provenance 与当前 Runner 精确相等；新鲜 DB 行恰为 1。

### Step 4: 错字段或依赖故障 fail-closed
**来源**: `[FROM_PRD]` — 「边界情况」全部四项。

**可观测行为**: repo/head/anchor 缺失或不一致均失败；GitHub/Postgres 不可用归 `environment_failure`，不得产成功 receipt。

**验证命令**:
```bash
jq -e '.status=="failed" and .failure_class!="none" and (.failed_field=="base_repo" or .failed_field=="target_head_sha" or .failed_field=="gp_anchor")' "$MUTATION_RECEIPT"
jq -e '.status=="failed" and .failure_class=="environment_failure" and (.failed_dependency=="github" or .failed_dependency=="postgres")' "$DEPENDENCY_RECEIPT"
```
**硬阈值**: 所有负向 Worker invocation 非零退出；failure receipt 字段精确命中。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject attempt-scoped Postgres}"
: "${HARNESS_ATTEMPT_ID:?}" "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}" "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
ROOT=$(pwd)
D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r36-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$D"' EXIT
W="$D/target"
git clone --quiet "$ROOT" "$W"
git -C "$W" fetch origin c305f6217da65bb69413c39e621b7e797e0fb189 --quiet
git -C "$W" checkout --detach c305f6217da65bb69413c39e621b7e797e0fb189 --quiet
git -C "$W" rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}' | grep -qx c305f6217da65bb69413c39e621b7e797e0fb189
psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/brain/migrations/20260804_create_harness_validation_receipts.sql
psql "$DB_URL" -tAc "SELECT to_regclass('harness_validation_receipts') IS NOT NULL" | grep -qx t
jq -n '{inputs:{payload:{base_repo:"perfectuser21/zenithjoy-workspace",base_sha:"676fed7de12023d355deac7849af8a525ae53f8d",target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",gp_anchor:"line02/keyword_acquisition#step7"}}}' >"$D/bundle.json"
run_worker() { node packages/brain/src/harness/fleet-worker.js validate --bundle "$1" --workspace "$W" --receipt "$2"; }
for N in 1 2; do run_worker "$D/bundle.json" "$D/pass-$N.json"; jq -e '.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class=="none" and .runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID and (all(.checks[];.status=="passed" and .skipped!=true))' "$D/pass-$N.json"; done
jq -s -e '.[0].target_head_sha==.[1].target_head_sha and .[0].gp_anchor==.[1].gp_anchor' "$D/pass-1.json" "$D/pass-2.json"
expect_failed() { local name="$1" bundle="$2"; if run_worker "$bundle" "$D/$name.json"; then echo "FAIL: $name unexpectedly passed"; return 1; fi; jq -e '.status=="failed" and .failure_class!="none"' "$D/$name.json"; }
jq 'del(.inputs.payload.base_repo)' "$D/bundle.json" >"$D/repo-missing.json"; expect_failed repo_missing "$D/repo-missing.json"
jq '.inputs.payload.base_repo="wrong/repo"' "$D/bundle.json" >"$D/repo-wrong.json"; expect_failed repo_wrong "$D/repo-wrong.json"
jq 'del(.inputs.payload.target_head_sha)' "$D/bundle.json" >"$D/head-missing.json"; expect_failed head_missing "$D/head-missing.json"
jq '.inputs.payload.target_head_sha="HEAD"' "$D/bundle.json" >"$D/head-short.json"; expect_failed head_short "$D/head-short.json"
jq '.inputs.payload.target_head_sha="0000000000000000000000000000000000000000"' "$D/bundle.json" >"$D/head-wrong.json"; expect_failed head_wrong "$D/head-wrong.json"
jq 'del(.inputs.payload.gp_anchor)' "$D/bundle.json" >"$D/gp-missing.json"; expect_failed gp_missing "$D/gp-missing.json"
jq '.inputs.payload.gp_anchor="line02/keyword_acquisition#step999"' "$D/bundle.json" >"$D/gp-wrong.json"; expect_failed gp_wrong "$D/gp-wrong.json"
for N in 1 2; do if GITHUB_API_URL=http://127.0.0.1:1 run_worker "$D/bundle.json" "$D/github-$N.json"; then exit 1; fi; jq -e '.failure_class=="environment_failure" and .failed_dependency=="github"' "$D/github-$N.json"; if DB_URL=postgresql://127.0.0.1:1/unavailable run_worker "$D/bundle.json" "$D/postgres-$N.json"; then exit 1; fi; jq -e '.failure_class=="environment_failure" and .failed_dependency=="postgres"' "$D/postgres-$N.json"; done
psql "$DB_URL" -tAc "SELECT count(*) FROM harness_validation_receipts WHERE attempt_id='${HARNESS_ATTEMPT_ID}' AND target_head_sha='c305f6217da65bb69413c39e621b7e797e0fb189' AND created_at>NOW()-interval '5 minutes'" | grep -Eq '^[2-9][0-9]*$'
sha256sum "$D/pass-1.json"
echo 'Golden Path 验证通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: JSON 非对象、同义字段、SHA 大小写、39/41 位。
- 重复提交: 同一 payload 连跑，receipt 目标字段稳定且 DB 不串 attempt。
- 中途中断: GitHub/Postgres 断开时不得留下 passed receipt。
- 边界值: anchor 多 `#`、不存在 line/GP/step。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 真链路验证 | `sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-receipt.test.ts` | 正确 payload 只有生产 Fleet Worker 权威对账后通过；字段变异经生产 Worker fail-closed；依赖故障由 Worker 分类 environment_failure；Runner identity late-bound | 当前基线缺生产 Worker/migration，spawn 测试真实失败 |

