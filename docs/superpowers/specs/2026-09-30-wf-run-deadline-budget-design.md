# 设计：执行器整批总时限 + 每活动超时读契约预算（Brain 任务 7d150e33）

> PRD 正本：`sprints/09301230-commander-contract-orchestration/prep-prd.md` 阶段 1 行 `7d150e33`。决策 3c98fb36 / d02e47c0。
> 事故：09-30 02:00–08:15 三部手机死循环 6 小时无人能停；#2030 只封顶了重扫次数，执行器仍无总时限、无活动预算。

## 目标

1. 整批总时限：默认 4 小时（`WF_RUN_MAX_SECONDS=14400`，env 可覆盖），到点**平滑收工**——不开新词/新视频，已采线索照常落池+分拣，回桌面，放锁，账本 `final=partial` 记原因 `deadline`，escort 照常注销。不 kill。
2. 每活动超时：契约每活动 `budget.max_duration_s` 由 `wf-plan` 编进 `.plan`，执行器在对应活动段用它做上限；超时按契约 `failure` 分类处理（retryable 重试一次，其余记账后进入下一单元），整批不崩。

## 组件

### 1. `wf-limits.sh`（新，zsh 共享库，随 deploy.sh `DEVICE_SH_FILES` 下发）

被 wf-run.sh（库块）/ batch2.sh / harvest-keyword.sh 以 `${0:A:h}/wf-limits.sh` source；文件缺失 → 函数缺失守卫下退化为"永不到点/不限时"（与并入前行为一致，手跑单脚本不受影响）。

| 函数 | 作用 |
|---|---|
| `wf_deadline_reached` | `WF_RUN_START_TS`（wf-run 起跑 export 的 epoch 秒）+ `WF_RUN_MAX_SECONDS`（默认 14400）→ 到点 rc=0；缺 START_TS 或非数字 → rc=1（永不到点）。`WF_NOW_TS` 可注入当前时刻（测试） |
| `wf_budget_of KEY` | 打印 `WF_BUDGET_<KEY>`（秒），未设 → 0（= 不限） |
| `wf_timeout_class KEY` | 打印 `WF_TIMEOUT_CLASS_<KEY>`（`retryable`/`record`），未设 → `record` |
| `wf_run_bounded SECS cmd...` | 子进程跑 cmd，超 SECS 秒 → TERM→KILL，rc=124；SECS≤0 直接透传。轮询步长 `WF_BOUNDED_POLL`（默认 1s，测试 0.1）。只用于**非手机动作**的远程调用（ssh/scp/发现脚本），手机侧动作一律在边界判、不 kill |

### 2. `wf-plan.mjs`：计划新增预算与超时分类

每个活动（含 ref 过来的）输出：
- `WF_BUDGET_<key>=<budget.max_duration_s>`（缺 budget → 0）
- `WF_TIMEOUT_CLASS_<key>=retryable|record`：活动 `failure.retryable` 里任一条含 `超时`/`timeout`/`scp/ssh 失败`（delivery 的既有条目）→ `retryable`，否则 `record`。

`wf_load_plan` source 后 `export` 所有 `WF_BUDGET_*`/`WF_TIMEOUT_CLASS_*`（batch2/harvest-keyword 子进程要看得到）。`plans/*.plan` 重生成提交，`--check` 过；`wf-plan.test.js` 期望值同步。

### 3. `wf-run.sh`

- 起跑（`WF_RUN_STARTED` 之后）：`WF_RUN_START_TS=$(date +%s)`、`WF_RUN_MAX_SECONDS=${WF_RUN_MAX_SECONDS:-14400}`，export；日志记一行 `总时限=<N>s`。
- 预检段：`preflight_lock_acquire` 的重试循环受 `WF_BUDGET_preflight` 封顶（段起始时刻起累计，超预算不再等）——lock_busy 在契约里是 retryable，本来就在轮询，预算只给它上限。
- 取源段：`kpi-gate` / `next-keywords` 两条 ssh 经 `wf_run_bounded $(wf_budget_of discovery)`（词单是发现活动的输入，借发现预算）；超时 rc=124 → 走既有兜底（KPI fail-open / 词单缓存续跑），不新增分支。
- batch2 之后：stdout 含 `BATCH2_STOP_REASON=deadline` → `WFR_FINAL_REASON=deadline` export，日志 `总时限到,平滑收工`，`wr step 3 done "总时限到,平滑收工"`；效果回写照常（已采线索仍要计入词赛马）。
- `run_finalize`：把 `WFR_FINAL_REASON` 透传给 `workflow-result.sh finalize`。

### 4. `batch2.sh`（词边界）

- 每词开头（触达时窗判定之后、清场之前）：`wf_deadline_reached` → 日志 `整批总时限到,采收收工(词$n: $W 起未开跑)`，`DEADLINE_HIT=1`，break。循环后照常落池/分拣；末尾 stdout `BATCH2_STOP_REASON=deadline`。
- 落池段：push ssh 经 `wf_run_bounded $(wf_budget_of delivery)`；rc=124 且 `wf_timeout_class delivery`=retryable → 日志 `落池超预算,重试 1 次` 后再跑一次；仍失败 → `wfr_delivery_stage` 记 `push rc=124`（既有 failed 路径），分拣照常判断。
- 分拣段：sort ssh 经 `wf_run_bounded $(wf_budget_of scoring)`；rc=124 → 日志 `分拣超预算(记账,不重试)`，`wfr_scoring_stage 124`（既有 failed 路径）。

### 5. `harvest-keyword.sh`（视频边界）

- 拿锁重试循环：每轮先判 `wf_deadline_reached` → 到点直接 `exit 0`（不开本词）。
- 发现段：`DISCOVER_CMD` 经 `wf_run_bounded $(wf_budget_of discovery)`；rc=124 → `wf_timeout_class discovery`=retryable 时重跑一次；仍超 → 日志 `发现超预算(<N>s),本词作废` 并 `exit 4`（新出口码：活动超预算；batch2 映射为 discovery failed `budget_exceeded`，不崩批）。
- 逐视频循环开头：`wf_deadline_reached` → 日志 `整批总时限到,本词剩余候选不采`，break（trap 放锁）；采集段：自发现结束起累计 ≥ `WF_BUDGET_qualification + WF_BUDGET_collection` → 日志 `采集段超预算,本词剩余候选作废(记账)`，break。

### 6. `workflow-result.sh finalize`

`WFR_FINAL_REASON` 非空且原本判 `completed` → `WFR_FINALIZE_FINAL=partial`，msg 追加 `reason=<原因>`；Brain 回执 status 原样 `partial`。（发现：Brain `normalizeCallbackStatus` 对 `completed`/`partial` 都落 `in_progress`，属既有缺口，归阶段 1 任务 c2d73868 Brain 对账侧。）

## 出口码契约（harvest-keyword.sh）

| rc | 含义 | batch2 记账 |
|---|---|---|
| 0 | 正常 / 无卡片 / 到点提前收工 | 按产物 |
| 1 | open-search/发现失败 | discovery failed |
| 3 | 锁被占 | discovery blocked lock_busy |
| **4** | **活动超预算（发现段）** | **discovery failed budget_exceeded** |

## 测试（先失败后实现，commit-1 → commit-2）

| 文件 | 钉什么 |
|---|---|
| `wf-limits.test.mjs` | 默认 14400 / env 覆盖 / 缺 START_TS 永不到点 / `wf_run_bounded` 超时 124 与正常透传 / `wf_timeout_class` 默认 record |
| `batch2-run-deadline.test.mjs` | 采完词 1 到点 → 词 2 不开、落池+分拣照跑、stdout `BATCH2_STOP_REASON=deadline`；未到点不影响 |
| `harvest-keyword-run-deadline.test.mjs` | 视频 1 后到点 → 只点 1 张、锁释放、日志到点 |
| `harvest-keyword-activity-budget.test.mjs` | 发现超预算 → rc=4 + 锁释放；retryable 时发现被调 2 次；采集段超预算 → 剩余候选作废、rc=0 |
| `batch2-activity-budget.test.mjs` | 落池超预算 retryable 重试 1 次；分拣超预算记账不重试、批不崩、出口 0 |
| `wf-plan.test.js` | 计划含 `WF_BUDGET_*`/`WF_TIMEOUT_CLASS_*`；delivery=retryable，其余 record |
| `wf-run.test.mjs` | `wf_load_plan` 后子进程看到 `WF_BUDGET_preflight=300` |
| `workflow-result.test.mjs` | `WFR_FINAL_REASON=deadline` → `WFR_FINALIZE_FINAL=partial` |
| `wf-run-deadline-e2e.test.mjs`（验收） | 全假控制器整链（adb/ssh/douyin-phone-adb/date 全假、账本真跑）：`WF_RUN_MAX_SECONDS` 小值 → 60 秒内自收工、`lock-status` free、TSV 的 LEAD 行被 scp+push、日志 `final=partial`、escort `cron rm` |

## 不包含

- Brain 侧总时限到期判 lost（c2d73868）、Commander 心跳接班（17ea4536）。
- 清场/收尾进锁（40f02c5e，下一 PR）。
- 契约 YAML 不改（预算值取现值）。

GP-Anchor: none(infra)
