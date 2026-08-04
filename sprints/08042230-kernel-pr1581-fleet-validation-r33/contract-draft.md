# Sprint Contract Draft (Round 1)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- PRD 未定义 HTTP 端点；本合同只定义 Fleet payload 校验 CLI 与审计回执，不改变 PR #1581 业务实现或 Harness 调度。
- GAN authoring identity 仅属本轮作者 provenance；Evaluator/Judge 身份均由 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` 运行时注入，合同不固化角色 UUID。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

已用 `jq` 核实 `line02/keyword_acquisition` 存在且含 `step7`；本 sprint 的验证合同触碰该 GP 的 payload 锚定，不声称实现 Step 7 业务闭环。

## Response Schema（推导来源: PRD字面）

N/A — 任务无 HTTP 响应。CLI 成功审计回执必须精确含 `ok=true`、`base_repo`、`base_sha`、`target_head_sha`、`gp_anchor`、`failure_class=none`；失败必须 exit 非零并含非 `none` 的 `failure_class`，不得输出成功回执。

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

Fleet Worker 的生产同形入口是 task payload JSON，关键字段逐字为：

```json
{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}
```

认证由 Runner/GitHub CLI 的短期环境身份承担，不进入 payload；`HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID` 必须在执行时 late-bound 写入证据摘要。

## 禁 mock 边清单

- Fleet payload → 校验器（本单验证跨模块数据传递，测试必须把真实 JSON 交给真实 CLI，禁止 mock 参数读取）。
- 校验器 → GitHub PR #1581（Final E2E 必须真调 GitHub API，禁止以 fixture 替代 head/base/repo）。
- 校验器 → `product-map/generated/product-map.json`（必须读仓库真实 SSOT 并精确解析 line/id/step）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- `[接缝×2]` GitHub PR #1581 元数据：Evaluator 连续查询两次，均须与 payload 目标仓库、head、base 一致；网络不可用为 `environment_failure`，不得标 done。
- product-map SSOT：Evaluator 读取当前冻结仓库文件，锚点必须精确存在；未读取真实文件只能标 `logic-done-pending`。

## Golden Path

覆盖父路 关键词获客（`line02/keyword_acquisition`）第 7-7 步（仅覆盖验收 payload 锚定，不实现父路业务）。

[含权威 payload 的 Initiative] → [逐字段校验] → [对账冻结 base、PR head 与 GP SSOT] → [输出同 SHA 审计结论]

### Step 1: 接收并保留三个权威字段
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步与「范围限定」。

**可观测行为**: CLI 接收生产同形 JSON，成功回执逐字保留 `base_repo`、`target_head_sha`、`gp_anchor`，且不读取标题推断。

**验证命令**:
```bash
node sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs --payload-json '{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}' --offline | jq -e '.ok==true and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'
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
jq -e '.ok==true and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class=="none" and (.provenance.attempt_id|length>0) and (.provenance.capability_snapshot_id|length>0)' "$FLEET_RECEIPT"
```

**硬阈值**: 所有字段精确相等且 provenance 非空；命令 exit 0。

### Step 4: 篡改或依赖故障时 fail-closed
**来源**: `[FROM_PRD]` — PRD「边界情况」四项。

**可观测行为**: 缺失/错 repo/非完整 SHA/错锚均 exit 非零；GitHub/SSOT 故障分类为环境失败，不产生 `ok=true`。

**验证命令**:
```bash
node sprints/08042230-kernel-pr1581-fleet-validation-r33/validate-fleet-payload.mjs --payload-json '{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"HEAD","gp_anchor":"line02/keyword_acquisition#step7"}' --offline >/tmp/fleet-invalid-sha.json 2>&1 && exit 1 || jq -e '.ok==false and .failure_class=="payload_invalid"' /tmp/fleet-invalid-sha.json
```

**硬阈值**: 被篡改输入必须非零退出，失败 JSON 不含成功结论且分类精确；命令 exit 0 表示负向断言成立。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current evaluator attempt}"
: "${HARNESS_PROVIDER:?}"
: "${HARNESS_ACCOUNT:?}"
: "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
SPRINT_DIR="sprints/08042230-kernel-pr1581-fleet-validation-r33"
VALIDATOR="$SPRINT_DIR/validate-fleet-payload.mjs"
EVIDENCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r33-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$EVIDENCE_DIR"' EXIT
PAYLOAD='{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}'
git fetch origin c305f6217da65bb69413c39e621b7e797e0fb189 --quiet
git rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}' >/dev/null
jq -e '.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | [.steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json >/dev/null
for pass in 1 2; do gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 >"$EVIDENCE_DIR/pr-$pass.json"; jq -e '.head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .base.sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .head.repo.full_name=="perfectuser21/zenithjoy-workspace"' "$EVIDENCE_DIR/pr-$pass.json" >/dev/null; done
FLEET_RECEIPT="$EVIDENCE_DIR/receipt.json"
node "$VALIDATOR" --payload-json "$PAYLOAD" --pr-json "$EVIDENCE_DIR/pr-2.json" --product-map product-map/generated/product-map.json --provenance-json "$(jq -nc --arg attempt "$HARNESS_ATTEMPT_ID" --arg provider "$HARNESS_PROVIDER" --arg account "$HARNESS_ACCOUNT" --arg machine "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg digest "$HARNESS_RUNNER_DIGEST" --arg snapshot "$CAPABILITY_SNAPSHOT_ID" '{attempt_id:$attempt,provider:$provider,account:$account,machine:$machine,model:$model,runner_digest:$digest,capability_snapshot_id:$snapshot}')" >"$FLEET_RECEIPT"
jq -e '.ok==true and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class=="none" and (.provenance.attempt_id|length>0) and (.provenance.capability_snapshot_id|length>0)' "$FLEET_RECEIPT"
for bad in '{"base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}' '{"base_repo":"perfectuser21/other","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}' '{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"HEAD","gp_anchor":"line02/keyword_acquisition#step7"}' '{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step6"}'; do if node "$VALIDATOR" --payload-json "$bad" --pr-json "$EVIDENCE_DIR/pr-2.json" --product-map product-map/generated/product-map.json >"$EVIDENCE_DIR/rejected.json"; then echo 'FAIL: 篡改 payload 被接受'; exit 1; fi; jq -e '.ok==false and .failure_class!="none"' "$EVIDENCE_DIR/rejected.json" >/dev/null; done
sha256sum "$FLEET_RECEIPT" | tee "$SPRINT_DIR/evaluator-evidence.sha256"
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
| payload 权威输入校验 | `sprints/08042230-kernel-pr1581-fleet-validation-r33/tests/fleet-payload-validation.test.ts` | 正确 payload 原样绑定；缺失 base_repo；不是完整 SHA；不能唯一解析到 Step 7 | `validate-fleet-payload.mjs` 尚不存在，4 tests failed |
