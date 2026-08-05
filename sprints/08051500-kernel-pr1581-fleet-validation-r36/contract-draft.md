# Sprint Contract Draft (Round 6)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- R5 修订：删除不存在且不在 PRD 范围内的 `packages/brain/src/harness/fleet-worker.js`、receipt migration 与生产表要求。实现目标改为本 Sprint 内可交付的 Fleet payload 验收执行体 `verify-fleet-payload.mjs`；它只读 bundle、冻结 checkout、GitHub 与 attempt-scoped Postgres，不修改 PR #1581 或 Harness 调度，因此 task-plan 有合法的 Red→Green 路径。
- validation identity 全部从执行时 `HARNESS_*` / `CAPABILITY_SNAPSHOT_ID` late-bind。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

本任务无 HTTP 响应。CLI 成功 JSON 的顶层 keys 必须为 `base_repo,base_sha,failure_class,gp_anchor,status,target_head_sha`；成功值为 PRD 固定四元组与 `status=passed,failure_class=none`。失败 JSON 必须含 `status=failed,failure_class,failed_field|failed_dependency`，CLI exit 非零。

## 已知约束（来自回归测试与累积 FR）

- `[PRD 铁律]` ref 判定使用 `git rev-parse --verify '<ref>^{commit}'`。
- `[PRD 铁律]` 不回退当前工作区 HEAD；GitHub/Postgres 不可用不得业务 PASS。
- `[累积FR]` 本 line 暂无历史；`context-manifest: unavailable`。
- `[回归测试]` 基线尚无本 Sprint 验收执行体，测试应因目标脚本缺失而 Red。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | Sprint 验收执行体消费 bundle 三个权威字段，并对账冻结 base、PR head 与 GP。 |
| NFR（做得多好） | 7200 秒内；字段逐字一致；失败可分类。 |
| Invariant（永不违反） | 不猜 repo/head/anchor，不回退当前 HEAD，不改业务实现或调度。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | PR head 改变即失效。 |
| 死亡告警（停了谁知道） | CLI 非零，Evaluator 阻塞。 |
| 失败语义（挂了怎么办） | fail-closed；依赖恢复后可重跑。 |
| 效果确认（已发≠已生效） | JSON 同时绑定 repo/base/head/anchor，并由 GitHub、git、SSOT、Postgres 探针交叉确认。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 head 是否等于 payload | 当前 HEAD；GitHub PR API | GitHub PR API | PRD 明禁当前 HEAD 回退 | 错提交误报通过 |
| GP 锚点是否唯一 | 字符串格式；SSOT | 格式与 product-map SSOT 同时验证 | 产品分类 SSOT | 验错步骤 |

judgment-pending-user: PR #1581 head 是否严格等于 PRD target；执行时以 GitHub 真值 fail-closed。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| payload 缺失/格式错 | 非零，`payload_invalid` + `failed_field` | 是 | 无 |
| repo/head/anchor 不一致 | 非零，`target_mismatch` + `failed_field` | 是 | 无 |
| GitHub/Postgres 不可用 | 非零，`environment_failure` + `failed_dependency` | 是 | 恢复后重跑 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Fleet bundle JSON | 不可信结构化输入 | 固定 keys、完整 SHA、严格 anchor grammar | 未知/缺失/冲突字段 fail-closed，不执行字段内容 |

## 真实调用方请求 shape

执行面提供 JSON 文件，字段路径逐字为 `.inputs.payload.base_repo`、`.inputs.payload.target_head_sha`、`.inputs.payload.gp_anchor`；冻结 base 来自 `--base-sha` 参数。调用形态：`node <sprint>/verify-fleet-payload.mjs --bundle "$BUNDLE" --workspace "$WORKTREE" --base-sha "$BASE_SHA"`。

## 禁 mock 边清单

- 验收执行体 ↔ bundle parser（真实文件输入）。
- 验收执行体 ↔ GitHub PR API、冻结 git checkout、product-map SSOT、Postgres 连通性（真调用，禁止 mock）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 接缝清单

- `[接缝×2]` 正确 bundle 对 GitHub、git、SSOT、Postgres 真依赖连续执行两次；结果不一致为 FLAKY。

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步

[payload] → [Sprint 验收执行体] → [四项权威对账] → [审计 JSON]

### Step 1: 消费正确 payload
**来源**: `[FROM_PRD]` — 核心场景第 1 项。

**可观测行为**: CLI 读取三个字段，不从标题或 HEAD 猜测。

**验证命令**: `node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d | jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'`

**硬阈值**: CLI 与 jq exit 0，三字段逐字相等。

### Step 2: 对账冻结 base、PR head、GP 与 Postgres
**来源**: `[FROM_PRD]` — 核心场景第 2 项与依赖边界。

**可观测行为**: CLI 自身真调 GitHub、`git rev-parse --verify`、product-map 与 `psql SELECT 1`。

**验证命令**: `node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d | jq -e '.status=="passed" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .failure_class=="none"'`

**硬阈值**: 所有真实对账成功才 exit 0。

### Step 3: 错字段与依赖故障 fail-closed
**来源**: `[FROM_PRD]` — 边界情况全部四项。

**可观测行为**: 字段变异或依赖不可用均非零，并点名失败字段/依赖。

**验证命令**: `bash -c 'jq '\''del(.inputs.payload.gp_anchor)'\'' "$FLEET_VALID_BUNDLE" > /tmp/fleet-r36-bad-$$.json; node sprints/08051500-kernel-pr1581-fleet-validation-r36/verify-fleet-payload.mjs --bundle /tmp/fleet-r36-bad-$$.json --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d > /tmp/fleet-r36-out-$$.json && exit 1; jq -e '\''.status=="failed" and .failed_field=="gp_anchor"'\'' /tmp/fleet-r36-out-$$.json; rm -f /tmp/fleet-r36-{bad,out}-$$.json'`

**硬阈值**: 负向 CLI 非零且 failure JSON 精确分类。

## E2E 验收

**journey_type**: autonomous  
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?}" "${HARNESS_ATTEMPT_ID:?}" "${CAPABILITY_SNAPSHOT_ID:?}" "${FLEET_VALID_BUNDLE:?}" "${FLEET_TARGET_WORKTREE:?}"
S=sprints/08051500-kernel-pr1581-fleet-validation-r36
D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r36-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$D"' EXIT
git -C "$FLEET_TARGET_WORKTREE" rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}' | grep -qx c305f6217da65bb69413c39e621b7e797e0fb189
for N in 1 2; do node "$S/verify-fleet-payload.mjs" --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/pass-$N.json"; jq -e 'keys==["base_repo","base_sha","failure_class","gp_anchor","status","target_head_sha"] and .status=="passed" and .failure_class=="none" and .base_repo=="perfectuser21/zenithjoy-workspace" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' "$D/pass-$N.json"; done
cmp "$D/pass-1.json" "$D/pass-2.json"
for FIELD in base_repo target_head_sha gp_anchor; do jq "del(.inputs.payload.$FIELD)" "$FLEET_VALID_BUNDLE" >"$D/bad-$FIELD.json"; if node "$S/verify-fleet-payload.mjs" --bundle "$D/bad-$FIELD.json" --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/out-$FIELD.json"; then exit 1; fi; jq -e --arg f "$FIELD" '.status=="failed" and .failure_class=="payload_invalid" and .failed_field==$f' "$D/out-$FIELD.json"; done
if GITHUB_API_URL=http://127.0.0.1:1 node "$S/verify-fleet-payload.mjs" --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/github.json"; then exit 1; fi
jq -e '.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="github"' "$D/github.json"
if DB_URL=postgresql://127.0.0.1:1/unavailable node "$S/verify-fleet-payload.mjs" --bundle "$FLEET_VALID_BUNDLE" --workspace "$FLEET_TARGET_WORKTREE" --base-sha 676fed7de12023d355deac7849af8a525ae53f8d >"$D/postgres.json"; then exit 1; fi
jq -e '.status=="failed" and .failure_class=="environment_failure" and .failed_dependency=="postgres"' "$D/postgres.json"
sha256sum "$D/pass-1.json"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: JSON 非对象、SHA 39/41 位、同义字段。
- 重复提交: 相同 payload 连跑结果必须确定。
- 中途中断: GitHub/Postgres 断开不得留下 passed JSON。
- 边界值: anchor 多 `#`、不存在 step。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet payload 验收执行体 | `sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-payload-validation.test.ts` | 正确 payload 对账后通过；缺失字段 fail-closed；依赖故障分类；不回退当前 HEAD | `verify-fleet-payload.mjs` 缺失导致测试失败 |
