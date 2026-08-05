# Sprint Contract Draft（Round 2）

## GP-Anchor

GP-Anchor: line02/keyword_acquisition#step7

## Response Schema（推导来源: PRD 字面 + Brain 真实 Harness Initiative）

验收器 stdout 必须是单个 JSON 对象：

```json
{"ok":true,"base_repo":"perfectuser21/zenithjoy-workspace","target_head_sha":"c305f6217da65bb69413c39e621b7e797e0fb189","gp_anchor":"line02/keyword_acquisition#step7","base_sha":"676fed7de12023d355deac7849af8a525ae53f8d","failure_class":null,"receipt":{"task_id":"<runtime task id>","source":"fleet-worker"}}
```

- 成功 keys 必须精确为 `base_repo,base_sha,failure_class,gp_anchor,ok,receipt,target_head_sha`。
- `failure_class`：成功为 `null`；输入缺失/错值/格式非法为 `payload_invalid`；GitHub、Postgres、Brain 或 Git 不可用为 `environment_failure`。
- `receipt.task_id` 来自当前执行角色的真实 Harness Initiative；禁止使用任务标题、当前分支或工作区 HEAD 推导权威字段。

## 已知约束

- [Brain 真实派发记录] `GET /api/brain/tasks/:id` 的 `payload` 已含 `base_repo`、`target_head_sha`、`gp_anchor`；E2E 以此真实记录为 Fleet Worker 消费入口/receipt，不再新建独立校验器假装 worker。Fleet 注入的 `DB_URL` 是 attempt 级空库，只做真实 PostgreSQL 可用性检查，不假设含 Brain 生产数据。
- [product-map] `line02/keyword_acquisition#step7` 唯一存在；对应 smoke 为 `.github/workflows/scripts/smoke/golden-path-2-smoke.sh`，本 sprint 不改业务 smoke。
- [累积 FR] 本 line 暂无历史。
- API registry 有 `GET /:id` task 端点；测试 registry 未发现同类 Fleet receipt 测试，测试采用 Vitest `[NEW_PATTERN]`。

## 八要素需求规范

| 要素 | 本次答案 |
|---|---|
| FR | 从真实 Fleet Worker 对应 Harness Initiative receipt 读取三字段，核对冻结 base、PR head 和 GP，输出绑定结论。 |
| NFR | 7200 秒内；失败非零；不打印 token/cookie。 |
| Invariant | 不从标题、分支、工作区 HEAD 猜值；冻结 base 不与可漂移的 GitHub baseRefOid 绑定。 |
| 判定点 | 见下表。 |
| 保质期 | 仅对 PR #1581 的指定 head 与本次冻结 base 有效；PR head 漂移即失效。 |
| 死亡告警 | 非零退出及 `failure_class` 进入 evaluator evidence；无静默降级。 |
| 失败语义 | payload 错误与环境错误均拦截 `ok:true`；同输入可幂等重跑。 |
| 效果确认 | Brain task receipt、Postgres 可用性、GitHub head、Git 祖先关系和 product-map 五方交叉核验。 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ Fleet Worker 是否消费了指定 payload | 新建校验器输入；Brain 真实 task receipt | Brain API 返回当前 Runner task_id 的真实 payload | 可证明派发/消费对象，不以测试替身自证 | 验错任务却误报通过 |
| ⚠️ PR head 是否相同 | 工作区 HEAD；GitHub headRefOid | GitHub PR #1581 headRefOid 精确比较 | PRD 禁止回退工作区 HEAD | 验错提交 |
| GP anchor 是否唯一 | 模糊名称；SSOT 精确解析 | product-map 精确 line/GP/step | 产品分类 SSOT | 验错 Step |

notes: judgment-pending-user: Fleet Worker receipt 与 PR head 两个高风险判定点沿用 PrepPRD assumption，并由机器五方核验。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|---|---|---|---|
| 三字段缺失、错值、SHA 非 40 位小写十六进制、锚点非唯一 | exit 非零，JSON `ok:false,failure_class:"payload_invalid"` | 是 | 不猜测、不回退 |
| Brain/GitHub/Postgres/Git 任一不可用 | exit 非零，JSON `ok:false,failure_class:"environment_failure"`，不得含 `ok:true` | 是 | 无降级 |
| PR head 漂移 | exit 非零，`payload_invalid` | 是 | 重新冻结输入 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|---|---|---|---|
| Harness Initiative payload | 不可信结构化输入 | 仅解析固定 JSON key，不执行内容 | 必填键异常立即拒绝；未知键不成为权威来源 |

## Golden Path

覆盖父路 keyword_acquisition 第 7-7 步。

[真实 Harness Initiative receipt] → [三字段与冻结基线校验] → [GitHub/Git/GP 对账] → [可审计结论]

### Step 1：从真实 Fleet Worker receipt 读取权威 payload

**来源**: `[FROM_PRD]` — Golden Path 第 1 步与范围限定。

**可观测行为**: 验收器以 `--task-id` 调 Brain 真实 task 端点读取 receipt；同时用 Fleet 注入的 attempt 级 `DB_URL` 执行 `SELECT 1`，确认本次声明的 Postgres 依赖真实可用，不要求空库预含 Brain 业务表。

**验证命令**:
```bash
node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL" | jq -e '.receipt.task_id==$ENV.HARNESS_TASK_ID and .receipt.source=="fleet-worker"'
```

**硬阈值**: API receipt task_id 与 Runner 相同、三字段均存在且精确；Postgres `SELECT 1` 成功；30 秒内，否则非零。

### Step 2：以冻结 base 校验 target commit

**来源**: `[FROM_PRD]` — Golden Path 第 2 步与 NFR 版本要求。

**可观测行为**: 固定输出 PRD `base_sha`；用 `rev-parse --verify <ref>^{commit}` 和 `merge-base --is-ancestor` 验证关系。GitHub 只核对 `headRefOid`，不要求当前 `baseRefOid` 等于冻结基线。

**验证命令**:
```bash
git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null && git rev-parse --verify "c305f6217da65bb69413c39e621b7e797e0fb189^{commit}" >/dev/null && git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d c305f6217da65bb69413c39e621b7e797e0fb189 && gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid | jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"'
```

**硬阈值**: 两 SHA 均为 commit、base 是 target 祖先、PR head 精确相等；总耗时 ≤7200 秒。

### Step 3：输出绑定同一目标的审计结论

**来源**: `[FROM_PRD]` — Golden Path 第 3 步及全部边界情况。

**可观测行为**: 仅五方证据一致时输出 `ok:true`；任一输入边界或环境依赖失败均输出明确分类并非零退出。

**验证命令**:
```bash
OUT=$(node sprints/08051905-kernel-pr1581-fleet-validation-r39/fleet-worker-receipt-check.mjs --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL"); echo "$OUT" | jq -e 'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","receipt","target_head_sha"] and .ok==true and .failure_class==null and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"'
```

**硬阈值**: 成功 schema 精确；失败绝无 `ok:true` 且 `failure_class` 非空。

## 真实调用方请求 shape

- Fleet Worker 真实入口：Brain `tasks` 中 `task_type=harness_initiative` 的 `payload`。
- 必填字段：`base_repo:string`、`target_head_sha:string`、`gp_anchor:string`；真实 task ID 由 Runner `HARNESS_TASK_ID` 注入。
- E2E 从 Brain API 读取同一 task ID 的真实 payload；Postgres 只验证 attempt 级依赖可用性，不从空库伪造/复制业务 receipt。
- validation identity 全部 late-bound：使用 `HARNESS_ATTEMPT_ID`、`HARNESS_PROVIDER`、`HARNESS_ACCOUNT`、`HARNESS_MACHINE`、`HARNESS_MODEL`、`HARNESS_RUNNER_DIGEST`、`CAPABILITY_SNAPSHOT_ID`，不固化角色 UUID。

## 禁 mock 边清单

- Fleet Worker / Brain task receipt ↔ 验收器（测试必须真调 Brain API 读取当前 task；不得用 fixture 替代 happy path）。
- 验收器 ↔ attempt Postgres（必须真连接 Fleet 注入的 `DB_URL`，不得预置业务状态）。
- payload target ↔ GitHub PR #1581 head（必须真 `gh pr view`）。
- 冻结 base ↔ Git object graph（必须真 `rev-parse --verify` + `merge-base`）。
- gp_anchor ↔ product-map SSOT（必须真读生成 JSON）。

## 接缝清单

- Brain API receipt 与 Postgres 可用性：真目标执行两次；结果不一致为 FLAKY。[接缝×2]
- GitHub PR head：真 `gh pr view` 执行两次；不可用为 `environment_failure`。[接缝×2]

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: DB/API payload 分别出现仓库错值、SHA 39/41 位或大写、锚点 `step07`。
- 重复提交: 同一 receipt 连跑两次，结论必须一致。
- 中途中断: Brain、Postgres、GitHub 分别不可达，均须 `environment_failure`。
- 边界值: task 不存在、payload null、额外未知键、工作区 HEAD 不同。
发现分级: P0/P1 阻塞 merge；P2/P3 记录 findings。

## E2E 验收

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${HARNESS_TASK_ID:?Runner must inject current task id}"
: "${HARNESS_ATTEMPT_ID:?Runner must inject current validation attempt}"
: "${HARNESS_PROVIDER:?}"
: "${HARNESS_ACCOUNT:?}"
: "${HARNESS_MACHINE:?}"
: "${HARNESS_MODEL:?}"
: "${HARNESS_RUNNER_DIGEST:?}"
: "${CAPABILITY_SNAPSHOT_ID:?Runner must inject current capability snapshot}"
: "${BRAIN_URL:?Runner must inject Brain URL}"
: "${DB_URL:?Fleet must inject attempt-scoped Postgres URL}"
SPRINT_DIR="sprints/08051905-kernel-pr1581-fleet-validation-r39"
RUN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fleet-${HARNESS_ATTEMPT_ID}.XXXXXX")
trap 'rm -rf "$RUN_DIR"' EXIT

# 真实 Fleet Worker receipt：从 Brain 当前 task 读取，禁止临时 JSON 替代入口；attempt 空库只验连接。
curl -sf "$BRAIN_URL/api/brain/tasks/$HARNESS_TASK_ID" > "$RUN_DIR/task-api.json" || { printf '%s\n' '{"ok":false,"failure_class":"environment_failure","dependency":"brain"}' > "$RUN_DIR/failure.json"; jq -e '.ok==false and .failure_class=="environment_failure"' "$RUN_DIR/failure.json"; exit 1; }
psql "$DB_URL" -v ON_ERROR_STOP=1 -Atc 'SELECT 1' | grep -qx 1 || { printf '%s\n' '{"ok":false,"failure_class":"environment_failure","dependency":"postgres"}' > "$RUN_DIR/failure.json"; jq -e '.ok==false and .failure_class=="environment_failure"' "$RUN_DIR/failure.json"; exit 1; }
jq -e '.task_type=="harness_initiative" and .payload.base_repo=="perfectuser21/zenithjoy-workspace" and .payload.target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .payload.gp_anchor=="line02/keyword_acquisition#step7"' "$RUN_DIR/task-api.json"

git rev-parse --verify "676fed7de12023d355deac7849af8a525ae53f8d^{commit}" >/dev/null || { echo '{"ok":false,"failure_class":"environment_failure","dependency":"git-base"}'; exit 1; }
git rev-parse --verify "c305f6217da65bb69413c39e621b7e797e0fb189^{commit}" >/dev/null || { echo '{"ok":false,"failure_class":"environment_failure","dependency":"git-target"}'; exit 1; }
git merge-base --is-ancestor 676fed7de12023d355deac7849af8a525ae53f8d c305f6217da65bb69413c39e621b7e797e0fb189
gh pr view 1581 --repo perfectuser21/zenithjoy-workspace --json headRefOid > "$RUN_DIR/pr.json" || { echo '{"ok":false,"failure_class":"environment_failure","dependency":"github"}'; exit 1; }
jq -e '.headRefOid=="c305f6217da65bb69413c39e621b7e797e0fb189"' "$RUN_DIR/pr.json"
jq -e '[.golden_paths[] | select(.line_id=="line02" and .id=="keyword_acquisition") | .steps[] | select(.id=="step7")] | length==1' product-map/generated/product-map.json

OUT=$(node "$SPRINT_DIR/fleet-worker-receipt-check.mjs" --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL")
echo "$OUT" | jq -e 'keys==["base_repo","base_sha","failure_class","gp_anchor","ok","receipt","target_head_sha"] and .ok==true and .failure_class==null and .receipt.source=="fleet-worker" and .base_repo=="perfectuser21/zenithjoy-workspace" and .target_head_sha=="c305f6217da65bb69413c39e621b7e797e0fb189" and .gp_anchor=="line02/keyword_acquisition#step7" and .base_sha=="676fed7de12023d355deac7849af8a525ae53f8d"'

# 参数化输入边界：fixture 只用于拒绝路径；happy path 始终来自真实 receipt。
node "$SPRINT_DIR/tests/run-negative-matrix.mjs" | jq -e '.cases==8 and .passed==8 and .unexpected_success==0'

# 环境失败 oracle：连接真实不可达地址，不用 force/mock；必须非零、environment_failure、绝无 ok:true。
if node "$SPRINT_DIR/fleet-worker-receipt-check.mjs" --task-id "$HARNESS_TASK_ID" --brain-url "http://127.0.0.1:1" --db-url "$DB_URL" > "$RUN_DIR/env-brain.json" 2>&1; then echo 'FAIL: brain unavailable accepted'; exit 1; fi
if node "$SPRINT_DIR/fleet-worker-receipt-check.mjs" --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "postgresql://invalid:invalid@127.0.0.1:1/invalid?connect_timeout=1" > "$RUN_DIR/env-postgres.json" 2>&1; then echo 'FAIL: postgres unavailable accepted'; exit 1; fi
if GH_HOST=127.0.0.1 node "$SPRINT_DIR/fleet-worker-receipt-check.mjs" --task-id "$HARNESS_TASK_ID" --brain-url "$BRAIN_URL" --db-url "$DB_URL" > "$RUN_DIR/env-github.json" 2>&1; then echo 'FAIL: github unavailable accepted'; exit 1; fi
for DEP in brain postgres github; do jq -e '.ok==false and .failure_class=="environment_failure" and (.dependency=="'"$DEP"'")' "$RUN_DIR/env-$DEP.json"; if jq -e '.ok==true' "$RUN_DIR/env-$DEP.json" >/dev/null; then echo "FAIL: $DEP failure emitted ok:true"; exit 1; fi; done
echo 'OK: 真实 Fleet Worker receipt、冻结 base、PR head 与 GP Step 7 已绑定'
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| Fleet receipt 全链路 | `sprints/08051905-kernel-pr1581-fleet-validation-r39/tests/fleet-worker-receipt.test.ts` | 真实 Fleet receipt 输出完整绑定结论；base_repo 缺失拒绝；base_repo 错值拒绝；target_head_sha 缺失拒绝；target_head_sha 非完整 SHA 拒绝；target_head_sha 错 head 拒绝；gp_anchor 缺失拒绝；gp_anchor 错值拒绝；gp_anchor 不唯一解析拒绝；依赖不可用归 environment_failure | `fleet-worker-receipt-check.mjs` 与 negative matrix 尚不存在，Vitest import 失败 |

## Notes

- contract-gate: skipped (file not found, third-party repo)
- 不修改 PR #1581 业务实现、共享 CI、smoke allowlist 或 Harness 调度策略。
