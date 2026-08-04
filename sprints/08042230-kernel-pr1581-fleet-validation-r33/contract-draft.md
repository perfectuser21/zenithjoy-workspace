# Sprint Contract Draft (Round 7)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 本轮删除 sprint 级 `validate-fleet-payload.mjs` 旁路；唯一被测对象是实际 Fleet Worker 派发后产生的权威 receipt，不改变 PR #1581 业务实现或 Harness 调度。
- GAN authoring identity 仅属本轮作者 provenance；Evaluator/Judge 身份均由 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` 运行时注入，合同不固化角色 UUID。
- Round 6 案卷 reviewer 行的 `blockers[]` 为空；按 `review_feedback.reason` 唯一缺口登记为 `R6-1`。本轮在 Step 4、B-04、E2E 与 TDD Red 测试中加入格式完整但指向不存在 `step999` 的 `gp_anchor` 负向用例，要求 `target_mismatch` 且 `failed_field=gp_anchor`，从而关闭合法 shape 绕过 SSOT 的缺口。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

已用 `jq` 核实 `line02/keyword_acquisition` 存在且含 `step7`；本 sprint 的验证合同触碰该 GP 的 payload 锚定，不声称实现 Step 7 业务闭环。

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应。Fleet receipt 必须精确含 `status=passed`、`base_repo`、`base_sha`、`target_head_sha`、`gp_anchor`、`failure_class=none`；失败必须 exit 非零并含非 `none` 的 `failure_class`。禁止 offline/skipped 检查生成成功 receipt。

## 已知约束（来自回归测试与累积 FR）

- `[PRD 铁律]` `git rev-parse` 判 ref 必须使用 `--verify "<ref>^{commit}"`。
- `[PRD 铁律]` 同一语义在判变端与终验端必须采用同一策略，禁止回退工作区 HEAD。
- `[PRD 铁律]` secrets/PII 不进日志；审计回执仅记录冻结仓库、SHA、锚点、运行时 provenance 与失败分类。
- `[累积FR]` 本 line 暂无历史。
- `[回归测试]` 仓库未找到既有 Fleet payload validator 测试，新增本 sprint TDD Red 测试。
- `context-manifest: unavailable`（Brain line manifest 路由未提供可用 journey URL）。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 校验 payload 的 `base_repo`、`target_head_sha`、`gp_anchor`，并把成功结论绑定目标 PR head 与冻结 base。 |
| NFR（做得多好） | 7200 秒总预算；字段逐字一致；依赖故障与业务不一致分开分类。 |
| Invariant（永不违反） | 不从标题、当前 HEAD 或相似 GP 猜值；任一权威字段不符不得成功。 |
| 判定点（怎么知道） | GitHub PR API 的 head/base/repo 与 product-map SSOT 分别作为外部权威。 |
| 保质期（何时过期） | 目标 PR head 改变即过期；receipt 仅对所记录 target SHA 有效。 |
| 死亡告警（停了谁知道） | Evaluator 非零退出并记录 `environment_failure`；Harness 收账阻塞。 |
| 失败语义（挂了怎么办） | fail-closed；字段错误不重试，GitHub 网络失败可重试但不得转成业务 PASS。 |
| 效果确认（已发≠已生效） | 成功 receipt 与 GitHub PR #1581 和 product-map 双重核对。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 目标提交是否就是 PR #1581 head | 当前工作区 HEAD；payload；GitHub PR API | payload 与 GitHub PR API 必须相等 | PRD 明确禁止工作区回退 | 验错提交并误报通过 |
| GP 锚点是否唯一有效 | 模糊名称匹配；product-map 精确 line/id/step | product-map 精确三段解析 | 产品分类 SSOT | 验收挂错业务步骤 |

judgment-pending-user: 目标提交是否就是 PR #1581 head（PrepPRD 以 assumption 标注，执行时由 GitHub 真值裁决）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 字段缺失/格式错误/值不一致 | exit 非零，`failure_class=payload_invalid` 或 `target_mismatch` | 是 | 无，禁止猜值 |
| GitHub 不可用 | exit 非零，`failure_class=environment_failure` | 是 | 可重试，不得业务放行 |
| product-map 不可解析 | exit 非零，`failure_class=environment_failure` | 是 | 无 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness task payload | 不可信结构化输入 | 仅接受固定 key、完整 40 位小写 hex SHA、严格 GP anchor grammar | 未知/缺失/冲突字段 fail-closed，不执行 payload 内命令或路径 |

## 真实调用方请求 shape

Fleet Worker 的生产同形入口是 Kernel 派发的 task bundle payload，生产执行体固定为 `node packages/brain/src/harness/fleet-worker.js validate --bundle <path> --workspace <checkout> --receipt <path>`；该命令调用真实 payload parser、GitHub 对账、product-map resolver 与 Postgres receipt writer，禁止 sprint 内另造 validator。关键字段逐字为：

```json
{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}
```

认证由 Runner/GitHub CLI 的短期环境身份承担，不进入 payload；身份必须在执行时 late-bound。Evaluator 从 Runner 的 `${HARNESS_TASK_BUNDLE_FILE:?}` 取 authoring envelope，但 E2E 的验收 bundle 由脚本按 PRD payload 生成，并交给上述生产 CLI；receipt 只能由 CLI 输出，E2E 不得自行构造。

## 禁 mock 边清单

- Kernel task bundle → Fleet Worker payload 解析（必须真实派发，禁止 sprint CLI/fixture 替代）。
- Fleet Worker → GitHub PR #1581 与冻结 checkout（必须真调 GitHub API并核对实际 checkout commit）。
- Fleet Worker → `product-map/generated/product-map.json`（必须读仓库真实 SSOT并精确解析）。
- Fleet Worker → Postgres 验收账本（必须先运行 `packages/brain/migrations/20260804_create_harness_validation_receipts.sql` bootstrap 空库，再由真实 writer 落库，禁止 fixture/直接 INSERT）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- `[接缝×2]` 同一 task bundle 真实派发两次，receipt 均须绑定同一 repo/base/head/anchor；结果不一致即 FLAKY。
- GitHub/Postgres 故障必须由 Fleet 故障注入/真实依赖层记录 `environment_failure`，禁止删除本地 fixture 冒充。
- product-map SSOT：Evaluator 读取当前冻结仓库文件，锚点必须精确存在；未读取真实文件只能标 `logic-done-pending`。

## Risks

| 风险 | 触发信号 | mitigation | 失败归类 |
|---|---|---|---|
| GitHub PR head 在验收前漂移 | API 返回 head/base/repo 与冻结 payload 任一不等 | fail-closed，不回退工作区 HEAD；保留 GitHub 响应摘要并要求新 target SHA 重新验收 | `target_mismatch` |
| attempt 空库未 bootstrap 或 Postgres 中断 | 目标表不存在、migration/写入非零 | 同一 `DB_URL` 先验证未 bootstrap 必败，再跑仓库真实 migration；任何 DB 失败禁产 passed receipt | `environment_failure` / `postgres` |
| GP SSOT 缺失或锚点不唯一 | product-map 不可读或精确 line/id/step 数量不等于 1 | 只读冻结 checkout 的生成 JSON，禁止模糊匹配或猜测相邻 step | `environment_failure` / `product_map` 或 `payload_invalid` |
| 角色身份或证据串线 | receipt provenance 缺项、证据 digest 不匹配 | 每个执行角色分别从 Runner 注入的全部 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID` late-bind；Judge 先复算 Evaluator 证据 SHA-256，再引用其摘要 | validation gate FAIL |

## Golden Path

覆盖父路 关键词获客（`line02/keyword_acquisition`）第 7-7 步（仅覆盖验收 payload 锚定，不实现父路业务）。

[含权威 payload 的 Initiative] → [逐字段校验] → [对账冻结 base、PR head 与 GP SSOT] → [输出同 SHA 审计结论]

### Step 1: 接收并保留三个权威字段
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步与「范围限定」。

**可观测行为**: Fleet Worker 接收生产 task bundle，成功 receipt 逐字保留 `base_repo`、`target_head_sha`、`gp_anchor`，且不读取标题推断。

**验证命令**:
```bash
jq -e '.inputs.payload.base_repo=="perfectuser21/zenithjoy-workspace" and .inputs.payload.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .inputs.payload.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .inputs.payload.gp_anchor=="line02/keyword_acquisition#step7"' "${FLEET_VALID_BUNDLE:?}"
```

**硬阈值**: 四项断言全部为真，命令 exit 0；以上命令即机器阈值。

### Step 2: 对账冻结 base、真实 PR head 与 GP 锚点
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 步及三项 assumption。

**可观测行为**: 在线验证以 GitHub PR #1581 和 product-map SSOT 为权威；两次接缝执行均绑定同一目标 SHA。

**验证命令**:
```bash
for pass in 1 2; do gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '.head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .base.sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .head.repo.full_name=="perfectuser21/zenithjoy-workspace"' || exit 1; done
jq -e '.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | [.steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json
git rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}'
```

**硬阈值**: GitHub 两次均返回相同 repo/head/base；GP 精确匹配 1 条；commit ref 可验证。三条命令均须 exit 0。

### Step 3: 输出可审计成功结论
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 步与 NFR 可观测要求。

**可观测行为**: receipt 同时记录四项冻结对象、`failure_class=none` 和当前执行角色 provenance；Evaluator 证据摘要供 Judge 引用。

**验证命令**:
```bash
R=$(mktemp); node packages/brain/src/harness/fleet-worker.js validate --bundle "${FLEET_VALID_BUNDLE:?}" --workspace "${FLEET_TARGET_WORKTREE:?}" --receipt "$R" && jq -e '.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class=="none" and .runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.provider==env.HARNESS_PROVIDER and .runner_provenance.account==env.HARNESS_ACCOUNT and .runner_provenance.machine==env.HARNESS_MACHINE and .runner_provenance.model==env.HARNESS_MODEL and .runner_provenance.runner_digest==env.HARNESS_RUNNER_DIGEST and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID' "$R"
```

**硬阈值**: 所有字段精确相等且 provenance 非空；命令 exit 0。

### Step 4: 篡改或依赖故障时 fail-closed
**来源**: `[FROM_PRD]` — PRD「边界情况」四项。

**可观测行为**: 缺失/错 repo/非完整 SHA/格式合法但与 PR head 不一致的 SHA/缺失或错误锚点均 exit 非零；每个 receipt 必须用 `failed_field` 指明 `base_repo`、`target_head_sha` 或 `gp_anchor`，并在 `error` 中包含同一字段名；GitHub/SSOT 故障分类为环境失败，不产生成功结论。

**验证命令**:
```bash
jq -e '.status=="failed" and .failure_class=="payload_invalid" and .failed_field=="base_repo" and (.error|test("base_repo"))' "${FLEET_MUTATION_RECEIPT_DIR:?}/repo_missing.json"
jq -e '.status=="failed" and .failure_class=="target_mismatch" and .failed_field=="base_repo" and (.error|test("base_repo"))' "$FLEET_MUTATION_RECEIPT_DIR/repo_wrong.json"
for CASE in target_head_missing target_head_short; do jq -e '.status=="failed" and .failure_class=="payload_invalid" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))' "$FLEET_MUTATION_RECEIPT_DIR/$CASE.json" || exit 1; done
jq -e '.status=="failed" and .failure_class=="target_mismatch" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))' "$FLEET_MUTATION_RECEIPT_DIR/target_head_mismatch.json"
for CASE in gp_anchor_missing gp_anchor_ambiguous; do jq -e '.status=="failed" and .failure_class=="payload_invalid" and .failed_field=="gp_anchor" and (.error|test("gp_anchor"))' "$FLEET_MUTATION_RECEIPT_DIR/$CASE.json" || exit 1; done
jq -e '.status=="failed" and .failure_class=="target_mismatch" and .failed_field=="gp_anchor" and (.error|test("gp_anchor"))' "$FLEET_MUTATION_RECEIPT_DIR/gp_anchor_nonexistent_step.json"
```

**硬阈值**: 被篡改输入必须非零退出；8 个失败 receipt（含格式合法但指向不存在 `step999` 的 anchor）的 `failure_class`、`failed_field` 与含字段名的 `error` 全部精确命中上述 oracle；命令 exit 0 表示负向断言成立。

### Step 5: 串联 Evaluator 与 Independent Judge 证据
**来源**: `[AI_ADDED]` — 防止不同角色复用 Proposer 身份或 Judge 审到未锚定的 Evaluator 输出。

**可观测行为**: Evaluator 证据记录其自身完整 runtime provenance，并引用被测 repo/head/receipt SHA-256；Independent Judge 用自己的 runtime provenance，复算并引用 Evaluator 证据 SHA-256。两角色不共享 attempt/account/snapshot。

**验证命令**:
```bash
jq -e '.role=="evaluator" and .provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .provenance.provider==env.HARNESS_PROVIDER and .provenance.account==env.HARNESS_ACCOUNT and .provenance.machine==env.HARNESS_MACHINE and .provenance.model==env.HARNESS_MODEL and .provenance.runner_digest==env.HARNESS_RUNNER_DIGEST and .provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID and .subject.base_repo=="perfectuser21/zenithjoy-workspace" and .subject.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and (.subject.receipt_sha256|test("^[0-9a-f]{64}$"))' "${EVALUATOR_EVIDENCE_FILE:?}"
printf '%s  %s\n' "${EVALUATOR_EVIDENCE_SHA256:?}" "$EVALUATOR_EVIDENCE_FILE" | sha256sum -c -
jq -e '.role=="judge" and .provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .provenance.provider==env.HARNESS_PROVIDER and .provenance.account==env.HARNESS_ACCOUNT and .provenance.machine==env.HARNESS_MACHINE and .provenance.model==env.HARNESS_MODEL and .provenance.runner_digest==env.HARNESS_RUNNER_DIGEST and .provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID and .evaluator_evidence_sha256==env.EVALUATOR_EVIDENCE_SHA256' "${JUDGE_EVIDENCE_FILE:?}"
```

**硬阈值**: 两份 evidence 的角色与各自 runtime provenance 全字段精确相等；receipt/evaluator digest 均为 64 位小写 SHA-256；`sha256sum -c` exit 0；任一身份复用或摘要不一致即 FAIL。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current evaluator attempt}"
: "${HARNESS_PROVIDER:?Runner must inject current evaluator provider}"
: "${HARNESS_ACCOUNT:?Runner must inject current evaluator account}"
: "${HARNESS_MACHINE:?Runner must inject current evaluator machine}"
: "${HARNESS_MODEL:?Runner must inject current evaluator model}"
: "${HARNESS_RUNNER_DIGEST:?Runner must inject current evaluator runner digest}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
: "${EVALUATOR_EVIDENCE_FILE:?Runner must inject attempt-unique persistent evidence path}"
: "${DB_URL:?Fleet must inject attempt-scoped Postgres}"
ROOT=$(pwd)
EVIDENCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r33-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$EVIDENCE_DIR"' EXIT
WORKTREE="$EVIDENCE_DIR/target"
git clone --quiet "$ROOT" "$WORKTREE"
git -C "$WORKTREE" fetch origin c305f6217da65bb69413c39e621b7e797e0fb189 --quiet
git -C "$WORKTREE" checkout --detach c305f6217da65bb69413c39e621b7e797e0fb189 --quiet
git -C "$WORKTREE" rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}' | grep -qx c305f6217da65bb69413c39e621b7e797e0fb189
psql "$DB_URL" -v ON_ERROR_STOP=1 -f packages/brain/migrations/20260804_create_harness_validation_receipts.sql
psql "$DB_URL" -tAc "SELECT to_regclass('harness_validation_receipts') IS NOT NULL" | grep -qx t
jq -n '{inputs:{payload:{base_repo:"perfectuser21/zenithjoy-workspace",base_sha:"676fed7de12023d355deac7849af8a525ae53f8d",target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",gp_anchor:"line02/keyword_acquisition#step7"}}}' >"$EVIDENCE_DIR/bundle.json"
for pass in 1 2; do node packages/brain/src/harness/fleet-worker.js validate --bundle "$EVIDENCE_DIR/bundle.json" --workspace "$WORKTREE" --receipt "$EVIDENCE_DIR/receipt-$pass.json"; jq -e '.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class=="none" and .runner_provenance.attempt_id==env.HARNESS_ATTEMPT_ID and .runner_provenance.provider==env.HARNESS_PROVIDER and .runner_provenance.account==env.HARNESS_ACCOUNT and .runner_provenance.machine==env.HARNESS_MACHINE and .runner_provenance.model==env.HARNESS_MODEL and .runner_provenance.runner_digest==env.HARNESS_RUNNER_DIGEST and .runner_provenance.capability_snapshot_id==env.CAPABILITY_SNAPSHOT_ID and (all(.checks[];.status=="passed" and .skipped!=true))' "$EVIDENCE_DIR/receipt-$pass.json"; done
jq -s -e '.[0].target_head_sha==.[1].target_head_sha and .[0].gp_anchor==.[1].gp_anchor' "$EVIDENCE_DIR/receipt-1.json" "$EVIDENCE_DIR/receipt-2.json"
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT count(*) FROM harness_validation_receipts WHERE attempt_id='${HARNESS_ATTEMPT_ID}' AND target_head_sha='c305f6217da65bb69413c39e621b7e797e0fb189' AND created_at>NOW()-interval '5 minutes'" | grep -qx 2
expect_failed() { local name="$1" bundle="$2" receipt="$EVIDENCE_DIR/$name.json"; if node packages/brain/src/harness/fleet-worker.js validate --bundle "$bundle" --workspace "$WORKTREE" --receipt "$receipt"; then echo "FAIL: $name 竟成功"; return 1; fi; jq -e '.status=="failed" and .failure_class!="none"' "$receipt"; }
jq 'del(.inputs.payload.base_repo)' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/repo-missing.json"; expect_failed repo_missing "$EVIDENCE_DIR/repo-missing.json"
jq -e '.failure_class=="payload_invalid" and .failed_field=="base_repo" and (.error|test("base_repo"))' "$EVIDENCE_DIR/repo_missing.json"
jq '.inputs.payload.base_repo="wrong/repo"' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/repo-wrong.json"; expect_failed repo_wrong "$EVIDENCE_DIR/repo-wrong.json"
jq -e '.failure_class=="target_mismatch" and .failed_field=="base_repo" and (.error|test("base_repo"))' "$EVIDENCE_DIR/repo_wrong.json"
jq 'del(.inputs.payload.target_head_sha)' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/head-missing.json"; expect_failed target_head_missing "$EVIDENCE_DIR/head-missing.json"
jq -e '.failure_class=="payload_invalid" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))' "$EVIDENCE_DIR/target_head_missing.json"
jq '.inputs.payload.target_head_sha="HEAD"' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/head-short.json"; expect_failed target_head_short "$EVIDENCE_DIR/head-short.json"
jq -e '.failure_class=="payload_invalid" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))' "$EVIDENCE_DIR/target_head_short.json"
jq '.inputs.payload.target_head_sha="0000000000000000000000000000000000000000"' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/head-mismatch.json"; expect_failed target_head_mismatch "$EVIDENCE_DIR/head-mismatch.json"
jq -e '.failure_class=="target_mismatch" and .failed_field=="target_head_sha" and (.error|test("target_head_sha"))' "$EVIDENCE_DIR/target_head_mismatch.json"
jq 'del(.inputs.payload.gp_anchor)' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/gp-missing.json"; expect_failed gp_anchor_missing "$EVIDENCE_DIR/gp-missing.json"
jq -e '.failure_class=="payload_invalid" and .failed_field=="gp_anchor" and (.error|test("gp_anchor"))' "$EVIDENCE_DIR/gp_anchor_missing.json"
jq '.inputs.payload.gp_anchor="line02/keyword_acquisition"' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/gp-ambiguous.json"; expect_failed gp_anchor_ambiguous "$EVIDENCE_DIR/gp-ambiguous.json"
jq -e '.failure_class=="payload_invalid" and .failed_field=="gp_anchor" and (.error|test("gp_anchor"))' "$EVIDENCE_DIR/gp_anchor_ambiguous.json"
jq '.inputs.payload.gp_anchor="line02/keyword_acquisition#step999"' "$EVIDENCE_DIR/bundle.json" >"$EVIDENCE_DIR/gp-nonexistent-step.json"; expect_failed gp_anchor_nonexistent_step "$EVIDENCE_DIR/gp-nonexistent-step.json"
jq -e '.failure_class=="target_mismatch" and .failed_field=="gp_anchor" and (.error|test("gp_anchor"))' "$EVIDENCE_DIR/gp_anchor_nonexistent_step.json"
cp -R "$WORKTREE" "$EVIDENCE_DIR/no-map"
rm -f "$EVIDENCE_DIR/no-map/product-map/generated/product-map.json"
if node packages/brain/src/harness/fleet-worker.js validate --bundle "$EVIDENCE_DIR/bundle.json" --workspace "$EVIDENCE_DIR/no-map" --receipt "$EVIDENCE_DIR/no-map.json"; then echo 'FAIL: product-map 缺失竟成功'; exit 1; fi
jq -e '.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="product_map"' "$EVIDENCE_DIR/no-map.json"
RECEIPT_SHA=$(sha256sum "$EVIDENCE_DIR/receipt-1.json" | awk '{print $1}')
jq -n --arg attempt "$HARNESS_ATTEMPT_ID" --arg provider "$HARNESS_PROVIDER" --arg account "$HARNESS_ACCOUNT" --arg machine "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg runner "$HARNESS_RUNNER_DIGEST" --arg snapshot "$CAPABILITY_SNAPSHOT_ID" --arg receipt "$RECEIPT_SHA" '{role:"evaluator",provenance:{attempt_id:$attempt,provider:$provider,account:$account,machine:$machine,model:$model,runner_digest:$runner,capability_snapshot_id:$snapshot},subject:{base_repo:"perfectuser21/zenithjoy-workspace",target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",receipt_sha256:$receipt}}' >"$EVALUATOR_EVIDENCE_FILE"
sha256sum "$EVALUATOR_EVIDENCE_FILE" | tee "${EVALUATOR_EVIDENCE_FILE}.sha256"
echo 'Golden Path 验证通过'
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: JSON 非对象、额外同义字段 `repo`/`head_sha`、SHA 大小写或 39/41 位。
- 重复提交: 同一 payload 连续验证两次，receipt 目标字段必须一致。
- 中途中断: GitHub 请求失败或 product-map 临时不可读时不得留下 `ok=true` receipt。
- 边界值: anchor 多 `#`、不存在的 line/GP/step、repo 大小写变化。
发现分级: P0/P1（误验提交或挂错 GP）阻塞 merge；P2/P3 记 findings 不阻塞。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 真链路 receipt | `sprints/08042230-kernel-pr1581-fleet-validation-r33/tests/fleet-worker-receipt.test.ts` | 正确 payload 只有生产 Fleet Worker CLI 权威对账后通过；Runner provenance 在执行时绑定；product-map 缺失时生产 Fleet Worker L2 fail-closed | 生产 Worker/migration 尚不存在时测试明确 Red |
