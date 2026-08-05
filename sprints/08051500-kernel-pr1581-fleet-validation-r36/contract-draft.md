# Sprint Contract Draft (Round 3)

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

N/A — PRD 未定义新 HTTP endpoint 或新的结果 JSON schema。本 Sprint 验证 Fleet Worker 已有 Harness 结果中的目标绑定证据，不新增 `verdict`、`failure_class` 等生产字段。

## 已知约束（来自回归测试）

- [product-map/generated/product-map.json] → `line02/keyword_acquisition#step7` 存在且唯一。
- [.github/workflows/scripts/smoke/golden-path-2-smoke.sh] → 父路 smoke 已登记。
- [累积FR] → 本 line 暂无历史。
- Registry 未提供 Fleet payload 专用 schema，故仅使用 PRD 字面字段。

## 八要素需求规范

| 要素 | 本次答案（必填，可 N/A） |
|---|---|
| FR（做什么） | 对一次真实 Fleet 执行核对 payload 的 `base_repo`、`target_head_sha`、`gp_anchor`，并核对验收证据绑定同一目标提交。 |
| NFR（做得多好） | 7200 秒内完成；所有比较均为逐字精确比较；依赖不可用必须失败。 |
| Invariant（永不违反） | 不从任务标题、分支名或当前工作区 HEAD 推断目标；不修改 PR #1581 业务实现或 Harness 调度。 |
| 判定点（怎么知道） | 见下方登记表。 |
| 保质期（何时过期） | 仅对 payload 所指完整 SHA 与冻结 base SHA 有效；PR head 漂移后旧结论失效。 |
| 死亡告警（停了谁知道） | oracle 非零退出，由 Harness evaluator/controller 在本 attempt 内记录。 |
| 失败语义（挂了怎么办） | fail-closed；输入、目标或依赖任一异常均不得给出成功结论。 |
| 效果确认（已发≠已生效） | 成功须同时核对原始 payload、GitHub PR head、候选 checkout HEAD、结果证据摘要。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 head 是否等于 payload 目标 | 当前 workspace HEAD；GitHub PR API | GitHub PR API 的 `.head.sha` | PRD 明确禁止回退工作区 HEAD | 错提交被误报通过 |
| GP 锚点是否唯一 | 字符串正则；product-map SSOT | SSOT 中 line/id/step 精确计数为 1 | 产品分类 SSOT 规则 | 验错父路步骤 |

notes: judgment-pending-user: PR #1581 head 是否严格等于 PRD 给定 SHA（PRD 标为 ASSUMPTION）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 三字段缺失、格式错或值不一致 | oracle 非零退出并指出字段 | 是 | 无，不猜测目标 |
| GitHub/Postgres 不可用 | oracle 非零退出并指出依赖 | 是 | 依赖恢复后重跑 |
| 结果证据 SHA 与目标不一致 | oracle 非零退出并指出证据漂移 | 是 | 无，不以 workspace HEAD 替代 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Fleet payload JSON | 不可信结构化输入 | 只读取固定 key 与严格格式，不执行字段内容 | 缺失、额外解释或格式错误均 fail-closed |

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步

[真实 Fleet payload] → [冻结目标校验] → [PR head 与候选提交核对] → [同 SHA 验收证据]

### Step 1: 读取真实 Fleet payload
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 1 项。

**可观测行为**: 本次 Initiative 的原始 payload 包含三个权威字段，值分别为 PRD 指定仓库、完整 target SHA 与 Step 7 锚点。

**验证命令**:
```bash
jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' "$FLEET_PAYLOAD_PATH"
```
**硬阈值**: 三字段逐字相等且 target SHA 为 40 位小写十六进制；命令 exit 0。

### Step 2: 核对冻结基线与 GP 唯一性
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 2 项。

**可观测行为**: 执行基线为 `676fed7de12023d355deac7849af8a525ae53f8d`，GP 精确唯一解析至 step7。

**验证命令**:
```bash
jq -e '.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and (.target_head_sha|test("^[0-9a-f]{40}$"))' "$FLEET_PAYLOAD_PATH"
jq -e '[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1' product-map/generated/product-map.json
```
**硬阈值**: base SHA 精确相等、target 格式有效、GP 匹配数恰为 1。

### Step 3: 核对目标 PR 与候选 checkout
**来源**: `[FROM_PRD]` — 「背景」及 NFR 版本要求。

**可观测行为**: GitHub PR #1581 head、payload target 与 evaluator 实际 checkout commit 三者完全一致。

**验证命令**:
```bash
TARGET=$(jq -er '.target_head_sha' "$FLEET_PAYLOAD_PATH"); PR_HEAD=$(curl -fsS https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -er '.head.sha'); CHECKED=$(git rev-parse --verify 'HEAD^{commit}'); [ "$TARGET" = "$PR_HEAD" ] && [ "$TARGET" = "$CHECKED" ]
```
**硬阈值**: 三个值均等于完整 target SHA；GitHub 不可用或 ref 不可验证均失败。

### Step 4: 核对结果证据绑定
**来源**: `[FROM_PRD]` — 「Golden Path（核心场景）」第 3 项。

**可观测行为**: Fleet 已有结果证据明确记录目标仓库、target SHA 与 GP anchor，证据摘要的 candidate SHA 与 target 相同。

**验证命令**:
```bash
jq -e --slurpfile p "$FLEET_PAYLOAD_PATH" '.target.base_repo==$p[0].base_repo and .target.target_head_sha==$p[0].target_head_sha and .target.gp_anchor==$p[0].gp_anchor and .evidence.candidate_sha==$p[0].target_head_sha' "$FLEET_RESULT_PATH"
```
**硬阈值**: 四项绑定断言全部为 true；命令 exit 0。字段路径使用 Fleet 结果既有字段，不定义新的结果 schema。

### Step 5: 三字段篡改均可靠失败
**来源**: `[FROM_PRD]` — 「边界情况」前三项。

**可观测行为**: 对原始 payload 逐项删除或篡改时，相同 oracle 全部非零退出，且不回退 workspace HEAD 或猜测其他 GP。

**验证命令**:
```bash
bash -c 'set -euo pipefail; D=$(mktemp -d); trap '"'"'rm -rf "$D"'"'"' EXIT; for E in '"'"'del(.base_repo)'"'"' '"'"'.target_head_sha="short"'"'"' '"'"'.gp_anchor="line02/keyword_acquisition#step6"'"'"'; do jq "$E" "$FLEET_PAYLOAD_PATH" > "$D/p.json"; jq -e '"'"'.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and (.target_head_sha|test("^[0-9a-f]{40}$"))'"'"' "$D/p.json" >/dev/null && { echo "FAIL: 篡改被接受"; exit 1; } || :; done'
```
**硬阈值**: 三个篡改变体均被拒绝；总命令 exit 0。

## 真实调用方请求 shape

- 生产同形输入为 Fleet Worker 收到的 Harness Initiative payload JSON；关键 keys 为 `base_repo`、`target_head_sha`、`gp_anchor`、`base_sha`。
- 认证与 validation identity 不进入 payload：Evaluator 在执行时从 Runner 注入的 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID` late-bind。
- GitHub 读取为 `GET /repos/perfectuser21/zenithjoy-workspace/pulls/1581`；可选 token 仅走 `Authorization` header。

## 禁 mock 边清单

- Fleet 原始 payload 文件 ↔ oracle（必须读真实派发 payload，不造测试 payload冒充成功）。
- GitHub PR #1581 ↔ target SHA（必须真调 GitHub API）。
- evaluator checkout ↔ target SHA（必须用 `git rev-parse --verify 'HEAD^{commit}'` 真读候选 checkout）。
- Fleet 结果证据 ↔ payload（必须读本轮真实结果文件）。

## 接缝清单

- [接缝×2] GitHub PR head：真调两次并分别与 payload target 比较；两次不一致判 FLAKY。
- Fleet 候选 checkout：真实读取 evaluator checkout commit；未在目标 checkout 执行时为 `logic-done-pending`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${FLEET_PAYLOAD_PATH:?Runner 必须提供本轮原始 Fleet payload JSON}"
: "${FLEET_RESULT_PATH:?Runner 必须提供本轮 Fleet 结果 JSON}"
: "${DB_URL:?Fleet 必须注入本 attempt 的短期 Postgres URL}"
: "${HARNESS_ATTEMPT_ID:?}"
: "${HARNESS_PROVIDER:?}"
: "${HARNESS_ACCOUNT:?}"
: "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"
: "${CAPABILITY_SNAPSHOT_ID:?}"
RUN_TMP=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r36-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$RUN_TMP"' EXIT
jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and (.target_head_sha|test("^[0-9a-f]{40}$")) and .gp_anchor=="line02/keyword_acquisition#step7" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"' "$FLEET_PAYLOAD_PATH"
jq -e '[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1' product-map/generated/product-map.json
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc 'SELECT 1' | grep -qx 1
TARGET=$(jq -er '.target_head_sha' "$FLEET_PAYLOAD_PATH")
for n in 1 2; do curl -fsS https://api.github.com/repos/perfectuser21/zenithjoy-workspace/pulls/1581 > "$RUN_TMP/pr-$n.json"; jq -er '.head.sha' "$RUN_TMP/pr-$n.json" | grep -qx "$TARGET"; done
CHECKED=$(git rev-parse --verify 'HEAD^{commit}')
[ "$CHECKED" = "$TARGET" ]
jq -e --slurpfile p "$FLEET_PAYLOAD_PATH" '.target.base_repo==$p[0].base_repo and .target.target_head_sha==$p[0].target_head_sha and .target.gp_anchor==$p[0].gp_anchor and .evidence.candidate_sha==$p[0].target_head_sha' "$FLEET_RESULT_PATH"
for E in 'del(.base_repo)' '.target_head_sha="short"' '.gp_anchor="line02/keyword_acquisition#step6"'; do jq "$E" "$FLEET_PAYLOAD_PATH" > "$RUN_TMP/bad.json"; if jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and (.target_head_sha|test("^[0-9a-f]{40}$")) and .gp_anchor=="line02/keyword_acquisition#step7"' "$RUN_TMP/bad.json" >/dev/null; then echo 'FAIL: 篡改被接受'; exit 1; fi; done
if curl -fsS --connect-timeout 2 http://127.0.0.1:1 >/dev/null; then echo 'FAIL: GitHub 故障探针未失败'; exit 1; fi
if psql 'postgresql://127.0.0.1:1/unreachable?connect_timeout=2' -tAc 'SELECT 1' >/dev/null 2>&1; then echo 'FAIL: Postgres 故障探针未失败'; exit 1; fi
printf 'PASS provider=%s account=%s machine=%s model=%s attempt=%s capability=%s target=%s\n' "$HARNESS_PROVIDER" "$HARNESS_ACCOUNT" "$HARNESS_MACHINE" "$HARNESS_MODEL" "$HARNESS_ATTEMPT_ID" "$CAPABILITY_SNAPSHOT_ID" "$TARGET"
```

通过标准：7200 秒内 exit 0；payload、PR head、checkout、结果证据全部绑定同一 SHA；两次 GitHub 接缝结果一致。依赖不可用或字段不一致必须非零退出。

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 三字段分别传 null、数组、大小写变化。
- 重复提交: 同一原始 payload 连续核验，结果应稳定。
- 中途中断: GitHub/Postgres 连接中断时不得留下成功输出。
- 边界值: SHA 40 位但不存在；GP anchor 含空格或 suffix。
发现分级: P0/P1（错提交误报通过）阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet payload 验收合同 | `sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-target-validation.test.ts` | 合同要求原始 payload 三字段；合同要求 PR head、checkout 与结果证据同 SHA；合同拒绝三个篡改变体；合同使用 late-bound evaluator identity | Round 2 合同虚构生产 verifier 与结果 schema，范围断言失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- Postgres 仅作为 Fleet runtime 依赖做真实连通性与故障闭环；本 Sprint 不改 schema、不写业务表，因此无需 migration/signup/tenant 自举。
- 本轮删除 Round 2 虚构的生产 verifier、结果分类 schema 与实现任务；合同只验 PRD 要求的既有 Fleet 行为。
