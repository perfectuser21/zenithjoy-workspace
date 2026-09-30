# escort 在途保护 Implementation Plan

> **For agentic workers:** 本计划由当前 session inline 执行（团队纪律禁派子代理）。步骤用 `- [ ]` 跟踪。

**Goal:** run 在途时 escort 陪跑 cron 不会被（包括它自己在内的）任何人悄悄注销：wf-run 只删自己登记且 name 匹配的 escort，在途被删立即重拉；SOP 把自杀条款收紧到「本 TAG 批完成 / 进程已退」。

**Architecture:** 全部改动落在 `services/phone-adb-controller/`：wf-run.sh 增加 `escort_add / escort_current_id / escort_owned / escort_dismiss(改) / escort_watch_start / escort_watch_tick / escort_watch_stop`；COMMANDER.md 真身 + cmdr-escort.txt 投影同步改自杀条款；smoke 脚本层 6 追加断言。测试沿用 `harvest-cron-escort-alive.test.mjs` 的假 ssh 回放法。

**Tech Stack:** zsh 脚本 + node:test（`node --test services/phone-adb-controller/__tests__/*.test.mjs`）

## Global Constraints

- 复核/注销只按 ESCORT_ID，永不按截断的 Name 列 grep（决策 711ca6cf；smoke 层 6 已守）。
- 提交顺序：commit-1 failing test → commit-2 实现。
- 不碰 crontab、不碰真机、不删任何真实 cron。

---

### Task 1: failing test（假 ssh 回放 cron list/add/rm）

**Files:**
- Create: `services/phone-adb-controller/__tests__/wf-run-escort-guard.test.mjs`

**Interfaces（Task 2 必须实现的函数，zsh，`WF_RUN_LIB=1 source wf-run.sh` 后可调）:**
- `escort_owned <id> <want_name>` → stdout 之一 `match` / `absent` / `mismatch:<name>` / `unknown`
- `escort_current_id` → stdout 当前 escort id（优先 `$ESCORT_ID_FILE`，否则 `$ESCORT_ID`）
- `escort_dismiss` → 仅 `match` 时 `ssh mmv "openclaw cron rm <id>"`，其余记日志不删；结束删 `$ESCORT_ID_FILE`
- `escort_add` → `ssh mmv "openclaw cron add ..."`，stdout 新 id
- `escort_watch_tick` → 当前 id `absent` 时重拉、新 id 写 `$ESCORT_ID_FILE`、日志「已重拉」
- `escort_watch_start` / `escort_watch_stop` → 后台循环（`ESCORT_WATCH_INTERVAL` 秒）

- [ ] **Step 1: 写测试**（假 ssh：按 `$STUB_JOBS` 文件回放 `cron list --json`；`cron add` 回固定新 id；`cron rm` 记 argv）
- [ ] **Step 2: 跑 `node --test services/phone-adb-controller/__tests__/wf-run-escort-guard.test.mjs`**，期望 FAIL（函数不存在 / SOP 缺条款）
- [ ] **Step 3: commit** `test(phone-adb): escort 在途保护 failing test（注销核 name/看门狗重拉/SOP 条款）`

### Task 2: wf-run.sh 实现

**Files:**
- Modify: `services/phone-adb-controller/wf-run.sh:248-276`（escort 段）与 `:308`（trap）

- [ ] **Step 1:** 在 `ESCORT_ID=""` 后加 `ESCORT_ID_FILE="$HOME/wf-escort-$TAG.id"`、`ESCORT_WATCH_PID=""`、`ESCORT_START_HM=$(date +%H:%M)`；把 `escort_launch` 里的单次 `cron add` 抽成 `escort_add`（消息里的起跑时间用 `$ESCORT_START_HM`）
- [ ] **Step 2:** 加 `escort_current_id` / `escort_owned` / 新 `escort_dismiss` / `escort_watch_*`
- [ ] **Step 3:** escort 确认后 `escort_watch_start`；trap 改为 `lease_heartbeat_stop; escort_watch_stop; escort_dismiss; release_run_lock; run_finalize`
- [ ] **Step 4:** 跑新测试 + 全量 `node --test services/phone-adb-controller/__tests__/*.test.mjs`，期望全绿
- [ ] **Step 5: commit** `fix(phone-adb): wf-run escort 只删本 run 登记且 name 匹配的 cron，在途被移除立即重拉`

### Task 3: SOP 真身 + 投影 + smoke

**Files:**
- Modify: `services/phone-adb-controller/COMMANDER.md`（第二节后新增「六、escort 注销权」或并入陪跑行）
- Modify: `services/phone-adb-controller/cmdr-escort.txt`（第 4 条自杀条款）
- Modify: `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh:105-114`

- [ ] **Step 1:** 改条款：只允许 a) 日志出现本 TAG 的 `[<TAG>] 批完成` b) 起跑超 4 小时且 `node_exec pgrep -f "wf-run.sh.*--tag <TAG>"` 为空；日志读不到/停滞/已升级 ≠ 收工，禁止 cron rm；注销前 `cron list --json` 按 name 全等取 id
- [ ] **Step 2:** smoke 追加：`grep -qF 'escort_watch_start' wf-run.sh`、`grep -qF 'escort注销拒绝' wf-run.sh`、`grep -qF '本 TAG' cmdr-escort.txt`
- [ ] **Step 3:** 测试全绿后 commit `docs(commander): escort 自杀条款收紧为本 TAG 批完成/进程已退，注销权归 wf-run 收尾`
