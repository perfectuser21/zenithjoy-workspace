# Sprint Contract Draft（Round 1）

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD 字面）

本任务无 HTTP 响应；Fleet Worker 的可审计结论是 JSON：

```json
{"ok":true,"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","failure_class":null}
```

- `ok` (boolean，必填)：三项 payload、冻结基线和 PR 实际 head 全部一致时才为 true。
- `base_repo`、`target_head_sha`、`gp_anchor`、`base_sha` (string，必填)：必须原样记录权威输入。
- `failure_class` (string|null，必填)：成功为 null；输入错误为 `payload_invalid`，GitHub/Git 依赖不可用为 `environment_failure`。
- 禁止字段：以任务标题、当前分支或工作区 HEAD 替代上述字段的任何隐式来源。

## 已知约束

- [product-map] `line02/keyword_acquisition#step7` 存在，名称为“评论区挖客闭环”。
- [回归 smoke] `.github/workflows/scripts/smoke/golden-path-2-smoke.sh` 是该父路登记的 smoke；本 sprint 不改业务 smoke。
- [累积 FR] 本 line 暂无历史。
- api/db/test registry 未发现 Fleet Worker 专用端点或表；采用 PRD 字面 CLI/JSON 合同 `[NEW_PATTERN]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 从 payload 消费 `base_repo`、`target_head_sha`、`gp_anchor`，与冻结 base 和真实 PR head 对账，输出绑定证据。 |
| NFR | 7200 秒内完成；所有失败非零退出；不得泄露凭据。 |
| Invariant | 不读标题猜目标，不回退工作区 HEAD；同一 SHA 语义在判变和终验一致。 |
| 判定点 | 见下表。 |
| 保质期 | 仅对 PR #1581 head 为指定 SHA 的冻结运行有效；head 漂移即失效。 |
| 死亡告警 | 非零退出及 `failure_class` 由 Harness controller 在本 attempt 内记录。 |
| 失败语义 | 输入错误与环境错误均拦截成功结论，不降级。 |
| 效果确认 | JSON 四个绑定字段、`git merge-base` 和 GitHub PR head 三方交叉验证。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR head 是否与 payload 同一提交 | 工作区 HEAD；GitHub PR head OID | GitHub PR #1581 `headRefOid` 精确比较 | PRD 明确禁止回退工作区 HEAD | 验错提交并误报通过 |
| GP 锚点是否唯一有效 | 模糊名称；product-map 精确 line/id/step | `jq` 精确解析 line、GP、step | product-map 是分类 SSOT | 验错业务步骤 |

notes: judgment-pending-user: PR head 是否与 payload 同一提交（PrepPRD 以 assumption 给出，但本合同仍机械精确核验）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| payload 缺失/格式或值不符 | exit 非零，`payload_invalid` | 是 | 不猜测、不回退 |
| GitHub/Git/Postgres 依赖不可用 | exit 非零，`environment_failure` | 是 | 不误报业务通过 |
| PR head 漂移 | exit 非零，`payload_invalid` | 是 | 要求新冻结输入 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness task payload | 不可信结构化输入 | 仅接受固定键、固定格式与精确值；不执行字段内容 | 未知键不影响权威值，必填键异常立即拒绝 |

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步。

[正确 payload 进入] → [字段及冻结基线校验] → [GitHub/Git/GP 三方对账] → [绑定同一提交的审计结论]

### Step 1：接收权威 payload

**来源**: `[FROM_PRD]` — “Golden Path 具体 1”及范围限定。

**可观测行为**: 工具只从输入 JSON 读取三个权威字段，完整 SHA 必须为 40 位小写十六进制。

**验证命令**:
```bash
node sprints/08051905-kernel-pr1581-fleet-validation-r39/validate-fleet-payload.mjs --payload "$PAYLOAD_FILE" --evidence "$EVIDENCE_FILE" | jq -e '.base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"'
```

**硬阈值**: 三字段逐字一致；任一缺失或异常均 exit 非零。

### Step 2：以冻结基线校验目标提交

**来源**: `[FROM_PRD]` — “Golden Path 具体 2”及 NFR 版本要求。

**可观测行为**: 验证目标 SHA 是 commit，冻结 base 是其祖先；不存在 ref 不得被裸 `rev-parse` 字面回显骗过。

**验证命令**:
```bash
git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null && git rev-parse --verify "c305f6217da65bb69413c39e621b7e797e0fb189^{commit}" >/dev/null && git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d c305f6217da65bb69413c39e621b7e797e0fb189
```

**硬阈值**: 两 ref 均为 commit，且 base 是 target 的祖先；命令总耗时 ≤7200 秒。

### Step 3：输出可审计验收结论

**来源**: `[FROM_PRD]` — “Golden Path 具体 3”及边界情况。

**可观测行为**: 结论精确记录仓库、目标、锚点、基线和失败分类；GitHub PR head 与 payload 不一致时不产生 `ok:true`。

**验证命令**:
```bash
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,baseRefOid | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .baseRefOid=="676fed7de12023d355deac7849af8a525ae53f8d"'
```

**硬阈值**: `ok=true` 仅在全部精确核验通过时出现；失败必须有非空 `failure_class`。

## 真实调用方请求 shape

- 输入介质：Fleet Worker 接收的任务 `payload` JSON，而非标题或环境猜测。
- 必填键及类型：`base_repo:string`、`target_head_sha:string`、`gp_anchor:string`。
- 固定运行对象：PR #1581、`base_sha=676fed7de12023d355deac7849af8a525ae53f8d`。
- validation identity 只从 Runner 注入的 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID` 读取；合同不固化角色 UUID。

## 禁 mock 边清单

- Fleet payload → 校验器（本单验证跨模块字段传递，测试必须传真实 JSON 文件）。
- 校验器 → Git/GitHub PR 元数据（必须真查 commit 与 PR #1581，禁止 mock）。
- 校验器 → product-map GP SSOT（必须真读生成 JSON，禁止复制锚点列表）。

## 接缝清单

- GitHub PR #1581 head：真 `gh pr view` 对账；外部不可用标 `environment_failure`。[接缝×2]
- 本地 Git object：真 `git rev-parse --verify ...^{commit}` 与 `merge-base`；不可用不得回退。
- Postgres 为 Fleet 提供的运行资源，但本 sprint 不定义业务表；若执行面要求写审计账，连接失败必须归 `environment_failure`，不得改变 payload 判定。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: SHA 大写、39/41 位 SHA、锚点 step07、仓库名前后空格。
- 重复提交: 同一 payload 连跑两次，结论应一致且不污染输入。
- 中途中断: `gh` 不可达或 commit object 缺失时必须环境失败。
- 边界值: 空 JSON、null、额外未知键、当前工作区 HEAD 恰好不同。
发现分级: P0/P1（误验提交或误报通过）阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation attempt}"
: "${HARNESS_PROVIDER:?}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
SPRINT_DIR="sprints/08051905-kernel-pr1581-fleet-validation-r39"
SESSION_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-payload-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$SESSION_DIR"' EXIT
PAYLOAD_FILE="$SESSION_DIR/payload.json"
EVIDENCE_FILE="$SESSION_DIR/evidence.json"
jq -n '{base_repo:"perfectuser21/zenithjoy-workspace",target_head_sha:"c305f6217da65bb69413c39e621b7e797e0fb189",gp_anchor:"line02/keyword_acquisition#step7"}' > "$PAYLOAD_FILE"
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid,baseRefOid > "$EVIDENCE_FILE" || { echo 'environment_failure: GitHub unavailable'; exit 1; }
git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null || { echo 'environment_failure: base commit unavailable'; exit 1; }
git rev-parse --verify "c305f6217da65bb69413c39e621b7e797e0fb189^{commit}" >/dev/null || { echo 'environment_failure: target commit unavailable'; exit 1; }
git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d c305f6217da65bb69413c39e621b7e797e0fb189
jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189" and .baseRefOid=="676fed7de12023d355deac7849af8a525ae53f8d"' "$EVIDENCE_FILE"
jq -e '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | .steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json
OUT=$(node "$SPRINT_DIR/validate-fleet-payload.mjs" --payload "$PAYLOAD_FILE" --evidence "$EVIDENCE_FILE")
echo "$OUT" | jq -e 'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","target_head_sha"] and .ok==true and .failure_class==null and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"'
for KEY in base_repo target_head_sha gp_anchor; do jq "del(.$KEY)" "$PAYLOAD_FILE" > "$SESSION_DIR/bad.json"; if node "$SPRINT_DIR/validate-fleet-payload.mjs" --payload "$SESSION_DIR/bad.json" --evidence "$EVIDENCE_FILE" >"$SESSION_DIR/bad.out" 2>&1; then echo "FAIL: missing $KEY accepted"; exit 1; fi; grep -q 'payload_invalid' "$SESSION_DIR/bad.out"; done
echo 'OK: Fleet payload 与 PR #1581、冻结基线及 GP Step 7 绑定'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| payload 权威消费 | `sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/fleet-payload-validation.test.ts` | 正确 payload 输出完整绑定结论；缺失 base_repo 拒绝；target_head_sha 不一致拒绝；gp_anchor 不唯一拒绝 | 校验器模块尚不存在，测试套件加载失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 不修改 PR #1581 业务实现、共享 CI、smoke allowlist 或 Harness 调度策略。
