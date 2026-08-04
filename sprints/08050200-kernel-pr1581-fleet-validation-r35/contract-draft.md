# Sprint Contract Draft (Round 1)

## Notes

- contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo)
- 本合同是既有 Fleet Worker 行为的验证合同，不授权修改 PR #1581 业务实现、Harness 调度策略或共享 CI 基础设施。
- GAN authoring provenance 仅为本轮提案；Evaluator/Judge 身份全部由 Runner 的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` 运行时注入。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

已用 `jq` 核实 `line02/keyword_acquisition` 在 `product-map/generated/product-map.json` 中唯一存在。

## Response Schema（推导来源: PRD字面）

本任务无新增 HTTP endpoint。Fleet Worker 必须输出一个 JSON 验收回执：

```json
{
  "status": "passed|failed|environment_failed",
  "base_repo": "perfectuser21/zenithjoy-workspace",
  "base_sha": "676fed7de12023d355deac7849af8a525ae53f8d",
  "target_head_sha": "c305f6217da65bb69413c39e621b7e797e0fb189",
  "gp_anchor": "line02/keyword_acquisition#step7",
  "failure_class": null,
  "validation_identity": {
    "attempt_id": "<HARNESS_ATTEMPT_ID>",
    "provider": "<HARNESS_PROVIDER>",
    "account": "<HARNESS_ACCOUNT>",
    "machine": "<HARNESS_MACHINE>",
    "model": "<HARNESS_MODEL>",
    "runner_digest": "<HARNESS_RUNNER_DIGEST>",
    "capability_snapshot_id": "<CAPABILITY_SNAPSHOT_ID>"
  }
}
```

- 所有顶层字段必填；成功时 `status=passed` 且 `failure_class=null`。
- 输入字段错误时 `status=failed`，依赖不可用时 `status=environment_failed`；两者都不得写 `passed`。
- `validation_identity` 必须取当前执行角色的运行时变量，不得固化 Proposer/Planner/Reviewer 身份。
- 禁用字段名：`repo`、`head_sha`、`anchor`、`ok`（不得作为上述权威字段的同义替代）。

## 已知约束（来自回归测试与累积 FR）

- [回归测试] 当前仓库未发现直接覆盖 Fleet Worker 三字段消费的既有测试。
- [累积FR] 本 line 暂无历史验收行为。
- [context-manifest] thin PRD 已携带累积 FR 摘要；本轮不另行推断。
- `git rev-parse` 判定目标提交必须使用 `git rev-parse --verify "${TARGET_HEAD_SHA}^{commit}"`。
- 写入侧与校验侧必须使用同一份 payload；禁止回退到工作区 `HEAD`。
- 共享 CI 基础设施不在授权范围内。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 消费 `base_repo`、`target_head_sha`、`gp_anchor`，相对冻结 `base_sha` 校验并输出绑定同一目标的回执。 |
| NFR（做得多好） | 总预算 7200 秒；结论必须可审计且字段逐字保留。 |
| Invariant（永不违反） | 不从标题、当前 HEAD 或隐含工作区状态补猜 payload；依赖失败不冒充业务通过。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 仅对冻结目标 PR #1581、base SHA 与 target SHA 有效；任一 SHA 改变即失效。 |
| 死亡告警（停了谁知道） | Evaluator 在 7200 秒内以非零退出和 `environment_failed` 回执暴露，Harness controller 收账。 |
| 失败语义（挂了怎么办） | 输入错误 fail-closed；GitHub/git/Postgres 等依赖不可用分类为环境失败；不得降级为 passed。 |
| 效果确认（已发≠已生效） | 独立核对 GitHub PR head、git commit 可解析性、product-map 锚点唯一性与回执字段一致性。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 目标 head 是否匹配 | A. 当前工作区 HEAD；B. GitHub PR API `.head.sha` | B | PRD 明确禁止回退工作区 HEAD | 错验其他提交并产生成功结论 |
| GP 锚点是否唯一可解析 | A. 文本前缀猜测；B. product-map 精确匹配 line/id 并校验 step | B | product-map 是分类 SSOT | 验错 Golden Path 步骤 |

PrepPRD 已明确拍板两个判定点，无待用户确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| payload 字段缺失、格式错或事实不一致 | `status=failed`，写具体 `failure_class`，退出非零 | 是，相同 payload 结论一致 | 无，fail-closed |
| GitHub/git/Postgres 依赖不可用 | `status=environment_failed`，退出非零 | 是，依赖恢复后可重试 | 禁止改写为业务 passed |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness task payload | 不可信结构化输入 | 只读取三项白名单字段并做精确格式/事实校验，不执行字段内容 | 非白名单字段不参与目标选择；缺失或矛盾立即失败 |

## 真实调用方请求 shape

Fleet Runner 注入的 `HARNESS_TASK_PAYLOAD_JSON` 必须是 JSON object，权威字段位于顶层，逐字段为：

```json
{"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}
```

本验证不使用 body/header 双路径，也不从任务标题推断任何字段。

## 禁 mock 边清单

- Fleet Runner payload → Fleet Worker 校验器（本单验证跨模块数据传递，测试必须读取 Runner 实际注入的 payload）。
- Fleet Worker 校验器 → GitHub PR head / 本地 git object / product-map SSOT（禁止 mock 被校验事实）。
- Fleet Worker → 验收回执（必须读取本轮真实回执文件并核对运行时 validation identity）。

## 未覆盖真实链路清单

（本合同无 mock、stub、force_* 或假数据豁免，N/A）

## 接缝清单

- [接缝×2] GitHub PR #1581 head：真调 GitHub API 两次并与 payload 的完整 SHA 相等；两次不一致判 FLAKY。
- Runner payload 到回执：读取当前执行角色真实注入的 payload 与 receipt；未执行前为 `logic-done-pending`，Evaluator 真跑通过后才算 done。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[入口] 正确 payload → 精确校验仓库/SHA/锚点与冻结基线 → [出口] 绑定同一目标的审计回执

### Step 1: Fleet Worker 接收权威 payload
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 1 项。

**可观测行为**: 实际 Runner payload 顶层存在三个字段且值逐字等于 PRD 冻结值，不从标题或工作区补猜。

**验证命令**:
```bash
jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' <<<"$HARNESS_TASK_PAYLOAD_JSON"
```

**硬阈值**: 三字段 3/3 存在且精确匹配；验证命令退出 0。

### Step 2: 相对冻结基线校验真实目标
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 2 项及边界情况。

**可观测行为**: 目标 SHA 是完整 40 位 commit，GitHub PR #1581 head 与其相等；锚点在 product-map 中唯一落到 step7。

**验证命令**:
```bash
TARGET_HEAD_SHA=$(jq -er '.target_head_sha' <<<"$HARNESS_TASK_PAYLOAD_JSON"); git rev-parse --verify "${TARGET_HEAD_SHA}^{commit}" | grep -qx "$TARGET_HEAD_SHA"; test "$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)" = "$TARGET_HEAD_SHA"; jq -e '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[]; .id=="step7"))] | length==1' product-map/generated/product-map.json
```

**硬阈值**: commit 可解析、PR head 精确相等、锚点匹配数恰为 1；任一失败退出非零。

### Step 3: 输出绑定同一目标的审计结论
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 3 项。

**可观测行为**: 本轮回执记录相同 repo/SHA/anchor/base SHA 和当前 Runner identity；缺字段、矛盾或依赖故障均不得为 passed。

**验证命令**:
```bash
jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg c "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg d "$HARNESS_RUNNER_DIGEST" --arg s "$CAPABILITY_SNAPSHOT_ID" '.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class==null and .validation_identity=={attempt_id:$a,provider:$p,account:$c,machine:$m,model:$model,runner_digest:$d,capability_snapshot_id:$s}' "$FLEET_VALIDATION_RECEIPT"
```

**硬阈值**: 所有字段精确相等，identity 7/7 来自当前 Runner，验证命令退出 0。

### Step 4: 逐项篡改与依赖失败均 fail-closed
**来源**: `[FROM_PRD]` — 「边界情况」四项。

**可观测行为**: 三字段任一缺失/错值/不可解析及外部依赖不可用，校验器均非零退出，且没有 `status=passed` 回执。

**验证命令**:
```bash
bash "$FLEET_VALIDATOR" --self-test-negative "$HARNESS_TASK_PAYLOAD_JSON" "$FLEET_VALIDATION_RECEIPT"
```

**硬阈值**: base_repo、target_head_sha、gp_anchor、dependency_unavailable 四组负例 4/4 被拒绝；脚本汇总退出 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_TASK_PAYLOAD_JSON:?Runner 必须注入实际 Fleet task payload}"
: "${FLEET_VALIDATION_RECEIPT:?Fleet Worker 必须提供本轮回执路径}"
: "${FLEET_VALIDATOR:?Fleet Worker 必须提供真实校验器入口}"
: "${HARNESS_ATTEMPT_ID:?}"
: "${HARNESS_PROVIDER:?}"
: "${HARNESS_ACCOUNT:?}"
: "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"
: "${CAPABILITY_SNAPSHOT_ID:?}"

PAYLOAD_FILE=$(mktemp)
trap 'rm -f "$PAYLOAD_FILE"' EXIT
printf '%s' "$HARNESS_TASK_PAYLOAD_JSON" > "$PAYLOAD_FILE"

jq -e 'type=="object" and .base_repo=="perfectuser21/zenithjoy-workspace" and (.target_head_sha|test("^[0-9a-f]{40}$")) and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' "$PAYLOAD_FILE"
TARGET_HEAD_SHA=$(jq -er '.target_head_sha' "$PAYLOAD_FILE")
git rev-parse --verify "${TARGET_HEAD_SHA}^{commit}" | grep -qx "$TARGET_HEAD_SHA"

for run in 1 2; do
  REMOTE_HEAD=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha) || { echo "ENVIRONMENT_FAIL: GitHub API unavailable"; exit 2; }
  [ "$REMOTE_HEAD" = "$TARGET_HEAD_SHA" ] || { echo "FAIL: PR head mismatch run=$run"; exit 1; }
done

jq -e '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[]; .id=="step7"))] | length==1' product-map/generated/product-map.json

"$FLEET_VALIDATOR" --payload "$PAYLOAD_FILE" --receipt "$FLEET_VALIDATION_RECEIPT"
"$FLEET_VALIDATOR" --self-test-negative "$HARNESS_TASK_PAYLOAD_JSON" "$FLEET_VALIDATION_RECEIPT"

jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg c "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg d "$HARNESS_RUNNER_DIGEST" --arg s "$CAPABILITY_SNAPSHOT_ID" '.status=="passed" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .failure_class==null and .validation_identity=={attempt_id:$a,provider:$p,account:$c,machine:$m,model:$model,runner_digest:$d,capability_snapshot_id:$s}' "$FLEET_VALIDATION_RECEIPT"

echo "PASS: Fleet payload 与审计回执绑定目标 PR head"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| payload 字段与目标事实绑定 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-contract.test.ts` | `拒绝缺失或篡改的权威 payload 字段`、`审计回执绑定冻结目标与当前 validation identity` | receipt/validator 尚未提供时测试失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: `base_repo` 大小写变化、SHA 39/41 位、anchor 多余空格与 `step07`
- 重复提交: 相同 payload 连续验证两次，回执目标字段必须一致
- 中途中断: GitHub 请求失败后重试，不得遗留 passed 回执
- 边界值: payload 增加无关字段、字段值为 null/数组/对象
发现分级: P0/P1（错验提交或环境失败误报通过）阻塞 merge；P2/P3 记录 findings 不阻塞
