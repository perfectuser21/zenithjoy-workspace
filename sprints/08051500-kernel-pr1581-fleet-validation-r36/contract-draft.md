# Sprint Contract Draft (Round 16)

## Notes

- contract-gate: skipped (file not found, third-party repo)
- R15-1 closure：在 `expectFleetEvidence`、B-01、Step 1/3 与 Final E2E 的真实 Fleet task/result 断言中新增冻结 `base_sha=676fed7de12023d355deac7849af8a525ae53f8d` 的精确校验，并新增 B-03B/同名生产链测试，把另一个格式有效的 commit SHA 作为错误 base_sha 派发，强制真实 Fleet Worker 返回 `failed/validation_input_invalid` 且点名 `base_sha`。现在仅 payload 保存 base_sha 或证据原样回显都不够：成功路径须绑定冻结值，变异路径须拒绝，足以关闭“未机检实际消费并核对冻结 base_sha”。
- validation identity 全部在执行时 late-bind；合同不固化 Proposer、Reviewer、Evaluator 或 Fleet 的 UUID/snapshot。

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD字面）

N/A — 本 Sprint 不新增 HTTP 响应。验收读取生产 Brain task/result：成功结论必须同时含 `base_repo`、`target_head_sha`、`gp_anchor`；失败必须为非 `completed` 终态并带失败分类。合同不定义第二套 verifier schema。

## 已知约束（来自回归测试与累积 FR）

- `[PRD 铁律]` 目标 ref 必须以 `git rev-parse --verify '<ref>^{commit}'` 核实，禁止回退当前工作区 HEAD。
- `[PRD 铁律]` GitHub/Postgres 不可用属于环境失败，不能写业务通过。
- `[累积FR]` 本 line 暂无历史；`context-manifest: unavailable`。
- `[回归测试]` 无仓库内 Fleet Worker 实现；Fleet Worker 属 `execution_surface=fleet-worker`，测试必须经 Brain 生产派发入口，不得补造本地 Worker。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR（做什么） | 真实 Fleet Worker 消费 payload 三字段，在冻结 base 上验证 PR #1581 并产审计结论。 |
| NFR（做得多好） | 7200 秒内；目标 SHA 精确；失败可分类。 |
| Invariant（永不违反） | 不从标题、分支名或工作区 HEAD 猜 repo/head/anchor。 |
| 判定点（怎么知道） | 见登记表。 |
| 保质期（何时过期） | PR head 改变即失效。 |
| 死亡告警（停了谁知道） | 任务非 completed，Evaluator/Judge 阻塞。 |
| 失败语义（挂了怎么办） | 字段错误 fail-closed；依赖错误标环境失败。 |
| 效果确认（已发≠已生效） | task payload、GitHub PR 真值、Fleet evidence 三方同 SHA；Evaluator receipt 引用 Fleet evidence 摘要。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 生产 Fleet Worker 是否真的执行 | 本地验证脚本输出；Brain task + Fleet evidence | Brain 生产派发后读取其 result/evidence | 防止独立 verifier 形成验收剧场 | 未执行 Worker 却误报通过 |
| ⚠️ PR #1581 head 是否匹配 payload | 当前 HEAD；GitHub API | GitHub API 精确比对 | PRD 明禁 HEAD 回退 | 错提交误报通过 |
| GP 锚点是否唯一 | 字符串正则；product-map SSOT | SSOT 唯一 line/GP/step | 分类 SSOT | 验错步骤 |

judgment-pending-user: 生产 Fleet evidence 的持久化字段名由当前 Kernel contract 决定；Evaluator 以 Brain task API 实际返回为准，不创建替代 receipt。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| payload 缺失/格式错 | 非 completed，字段分类 | 是 | 无 |
| repo/head/anchor 与权威不一致 | 非 completed，target mismatch | 是 | 无 |
| GitHub/Postgres 不可用 | 非 completed，environment failure | 是 | 恢复后重跑，禁业务 PASS |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness Initiative payload | 不可信结构化输入 | 固定字段、完整 SHA、严格 anchor grammar | 缺失/额外解释/冲突均 fail-closed |

## 真实调用方请求 shape

生产调用方通过 Brain 创建任务，认证沿 Brain 既有本机服务边界，JSON 为：

```json
{"task_type":"harness_initiative","title":"Fleet payload validation","payload":{"base_repo":"perfectuser21/zenithjoy-workspace","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","target_environment":"local_api"}}
```

DoD 必须逐字段复用该 shape，通过 `POST /api/brain/tasks` 进入真实 dispatcher/Fleet Worker；禁止直接调用测试 verifier。

## 禁 mock 边清单

- Brain tasks API ↔ dispatcher ↔ Fleet Worker（测试必须真实派发，不 mock dispatcher/Worker）。
- Fleet Worker ↔ GitHub PR、冻结 checkout、product-map（必须真对账）。
- Fleet Worker ↔ Brain/Postgres evidence 写路径（禁止测试直接 INSERT 或自行写成功 receipt）。

## 未覆盖真实链路清单

- 不主动破坏共享 GitHub/Postgres。依赖健康时无法安全制造真实故障，故障分类仍为 `logic-done-pending`；E2E 对正确 payload 的真实 Fleet task 若自然遭遇依赖失败，则强制校验 `environment_failure` 与依赖名，禁止用本地 preflight 结果冒充 Worker evidence。

## 接缝清单

- 正确 payload 经 Brain 真实派发一次；evidence 绑定 repo/base/head/anchor。
- 验收剧场风险：任何仅运行仓库内测试驱动器、未取得真实 Fleet task/result/evidence 的结果一律 FAIL。
- GitHub/Postgres 故障分类须在真实故障时验；未发生真实故障为 `logic-done-pending`。

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步

[正确 Initiative payload] → [Brain dispatcher] → [真实 Fleet Worker] → [冻结 base/PR head/GP 对账] → [同 SHA evidence]

### Step 1: 真实 Fleet Worker 收到权威 payload
**来源**: `[FROM_PRD]` — Golden Path 第 1 项。

**可观测行为**: Brain task 的原始 payload 精确保存 repo、冻结 base SHA、目标 head SHA、GP anchor，且 executor/execution surface 显示 Fleet Worker；成功 evidence 也必须回显同一冻结 base SHA，证明 Worker 实际消费而非仅由入口保存。

**验证命令**: `curl -sf localhost:5221/api/brain/tasks/$FLEET_TASK_ID | jq -e '.payload.base_repo=="perfectuser21/zenithjoy-workspace" and .payload.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .payload.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .payload.gp_anchor=="line02/keyword_acquisition#step7" and ((.execution_surface//.executor//"")|ascii_downcase|contains("fleet")) and ((.result//.metadata//{})|tostring|contains("676fed7de12023d355deac7849af8a525ae53f8d"))'`

**硬阈值**: curl/jq exit 0；禁止只读测试生成文件。

### Step 2: 以冻结基线对账真实 PR 与 GP
**来源**: `[FROM_PRD]` — Golden Path 第 2 项。

**可观测行为**: GitHub PR repo/base/head 与 SSOT Step 7 全部精确匹配。

**验证命令**: `bash -c 'gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 | jq -e '\''.head.repo.full_name=="perfectuser21/zenithjoy-workspace" and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .base.sha=="676fed7de12023d355deac7849af8a525ae53f8d"'\''; git rev-parse --verify "c305f6217da65bb69413c39e621b7e797e0fb189^{commit}" | grep -qx c305f6217da65bb69413c39e621b7e797e0fb189; jq -e '\''[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1'\'' product-map/generated/product-map.json'`

**硬阈值**: 三个权威源均 exit 0。

### Step 3: 生产 evidence 绑定同一目标
**来源**: `[FROM_PRD]` — Golden Path 第 3 项与 NFR 可观测要求。

**可观测行为**: 真实 task completed 时 result/evidence 同时含 repo/base/head/anchor 及 Fleet 自身非空 validation identity；其中 base 必须精确为冻结 `676fed7de12023d355deac7849af8a525ae53f8d`，证明 Worker 以该基线比较。Evaluator 以自己的 late-bound identity 另写 receipt 并引用 Fleet evidence 摘要，不要求两个角色身份相等。若真实 GitHub/Postgres 在执行中不可用，task 必须 failed/environment_failure 并点名依赖，绝不能产生业务成功。

**验证命令**: `curl -sf localhost:5221/api/brain/tasks/$FLEET_TASK_ID | jq -e '.status=="completed" and ((.result//.metadata//{})|tostring|contains("perfectuser21/zenithjoy-workspace") and contains("676fed7de12023d355deac7849af8a525ae53f8d") and contains("c305f6217da65bb69413c39e621b7e797e0fb189") and contains("line02/keyword_acquisition#step7")) and (((.result//.metadata//{}).validation_identity//(.result//.metadata//{}).provenance) as $v | ($v|type)=="object" and (($v.attempt_id//"")|length)>0 and (($v.capability_snapshot_id//"")|length)>0)'`

**硬阈值**: 7200 秒内出现真实终态；成功则 task/result/evidence 同目标且 Fleet validation identity 非空，Evaluator receipt 含自身 identity 与 Fleet evidence SHA-256；依赖失败则 `failed/environment_failure` 且错误点名 `github|postgres`。

### Step 4: 所有字段错误与依赖失败 fail-closed
**来源**: `[FROM_PRD]` — 边界情况全部四项。

**可观测行为**: 错 repo、缺失/畸形 head、可解析但非 PR head、缺失/不可解析 anchor 均不能 completed；依赖不可用不能业务 PASS。

**验证命令**: `bash -c 'for SPEC in ${FLEET_NEGATIVE_TASK_SPECS:?}; do ID=${SPEC%%:*}; FIELD=${SPEC#*:}; curl -sf localhost:5221/api/brain/tasks/$ID | jq -e --arg field "$FIELD" '\''.status=="failed" and .failure_class=="validation_input_invalid" and ((.error_message//"")|ascii_downcase|contains($field))'\''; done'`

**硬阈值**: 八种字段变异（含格式有效但不等于冻结基线的 base_sha）全部 `failed/validation_input_invalid` 且错误点名字段；真实 Fleet task 遇依赖失败必须 `failed/environment_failure` 并点名依赖，不得标业务通过。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail
: "${HARNESS_ATTEMPT_ID:?}" "${CAPABILITY_SNAPSHOT_ID:?}"
BRAIN=${BRAIN:-http://127.0.0.1:5221}
D=$(mktemp -d "${TMPDIR:-/tmp}/fleet-r36-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$D"' EXIT
submit() { curl -sfS -X POST "$BRAIN/api/brain/tasks" -H 'content-type: application/json' -d "$1" | jq -er '.id'; }
wait_terminal() { local id="$1"; local out="$2"; for i in $(seq 1 720); do curl -sfS "$BRAIN/api/brain/tasks/$id" >"$out"; jq -e '.status|IN("completed","failed","cancelled")' "$out" >/dev/null && return 0; sleep 10; done; echo "FAIL: task $id 7200s 内未终态"; return 1; }
make_payload() { jq -nc --arg repo "$1" --arg head "$2" --arg anchor "$3" '{task_type:"harness_initiative",title:"Fleet payload validation",payload:{base_repo:$repo,base_sha:"676fed7de12023d355deac7849af8a525ae53f8d",target_head_sha:$head,gp_anchor:$anchor,target_environment:"local_api"}}'; }
dependency_failure() { printf 'ENVIRONMENT_FAILURE:%s\n' "$1" >&2; exit 75; }
curl -sfS "$BRAIN/api/brain/health" | jq -e '.status=="ok" or .status=="degraded"' >/dev/null || dependency_failure brain
GH_PR=$(gh api repos/perfectuser21/zenithjoy-workspace/pulls/1581 2>"$D/github.err") || dependency_failure github
printf '%s' "$GH_PR" | jq -e '.head.repo.full_name=="perfectuser21/zenithjoy-workspace" and .head.sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .base.sha=="676fed7de12023d355deac7849af8a525ae53f8d"'
: "${DB_URL:?Fleet must inject attempt-scoped DB_URL}"
DATABASE_URL="$DB_URL" npm --prefix apps/api run migrate >"$D/migrate.log" 2>"$D/postgres.err" || dependency_failure postgres
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('zenithjoy.schema_migrations') IS NOT NULL" 2>>"$D/postgres.err" | grep -qx t || dependency_failure postgres
git rev-parse --verify 'c305f6217da65bb69413c39e621b7e797e0fb189^{commit}' | grep -qx c305f6217da65bb69413c39e621b7e797e0fb189
jq -e '[.golden_paths[]|select(.line_id=="line02" and .id=="keyword_acquisition")|.steps[]|select(.id=="step7")]|length==1' product-map/generated/product-map.json
GOOD=$(make_payload perfectuser21/zenithjoy-workspace c305f6217da65bb69413c39e621b7e797e0fb189 line02/keyword_acquisition#step7)
ID=$(submit "$GOOD"); wait_terminal "$ID" "$D/good.json"
if jq -e '.status=="completed"' "$D/good.json" >/dev/null; then
  jq -e '.payload.base_repo=="perfectuser21/zenithjoy-workspace" and .payload.base_sha=="676fed7de12023d355deac7849af8a525ae53f8d" and .payload.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .payload.gp_anchor=="line02/keyword_acquisition#step7" and ((.execution_surface//.executor//"")|ascii_downcase|contains("fleet")) and ((.result//.metadata//{})|tostring|contains("perfectuser21/zenithjoy-workspace") and contains("676fed7de12023d355deac7849af8a525ae53f8d") and contains("c305f6217da65bb69413c39e621b7e797e0fb189") and contains("line02/keyword_acquisition#step7")) and (((.result//.metadata//{}).validation_identity//(.result//.metadata//{}).provenance) as $v | ($v|type)=="object" and (($v.attempt_id//"")|length)>0 and (($v.capability_snapshot_id//"")|length)>0)' "$D/good.json"
else
  jq -e '.status=="failed" and .failure_class=="environment_failure" and ((.error_message//"")|ascii_downcase|test("github|postgres"))' "$D/good.json"
  echo 'ENVIRONMENT_FAILURE:真实 Fleet task 未产生业务通过' >&2
  exit 75
fi
FLEET_EVIDENCE_SHA=$(sha256sum "$D/good.json" | awk '{print $1}')
jq -n --arg attempt "$HARNESS_ATTEMPT_ID" --arg provider "${HARNESS_PROVIDER:?}" --arg account "${HARNESS_ACCOUNT:?}" --arg machine "${HARNESS_MACHINE:?}" --arg model "${HARNESS_MODEL:?}" --arg runner "${HARNESS_RUNNER_DIGEST:?}" --arg capability "$CAPABILITY_SNAPSHOT_ID" --arg fleet_task_id "$ID" --arg fleet_evidence_sha256 "$FLEET_EVIDENCE_SHA" '{role:"evaluator",validation_identity:{attempt_id:$attempt,provider:$provider,account:$account,machine:$machine,model:$model,runner_digest:$runner,capability_snapshot_id:$capability},fleet_receipt:{task_id:$fleet_task_id,evidence_sha256:$fleet_evidence_sha256}}' >"$D/evaluator-receipt.json"
jq -e --arg id "$ID" --arg sha "$FLEET_EVIDENCE_SHA" '.role=="evaluator" and (.validation_identity.attempt_id|length)>0 and (.validation_identity.capability_snapshot_id|length)>0 and .fleet_receipt.task_id==$id and .fleet_receipt.evidence_sha256==$sha' "$D/evaluator-receipt.json"
negative() { local name="$1" field="$2" json="$3"; local id; id=$(submit "$json"); wait_terminal "$id" "$D/$name.json"; jq -e --arg field "$field" '.status=="failed" and .failure_class=="validation_input_invalid" and ((.error_message//"")|ascii_downcase|contains($field))' "$D/$name.json"; }
negative wrong_repo base_repo "$(make_payload wrong/repo c305f6217da65bb69413c39e621b7e797e0fb189 line02/keyword_acquisition#step7)"
negative malformed_head target_head_sha "$(make_payload perfectuser21/zenithjoy-workspace HEAD line02/keyword_acquisition#step7)"
negative wrong_base_sha base_sha "$(make_payload perfectuser21/zenithjoy-workspace c305f6217da65bb69413c39e621b7e797e0fb189 line02/keyword_acquisition#step7 | jq '.payload.base_sha="c305f6217da65bb69413c39e621b7e797e0fb189"')"
git rev-parse --verify '676fed7de12023d355deac7849af8a525ae53f8d^{commit}' | grep -qx 676fed7de12023d355deac7849af8a525ae53f8d
negative parseable_non_pr_head target_head_sha "$(make_payload perfectuser21/zenithjoy-workspace 676fed7de12023d355deac7849af8a525ae53f8d line02/keyword_acquisition#step7)"
for field in base_repo target_head_sha gp_anchor; do negative missing_$field "$field" "$(echo "$GOOD" | jq "del(.payload.$field)")"; done
negative bad_anchor gp_anchor "$(make_payload perfectuser21/zenithjoy-workspace c305f6217da65bb69413c39e621b7e797e0fb189 line02/keyword_acquisition#step999)"
sha256sum "$D/good.json"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: payload 非对象、SHA 39/41 位、repo 大小写变体。
- 重复提交: 相同正确 payload 双跑，evidence 不得串 attempt。
- 中途中断: GitHub/Postgres 真实不可用时不得 completed。
- 边界值: anchor 多 `#`、不存在 line/GP/step。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet 真链路 | `sprints/08051500-kernel-pr1581-fleet-validation-r36/tests/fleet-worker-production-chain.test.ts` | 正确 payload 经真实 Fleet Worker 绑定目标；错误仓库 fail-closed；缺失 base_repo fail-closed；错误冻结 base_sha fail-closed；缺失 target_head_sha fail-closed；畸形 SHA fail-closed；可解析但非 PR head SHA fail-closed；缺失或不可解析锚点 fail-closed；正确 payload 的依赖终态不误报业务成功 | `tests/red-evidence.log` 记录冻结基线真实 exit code=1 与 Vitest FAIL 日志（至少 1 failed；其余跳过） |
