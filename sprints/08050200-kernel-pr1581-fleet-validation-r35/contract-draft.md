# Sprint Contract Draft (Round 2)

## Notes

- contract-gate: skipped (packages/brain/src/lib/contract-gate.js not found, third-party repo)
- 本合同只验证 Fleet Worker 对真实 Harness task bundle 的消费；不授权修改 PR #1581、Harness 调度或共享 CI 基础设施。
- Round 1 中不存在于 Fleet 运行面的 `HARNESS_TASK_PAYLOAD_JSON`、`FLEET_VALIDATOR`、`FLEET_VALIDATION_RECEIPT` 已全部删除。真实入口固定为 Runner 注入的 `HARNESS_TASK_BUNDLE_FILE`，回执由本轮 E2E 从真实校验结果生成到会话独享临时目录。
- validation identity 仅从执行 Evaluator 时 Runner 注入的 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID` late-bind。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

`jq` 已核实 `line02/keyword_acquisition#step7` 在 product-map 中唯一存在。

## Response Schema（推导来源: PRD字面）

本任务不新增 HTTP endpoint。E2E 生成下列 JSON 审计回执：

```json
{"status":"passed|failed|environment_failed","base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","failure_class":null,"validation_identity":{"attempt_id":"<HARNESS_ATTEMPT_ID>","provider":"<HARNESS_PROVIDER>","account":"<HARNESS_ACCOUNT>","machine":"<HARNESS_MACHINE>","model":"<HARNESS_MODEL>","runner_digest":"<HARNESS_RUNNER_DIGEST>","capability_snapshot_id":"<CAPABILITY_SNAPSHOT_ID>"}}
```

- 顶层 keys 必须精确为 `base_repo,base_sha,failure_class,gp_anchor,status,target_head_sha,validation_identity`。
- 成功时 `status=passed`、`failure_class=null`；输入错误为 `failed`，依赖不可用为 `environment_failed`，后两者的进程退出码必须非零。
- 禁用同义字段：`repo`、`head_sha`、`anchor`、`ok`。

## 已知约束（来自回归测试与累积 FR）

- [回归测试] 当前仓库没有 Fleet Worker 实现或三字段消费测试；因此合同只使用 Fleet 真实 task bundle 文件、git、GitHub 与 Postgres，不虚构仓内校验器。
- [累积FR] 本 line 暂无历史。
- `git rev-parse` 必须使用 `--verify "${TARGET_HEAD_SHA}^{commit}"`；禁止回退到工作区 HEAD。
- GitHub/Postgres 失败必须分类为环境失败；写入和核验共用同一 `DB_URL`。
- 共享 CI 基础设施是默认禁区。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 从真实 task bundle 读取 `base_repo`、`target_head_sha`、`gp_anchor`，相对冻结 base SHA 校验并产出审计回执。 |
| NFR（做得多好） | 7200 秒内完成；结论逐字记录四个冻结对象与失败分类。 |
| Invariant（永不违反） | 不从标题、当前 HEAD 或隐含状态补猜；依赖失败不冒充 passed。 |
| 判定点（怎么知道） | 见下表。 |
| 保质期（何时过期） | 仅对 PR #1581 及两个冻结 SHA 有效，PR head 改变即失效。 |
| 死亡告警（停了谁知道） | oracle 非零退出并把分类留在会话证据，Harness controller 收账。 |
| 失败语义（挂了怎么办） | 输入错误 fail-closed；git/GitHub/Postgres 不可用返回 environment_failed；可安全重跑。 |
| 效果确认（已发≠已生效） | 真读 bundle、真查 PR head、真解析 commit、真查 product-map、真连 attempt Postgres 后才写 passed。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ PR #1581 head 是否匹配 | 当前工作区 HEAD；GitHub PR API `.head.sha` | GitHub PR API | PRD 禁止回退工作区 HEAD | 错验提交并误报成功 |
| GP 锚点是否唯一 | 文本猜测；product-map line/id/step 精确查询 | product-map 精确查询 | 分类 SSOT | 锚到错误业务步骤 |

PrepPRD 已明确拍板上述判定点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| bundle 字段缺失、格式错、事实不一致 | `failed`，非零退出 | 是 | 无，fail-closed |
| git/GitHub/Postgres 不可用 | `environment_failed`，非零退出 | 是 | 依赖恢复后重试，不得 passed |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness task bundle JSON | 不可信结构化输入 | `jq` 只读取白名单路径并严格校验类型、格式和值，不执行内容 | 非白名单字段不参与目标选择；缺失/冲突即失败 |

## 真实调用方请求 shape

Fleet Runner 的真实入口是 `${HARNESS_TASK_BUNDLE_FILE}`。Harness bundle 的稳定 envelope 是 `.inputs`，待验 Fleet payload 三字段直接位于该 object：

```json
{"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7"}
```

DoD 与 E2E 只从该真实文件路径的 `.inputs.base_repo/.inputs.target_head_sha/.inputs.gp_anchor` 读取；缺字段直接判输入失败，不使用环境 JSON、标题或 workspace HEAD 兜底。

## 禁 mock 边清单

- Runner task bundle 文件 ↔ Fleet payload 消费（必须读取 `HARNESS_TASK_BUNDLE_FILE`）。
- payload ↔ GitHub PR #1581 / git object / product-map（必须真查三项事实）。
- oracle ↔ attempt Postgres（必须对 Fleet 注入的同一 `DB_URL` 执行 `SELECT 1`，不得替身）。

## 未覆盖真实链路清单

（本合同无 mock、stub、force 或假数据，N/A）

## 接缝清单

- [接缝×2] GitHub PR head：真调两次且都等于 payload SHA；不一致判 FLAKY。
- Postgres 资源：真连 Fleet 注入的 attempt `DB_URL`；不可用只可判 environment_failed。

## Golden Path

覆盖父路 `line02/keyword_acquisition` 第 7-7 步。

[入口] Runner task bundle → 校验 payload 与冻结事实 → [出口] 当前 Evaluator 身份绑定的审计回执

### Step 1: 从真实 task bundle 读取权威 payload
**来源**: `[FROM_PRD]` — Golden Path 第 1 项。

**可观测行为**: `.inputs` 中三字段存在且逐字等于 PRD 值。

**验证命令**:
```bash
jq -e '.inputs | type=="object" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7"' "$HARNESS_TASK_BUNDLE_FILE"
```
**硬阈值**: 3/3 字段精确匹配，exit 0。

### Step 2: 相对冻结基线核验真实目标
**来源**: `[FROM_PRD]` — Golden Path 第 2 项。

**可观测行为**: base/target 都是可解析 commit，PR head 等于 target，GP step 唯一，Postgres 可连接。

**验证命令**:
```bash
bash -c 'set -euo pipefail; B=676fed7de12023d355deac7849af8a525ae53f8d; T=$(jq -er .inputs.target_head_sha "$HARNESS_TASK_BUNDLE_FILE"); git rev-parse --verify "${B}^{commit}" | grep -qx "$B"; git rev-parse --verify "${T}^{commit}" | grep -qx "$T"; test "$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 --jq .head.sha)" = "$T"; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1'\'' product-map/generated/product-map.json; psql "$DB_URL" -XtAc "SELECT 1" | grep -qx 1'
```
**硬阈值**: 五项全部 exit 0；依赖错误不得跳过。

### Step 3: 输出绑定相同目标与当前执行身份的回执
**来源**: `[FROM_PRD]` — Golden Path 第 3 项。

**可观测行为**: E2E 由真实校验结果构建 receipt，字段与当前 Evaluator identity 全部精确匹配。

**验证命令**:
```bash
jq -e --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg c "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg d "$HARNESS_RUNNER_DIGEST" --arg s "$CAPABILITY_SNAPSHOT_ID" 'keys==["base_repo","base_sha","failure_class","gp_anchor","status","target_head_sha","validation_identity"] and .status=="passed" and .failure_class==null and .validation_identity=={attempt_id:$a,provider:$p,account:$c,machine:$m,model:$model,runner_digest:$d,capability_snapshot_id:$s}' "$RECEIPT_FILE"
```
**硬阈值**: keys 完整性通过、目标 4/4 与 identity 7/7 精确匹配。

### Step 4: 字段错误和依赖失败 fail-closed
**来源**: `[FROM_PRD]` — 边界情况四项。

**可观测行为**: 独立 oracle 脚本逐项验证缺仓库、短 SHA、错 anchor、GitHub 失败、Postgres 失败均非零且不产生 passed。

**验证命令**:
```bash
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-oracle.sh --negative-matrix "$HARNESS_TASK_BUNDLE_FILE"
```
**硬阈值**: 5/5 负例被拒，脚本汇总 exit 0。

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_TASK_BUNDLE_FILE:?Runner must inject the actual task bundle path}"
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
: "${HARNESS_ATTEMPT_ID:?}" "${HARNESS_PROVIDER:?}" "${HARNESS_ACCOUNT:?}" "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}" "${HARNESS_RUNNER_DIGEST:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
EVIDENCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-validation-${HARNESS_ATTEMPT_ID}.XXXXXX")
RECEIPT_FILE="$EVIDENCE_DIR/receipt.json"
export RECEIPT_FILE
trap 'rm -rf "$EVIDENCE_DIR"' EXIT
PAYLOAD=$(jq -cer '.inputs | select(type=="object")' "$HARNESS_TASK_BUNDLE_FILE") || { echo 'INPUT_FAIL: missing inputs'; exit 1; }
BASE_REPO=$(jq -er '.base_repo|select(type=="string")' <<<"$PAYLOAD")
TARGET_HEAD_SHA=$(jq -er '.target_head_sha|select(type=="string" and test("^[0-9a-f]{40}$"))' <<<"$PAYLOAD")
GP_ANCHOR=$(jq -er '.gp_anchor|select(type=="string")' <<<"$PAYLOAD")
[ "$BASE_REPO" = perfectuser21/zenithjoy-workspace ] && [ "$TARGET_HEAD_SHA" = c305f6217da65bb69413c39e621b7e797e0fb189 ] && [ "$GP_ANCHOR" = line02/keyword_acquisition#step7 ] || { echo 'INPUT_FAIL: frozen payload mismatch'; exit 1; }
BASE_SHA=676fed7de12023d355deac7849af8a525ae53f8d
git rev-parse --verify "${BASE_SHA}^{commit}" | grep -qx "$BASE_SHA" || { echo 'ENVIRONMENT_FAIL: base commit unavailable'; exit 2; }
git rev-parse --verify "${TARGET_HEAD_SHA}^{commit}" | grep -qx "$TARGET_HEAD_SHA" || { echo 'ENVIRONMENT_FAIL: target commit unavailable'; exit 2; }
for run in 1 2; do REMOTE_HEAD=$(gh api "repos/$BASE_REPO/pulls/1581" --jq .head.sha) || { echo 'ENVIRONMENT_FAIL: GitHub unavailable'; exit 2; }; [ "$REMOTE_HEAD" = "$TARGET_HEAD_SHA" ] || { echo "INPUT_FAIL: PR head mismatch run=$run"; exit 1; }; done
jq -e '[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition" and any(.steps[];.id=="step7"))]|length==1' product-map/generated/product-map.json
psql "$DB_URL" -v ON_ERROR_STOP=1 -XtAc 'SELECT 1' | grep -qx 1 || { echo 'ENVIRONMENT_FAIL: Postgres unavailable'; exit 2; }
jq -n --arg repo "$BASE_REPO" --arg base "$BASE_SHA" --arg head "$TARGET_HEAD_SHA" --arg gp "$GP_ANCHOR" --arg a "$HARNESS_ATTEMPT_ID" --arg p "$HARNESS_PROVIDER" --arg c "$HARNESS_ACCOUNT" --arg m "$HARNESS_MACHINE" --arg model "$HARNESS_MODEL" --arg d "$HARNESS_RUNNER_DIGEST" --arg s "$CAPABILITY_SNAPSHOT_ID" '{status:"passed",base_repo:$repo,base_sha:$base,target_head_sha:$head,gp_anchor:$gp,failure_class:null,validation_identity:{attempt_id:$a,provider:$p,account:$c,machine:$m,model:$model,runner_digest:$d,capability_snapshot_id:$s}}' > "$RECEIPT_FILE"
jq -e 'keys==["base_repo","base_sha","failure_class","gp_anchor","status","target_head_sha","validation_identity"] and .status=="passed" and .failure_class==null' "$RECEIPT_FILE"
bash sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-oracle.sh --negative-matrix "$HARNESS_TASK_BUNDLE_FILE"
sha256sum "$RECEIPT_FILE"
echo 'PASS: Fleet payload 与目标 PR head 的审计绑定成立'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet payload 与冻结目标绑定 | `sprints/08050200-kernel-pr1581-fleet-validation-r35/tests/fleet-payload-contract.test.ts` | `拒绝缺失或篡改的权威 payload 字段`、`审计回执绑定冻结目标与当前 validation identity` | oracle 脚本尚未实现时测试失败 |

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: repo 大小写变化、SHA 39/41 位、anchor 空格或 step07
- 重复提交: 同一 bundle 连续验证两次，目标字段一致
- 中途中断: GitHub/Postgres 断开后不得残留 passed receipt
- 边界值: fleet_payload 为 null/数组或含多余字段
发现分级: P0/P1（错验提交或环境错误误报通过）阻塞 merge；P2/P3 记录 findings。
