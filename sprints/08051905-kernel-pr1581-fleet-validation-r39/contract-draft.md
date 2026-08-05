# Sprint Contract Draft（Round 3）

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD 字面）

Fleet Worker 的真实入口是 Runner 注入的 `${HARNESS_TASK_BUNDLE_FILE}`；验收器只读该原始 bundle，不从 Brain 任务或 sprint fixture 重建输入：

```json
{"task_bundle":{"execution_surface":"fleet-worker","inputs":{"workspace_spec":{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","expected_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189"}}}}
```

- bundle 必须是本角色真实 `${HARNESS_TASK_BUNDLE_FILE}`；验收前后 SHA-256 相同。成功结论不得从 thin_prd、Brain task、任务标题、分支名或当前工作区补字段。
- 验收输出为 `{"ok":true,"failure_class":null,"receipt_sha256":"<64hex>","base_repo":"...","base_sha":"...","target_head_sha":"...","gp_anchor":"..."}`；keys 精确为上述七项。
- 输入错误为 `payload_invalid`；GitHub、Git、Postgres、receipt 不可读为 `environment_failure`，均非零且不得含 `ok:true`。

## 已知约束

- [PRD] 三个 payload 字段必须由 Fleet Worker 实际消费并绑定同一 target SHA；冻结 base 只验证祖先关系。
- [product-map] `line02/keyword_acquisition#step7` 唯一存在，smoke 为 `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`。
- [累积 FR] 本 line 暂无历史；context-manifest 内容已由冻结 PRD 提供。
- [回归测试] 未发现仓库内 Fleet Worker 实现（execution surface 属 Fleet）；因此真实 worker receipt 是不可由 sprint 代码伪造的边界证据。[NEW_PATTERN]

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 验证 Fleet Worker 消费三字段、检出指定 target，并输出绑定同一 receipt 摘要的结论。 |
| NFR | 7200 秒内；真实 bundle 验收前后摘要不变；错误非零。 |
| Invariant | 不从 Brain task/标题/分支/HEAD 补权威输入；冻结 base 与 target 各司其职。 |
| 判定点 | 见登记表。 |
| 保质期 | PR #1581 head 或冻结输入变化即失效。 |
| 死亡告警 | evaluator 记录 exit code、failure_class 与 receipt SHA-256。 |
| 失败语义 | 输入错为 payload_invalid；依赖错为 environment_failure；全部 fail closed。 |
| 效果确认 | Fleet 原始 bundle、实际 checkout、GitHub head、Git 祖先、GP SSOT、空库 migration 六方一致。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Fleet Worker 是否真实消费 payload | 读 Brain 派发记录；读当前角色原始 bundle | `${HARNESS_TASK_BUNDLE_FILE}` + 当前 checkout 双证据 | 该文件是 Worker 启动角色的实际输入，不是派发副本 | 验错提交却成功 |
| ⚠️ PR head 是否相同 | 工作区分支名；GitHub headRefOid | receipt checkout SHA、`git HEAD` 与 GitHub head 三方精确相等 | PRD 禁止回退隐含状态 | 验收结论错绑 |
| GP 是否唯一 | 模糊名字；SSOT 精确解析 | product-map 中 line/GP/step 唯一 | 分类 SSOT | 验错步骤 |

notes: judgment-pending-user: 两个 ⚠️ 判定点沿用 PrepPRD assumption，以六方机器证据封闭。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 三字段缺失、错值、SHA 非完整小写 40hex、锚点不唯一 | 非零，`payload_invalid` | 是 | 不猜测、不回退 |
| bundle 缺失/执行中被改，GitHub/Git/Postgres 不可用 | 非零，`environment_failure` | 是 | 不产生成功结论 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Fleet payload/receipt | 不可信结构化输入 | 只解析固定 JSON key；内容不执行 | 缺失、额外权威来源或格式错立即拒绝 |

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步。

[Fleet Worker 以原始 bundle 启动角色] → [检出冻结 target] → [六方对账] → [可审计结论]

### Step 1：读取 Fleet Worker 的真实入口 bundle
**来源**: `[FROM_PRD]` — Golden Path 第 1 步及“Fleet Worker 以 payload 为权威输入”。

**可观测行为**: `${HARNESS_TASK_BUNDLE_FILE}` 是当前 Worker 启动本角色所消费的文件；三个字段必须位于结构化 `workspace_spec`，不得只藏在 `thin_prd` 文本。验收器记录前后摘要证明未篡改。

**验证命令**:
```bash
BUNDLE_SHA=$(sha256sum "$HARNESS_TASK_BUNDLE_FILE" | awk '{print $1}'); jq -e '.task_bundle.execution_surface=="fleet-worker" and .task_bundle.inputs.workspace_spec.base_repo=="perfectuser21/zenithjoy-workspace" and .task_bundle.inputs.workspace_spec.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .task_bundle.inputs.workspace_spec.gp_anchor=="line02/keyword_acquisition#step7" and .task_bundle.inputs.workspace_spec.attempt_id==$ENV.HARNESS_ATTEMPT_ID' "$HARNESS_TASK_BUNDLE_FILE"; test "$BUNDLE_SHA" = "$(sha256sum "$HARNESS_TASK_BUNDLE_FILE" | awk '{print $1}')"
```
**硬阈值**: 三字段、执行面、当前角色身份精确相等；bundle 前后摘要相同，5 秒内完成。

### Step 2：确认 Worker 棣出的 target 与冻结 base
**来源**: `[FROM_PRD]` — Golden Path 第 2 步及版本 NFR。

**可观测行为**: bundle `expected_head_sha`、实际 `HEAD`、GitHub PR head 精确等于 target；冻结 base 是 target 祖先，不与可漂移 baseRefOid 比较。

**验证命令**:
```bash
test "$(jq -r .task_bundle.inputs.workspace_spec.expected_head_sha "$HARNESS_TASK_BUNDLE_FILE")" = "$(git rev-parse --verify HEAD^{commit})" && test "$(git rev-parse --verify HEAD^{commit})" = c305f6217da65bb69413c39e621b7e797e0fb189 && git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null && git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d c305f6217da65bb69413c39e621b7e797e0fb189 && gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"'
```
**硬阈值**: 三个 target SHA 完全一致且 base 为祖先；依赖失败不得转业务 PASS。

### Step 3：输出绑定 receipt 摘要的结论
**来源**: `[FROM_PRD]` — Golden Path 第 3 步与边界情况。

**可观测行为**: verifier 只消费真实 bundle 路径并输出其 SHA-256；每个非法输入与依赖故障均 fail closed。

**验证命令**:
```bash
OUT=$(node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-bundle-verifier.mjs "$HARNESS_TASK_BUNDLE_FILE"); DIGEST=$(sha256sum "$HARNESS_TASK_BUNDLE_FILE" | awk '{print $1}'); echo "$OUT" | jq -e --arg d "$DIGEST" 'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","receipt_sha256","target_head_sha"] and .ok==true and .failure_class==null and .receipt_sha256==$d'
```
**硬阈值**: schema 精确、摘要为当前 receipt；任一错误均 exit 非零。

## 真实调用方请求 shape

- Fleet Worker 输入字面键：`base_repo`、`target_head_sha`、`gp_anchor`；执行角色从 Runner 注入 `HARNESS_*` 与 `CAPABILITY_SNAPSHOT_ID`，不固化任何角色 UUID。
- 真消费证据是 Worker 实际用于启动当前角色的 `${HARNESS_TASK_BUNDLE_FILE}` 及其前后摘要，不是 Brain 派发记录或 sprint fixture。

## 禁 mock 边清单

- Fleet Worker payload 消费 ↔ Runner 原始 task bundle（happy path 必须使用 `${HARNESS_TASK_BUNDLE_FILE}`）。
- Runner bundle ↔ 实际 Git checkout/GitHub PR head（必须真三方对账）。
- verifier ↔ attempt Postgres schema（E2E 必须真跑仓库 migration 并查迁移表）。

## 接缝清单

- Fleet bundle 与 checkout/GitHub head 三方一致：[接缝×2]，Evaluator 重复两次，不一致为 FLAKY。
- attempt 空库 migration：同一 `DB_URL` 真执行并机检 `zenithjoy.schema_migrations`。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: bundle 中仓库错值、SHA 39/41 位或大写、锚点 `step07`。
- 重复提交: 同一 bundle 连验两次，摘要与结论相同。
- 中途中断: bundle、GitHub、Postgres 任一不可用，必须 environment_failure。
- 边界值: 三字段只在 thin_prd 出现、expected_head 与实际 checkout 不同。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DB_URL:?Fleet must inject attempt-scoped DB_URL}"
: "${HARNESS_TASK_BUNDLE_FILE:?Fleet Worker must inject its actual task bundle}"
: "${HARNESS_ATTEMPT_ID:?Runner identity must be late-bound}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner capability must be late-bound}"
SPRINT_DIR=sprints/08051905-kernel-pr1581-fleet-validation-r39
RUN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-eval-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$RUN_DIR"' EXIT

# attempt 空库使用仓库真实 migration，自举后机检结构；bundle 不存入 DB、不复制生产状态。
DATABASE_URL="$DB_URL" npm run migrate --workspace=apps/api >"$RUN_DIR/migration.log"
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc "SELECT to_regclass('zenithjoy.schema_migrations') IS NOT NULL" | grep -qx t

# 真实 bundle 必须结构化携带权威字段；只在 thin_prd 文本出现不算消费。
BUNDLE_SHA_BEFORE=$(sha256sum "$HARNESS_TASK_BUNDLE_FILE" | awk '{print $1}')
jq -e '.task_bundle.execution_surface=="fleet-worker" and .task_bundle.inputs.workspace_spec.attempt_id==$ENV.HARNESS_ATTEMPT_ID and .task_bundle.inputs.workspace_spec.base_repo=="perfectuser21/zenithjoy-workspace" and .task_bundle.inputs.workspace_spec.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .task_bundle.inputs.workspace_spec.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .task_bundle.inputs.workspace_spec.expected_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .task_bundle.inputs.workspace_spec.gp_anchor=="line02/keyword_acquisition#step7"' "$HARNESS_TASK_BUNDLE_FILE"
test "$(git rev-parse --verify HEAD^{commit})" = c305f6217da65bb69413c39e621b7e797e0fb189
git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null
git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d c305f6217da65bb69413c39e621b7e797e0fb189
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"'
jq -e '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | .steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json

OUT=$(node "$SPRINT_DIR/fleet-bundle-verifier.mjs" "$HARNESS_TASK_BUNDLE_FILE")
DIGEST=$(sha256sum "$HARNESS_TASK_BUNDLE_FILE" | awk '{print $1}')
echo "$OUT" | jq -e --arg d "$DIGEST" 'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","receipt_sha256","target_head_sha"] and .ok==true and .failure_class==null and .receipt_sha256==$d'
test "$BUNDLE_SHA_BEFORE" = "$(sha256sum "$HARNESS_TASK_BUNDLE_FILE" | awk '{print $1}')"
node --test "$SPRINT_DIR/tests/fleet-bundle-verifier.test.mjs"
echo 'OK: Fleet Worker 原始 bundle、checkout、PR head、冻结 base、GP 与空库 schema 已绑定'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 原始 bundle 消费验证 | `sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/fleet-bundle-verifier.test.mjs` | 真实 Fleet bundle 输出完整绑定结论；缺失字段拒绝；错误仓库拒绝；非完整 target SHA 拒绝；错 target SHA 拒绝；错误 GP 拒绝；bundle 与 checkout 不一致拒绝 | Node test runner 进入测试加载后因 `fleet-bundle-verifier.mjs` 尚不存在而失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 本 sprint 不修改 PR #1581、共享 CI、smoke allowlist 或 Harness 调度策略。
