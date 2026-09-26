# 设计：账本 stage/finalize 回执 Brain execution-callback（验证层接力链棒1 · workspace 侧）

task `15346e6c` · 决策 `702949b6` / `280bd091` / `a32ec2c2`（路径 B）· GP-Anchor `line02/keyword_acquisition keep-green`
前置设计：`2026-09-21-crontab-leadgen-ledger-artifacts-design.md`（工件写手 `workflow-result.sh`）

## 目标

`wfr stage|finalize` 目前只落本地工件，与 Brain 零接触。本设计让每个通过 jq 校验的 stage 工件 best-effort 回执到 `POST $BRAIN_URL/api/brain/execution-callback`，终态由 `finalize` 发出，Brain 侧 `task_runs.result` 保留 `{stage, stage_status, metrics, evidence, probes}`（Brain 侧 PR 由姊妹代理做）。永远 `exit 0`，绝不阻塞采收。

## brain_task_id 取法（已核实，二选一里选前者）

- 事实：`POST /api/workers/:agent/tasks` 的 `startTask`（`apps/api/src/services/worker-tasks-service.ts:98`）返回 `{task_id, lease_until}`，**不含** brain_task_id，但函数体内已握有 `brainId`（关联分支 = `input.brainJobId`，新建分支 = `createMirrorJob` 返回值）。
- 事实：仓内**没有**按 serial 读 `worker_tasks.evidence` 的 API（`workers-executor.ts` 只有 POST 路由），退路"经现有 API 查 evidence"不存在。
- 选择：`startTask` 返回体加 `brain_task_id`（string | null），路由 `OK(r)` 原样透传（向后兼容，老 wall-report 忽略未知键）。`wall-report.sh do_start` 解析 `data.brain_task_id`，非空时向 stdout 打一行 `WFR_BRAIN_TASK_ID=<id>`。`harvest-cron-v4.sh` 用 `wr_start` 捕获 stdout 并 `export WFR_BRAIN_TASK_ID`（`wr()` 其余调用仍丢 stdout）。

## 组件改动

### 1 `apps/api`（服务端，一行语义）
`startTask` 返回 `{ task_id, lease_until, brain_task_id }`；桥接失败时为 `null`。

### 2 `wall-report.sh do_start`
201 时除 `data.task_id` 外再取 `data.brain_task_id`；非空 → `printf 'WFR_BRAIN_TASK_ID=%s\n'`。其余行为不变。

### 3 `harvest-cron-v4.sh`
新增 `wr_start(){ [[ -x "$WR" ]] && "$WR" start "$@" 2>/dev/null; true }`；`WFR_BRAIN_TASK_ID=$(wr_start … | sed -n 's/^WFR_BRAIN_TASK_ID=//p' | head -1)`，`export`，日志一行。子进程 `bash "$WFR"` 因 export 可见。

### 4 `workflow-result.sh`
- 凭据：`WFR_BRAIN_ENV="${WFR_BRAIN_ENV:-$HOME/.credentials/brain.env}"`，照 `wall_load_env` 写法 `[ -r f ] && . f`；文件提供 `BRAIN_URL` / `BRAIN_INTERNAL_TOKEN`（已在环境里的值优先，便于测试注入）。
- `brain_post <run_id> <status> <result_json>`：缺 `BRAIN_URL` / `BRAIN_INTERNAL_TOKEN` / `WFR_BRAIN_TASK_ID` 任一 → `warn "brain callback skipped: missing …"` 返回；否则 `curl -s --connect-timeout 3 -m 8 -w '\n%{http_code}' -X POST "$BRAIN_URL/api/brain/execution-callback" -H "Authorization: Bearer $BRAIN_INTERNAL_TOKEN" -H 'Content-Type: application/json' -d <body>`；curl 非 0 → `warn` 带 raw 输出；HTTP 非 2xx → `warn` 带 code+body。
- body：`{task_id, run_id, status, result:{stage:.stage_id, stage_status:.status, metrics, evidence, probes:[]}}`，result 由 jq 直接从校验通过的工件文件派生。
- `write_stage`：工件校验通过并记账后，stage≠cleanup → `brain_post "${WFR_RUN_ID}__${attempt}.${stage}" in_progress`。
- `finalize`：cleanup 工件写成 → `status=completed`，否则 `failed`；`run_id="${WFR_RUN_ID}__${attempt}.cleanup"`；result 的 evidence 追加一条 `{type:"finalize", ok, msg}`（工件没写成时 stage/metrics 取 cleanup 默认值）。
- 幂等依赖 Brain 侧 `run_id+status` 去重；stage 用 in_progress、finalize 用终态，同 run_id 不同 status 不冲突。

### 5 README「部署三步」补一行：`~/.credentials/brain.env`（`BRAIN_URL` / `BRAIN_INTERNAL_TOKEN`，chmod 600，来源 1Password CS）。

### 6 smoke 守卫扩展
`phone-adb-controller-smoke.sh` 加一层：`workflow-result.sh` 含 `execution-callback` 与 `brain_post`；`wall-report.sh` 含 `WFR_BRAIN_TASK_ID`；`harvest-cron-v4.sh` 含 `export WFR_BRAIN_TASK_ID`；`worker-tasks-service.ts` 含 `brain_task_id:`。

## 错误路径
| 情况 | 行为 |
|---|---|
| 无 brain.env / 无 token / 无 task id | 跳过 + `WFR_WARN … skipped`，工件照写 |
| curl 连不上/超时 | `WFR_WARN brain callback curl failed: <raw>`，exit 0 |
| Brain 返回 4xx/5xx | `WFR_WARN brain callback HTTP <code>: <body>`，exit 0 |
| 任务已终态（Brain 200 跳过） | 视为成功，无日志 |
| 服务端桥接失败 brain_task_id=null | do_start 不打行，后续全程 skipped |

## 测试策略（integration，node:test，不装依赖）
- `workflow-result.test.mjs`：PATH 前置假 `curl`（记录 argv 到文件、回 `\n200`；可切换 exit 7）。断言 stage 的 url/Authorization/body（task_id、run_id、status、result 五键）；finalize 终态 completed + run_id `.cleanup`；缺 env 零调用且 stderr `skipped`；curl 失败 stderr 含 raw 错误且 exit 0；`WFR_BRAIN_ENV` 文件可加载。
- `wall-report.test.mjs`：假中台 tasks 响应带 `brain_task_id` → stdout 有 `WFR_BRAIN_TASK_ID=`；不带 → 无。
- `worker-tasks-service.test.ts` / `workers-executor.test.ts`（vitest）：返回体含 `brain_task_id`（新建分支 = createMirrorJob 返回值、关联分支 = brainJobId、桥接失败 = null）；路由透传。
- smoke：见 §6，proven-to-fire 在本地把签名改掉跑一次确认报红。

## 不包含
Brain 侧路由鉴权与 task_runs 落库（姊妹 PR）；`harvest-cron.sh`（v3）与 `device-job-claimer.sh` 不接 wfr，不改；`outreach-tick.sh` 不改。
