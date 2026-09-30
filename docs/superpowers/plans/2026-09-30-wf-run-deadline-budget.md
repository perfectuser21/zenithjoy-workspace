# 执行器整批总时限 + 每活动超时读契约预算 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task（本任务禁派子代理，内联执行）. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** wf-run/batch2/harvest-keyword 有整批总时限（默认 4h）到点平滑收工写 `final=partial`，各活动段按契约 `budget.max_duration_s` 封顶并按 failure 分类处理，整批不崩。

**Architecture:** 新共享库 `wf-limits.sh` 提供到点判定 / 预算读取 / 有界子进程；`wf-plan.mjs` 把契约预算与超时分类编进 `.plan`，`wf_load_plan` export 给子进程；三条脚本在**边界**（词/视频）判到点，只对远程调用（ssh/发现脚本）用有界子进程；`workflow-result.sh finalize` 读 `WFR_FINAL_REASON` 出 `partial`。

**Tech Stack:** zsh 脚本、node:test（`node --test services/phone-adb-controller/__tests__/*.test.mjs`）、假控制器/假 ssh/假 date 测试写法（照 `harvest-keyword-rescan-loop.test.mjs` / `batch2-touch-window.test.mjs`）。

## Global Constraints

- 每个 task：commit-1 失败测试 → commit-2 实现（TDD 铁律）。
- 不 kill 手机侧动作；总时限只在词/视频边界判。
- `harvest-keyword.sh` 出口码 0/1/3 语义不变，新增 4=活动超预算。
- 新 .sh 必须进 `deploy.sh DEVICE_SH_FILES`（smoke 守卫会红）。
- 计划文件 `plans/*.plan` 重生成，`node scripts/product-map/wf-plan.mjs --check` 必须 PASS。
- 全部输出简体中文注释。

---

### Task 1: `wf-limits.sh` 共享库

**Files:**
- Create: `services/phone-adb-controller/wf-limits.sh`
- Modify: `services/phone-adb-controller/deploy.sh:82-87`（DEVICE_SH_FILES 加 `wf-limits.sh`）
- Test: `services/phone-adb-controller/__tests__/wf-limits.test.mjs`

**Interfaces（Produces）:**
- `wf_deadline_reached` → rc 0 到点 / 1 未到点或未设 `WF_RUN_START_TS`
- `wf_budget_of KEY` → stdout 秒数（未设 0）
- `wf_timeout_class KEY` → stdout `retryable|record`（未设 record）
- `wf_run_bounded SECS cmd...` → 透传 rc；超时 124（TERM 后 0.5s KILL）

- [ ] **Step 1: 写失败测试** `wf-limits.test.mjs`：用 `zsh -c 'source wf-limits.sh; ...'` 断言：默认 max=14400（START_TS=now-14399 未到，now-14400 到点，用 `WF_NOW_TS` 注入）；`WF_RUN_MAX_SECONDS=60` 覆盖；缺 START_TS rc=1；`wf_run_bounded 1 sleep 5` rc=124 且 ≤3s 返回；`wf_run_bounded 5 sh -c 'echo hi; exit 7'` stdout hi rc=7；`wf_run_bounded 0 sh -c 'exit 3'` rc=3；`wf_budget_of x` 未设=0、`WF_BUDGET_x=5`=5；`wf_timeout_class x` 默认 record。
- [ ] **Step 2: 跑测试确认失败**（文件不存在 → source 失败）。
- [ ] **Step 3: 实现**

```zsh
#!/bin/zsh
# wf-limits.sh — 执行器限时共享库(任务 7d150e33,决策 3c98fb36 阶段1)。被 wf-run.sh(库块)/batch2.sh/harvest-keyword.sh source。
wf_deadline_reached(){
  local now start="${WF_RUN_START_TS:-}" max="${WF_RUN_MAX_SECONDS:-14400}"
  [[ "$start" == <-> && "$max" == <-> ]] || return 1
  now="${WF_NOW_TS:-$(date +%s)}"
  (( now - start >= max ))
}
wf_budget_of(){ local v="${(P)${:-WF_BUDGET_$1}:-0}"; [[ "$v" == <-> ]] || v=0; print -r -- "$v"; }
wf_timeout_class(){ local v="${(P)${:-WF_TIMEOUT_CLASS_$1}:-record}"; print -r -- "$v"; }
wf_run_bounded(){
  local secs="$1"; shift
  [[ "$secs" == <-> ]] && (( secs > 0 )) || { "$@"; return $? }
  local step="${WF_BOUNDED_POLL:-1}" waited=0 pid rc
  "$@" & pid=$!
  while kill -0 $pid 2>/dev/null; do
    if (( waited >= secs )); then
      kill $pid 2>/dev/null; /bin/sleep 0.5; kill -9 $pid 2>/dev/null; wait $pid 2>/dev/null
      return 124
    fi
    /bin/sleep $step; (( waited += step ))
  done
  wait $pid; rc=$?; return $rc
}
```

- [ ] **Step 4: 测试通过；deploy.sh 清单加 `wf-limits.sh`；跑 `drift-check.test.mjs` 与 `phone-adb-controller-smoke.sh`（本地 bash）确认绿。**
- [ ] **Step 5: 提交** `feat(phone-adb): wf-limits.sh 限时共享库（总时限判定/预算读取/有界子进程）`。

---

### Task 2: `wf-plan.mjs` 编入预算与超时分类 + `wf_load_plan` export

**Files:**
- Modify: `scripts/product-map/wf-plan.mjs`（`planFor` env 追加）
- Modify: `scripts/product-map/__tests__/wf-plan.test.js`（期望值）
- Modify: `services/phone-adb-controller/plans/*.plan`（`--write` 重生成）
- Modify: `services/phone-adb-controller/wf-run.sh` `wf_load_plan`（export）
- Test: `services/phone-adb-controller/__tests__/wf-run.test.mjs`（新增用例）

**Interfaces（Produces）:** `.plan` 含 `WF_BUDGET_<key>` / `WF_TIMEOUT_CLASS_<key>`，key ∈ preflight discovery qualification collection scoring delivery outreach cleanup。

- [ ] **Step 1: 失败测试**：wf-plan.test.js 两条计划期望加 `WF_BUDGET_preflight:'300' ... WF_TIMEOUT_CLASS_delivery:'retryable'`（其余 record）；新增用例「retryable 条目含"超时"→ retryable」（改 ctx 后 planFor）。wf-run.test.mjs 新增：`wf_load_plan keyword_acquisition; zsh -c 'echo b=$WF_BUDGET_preflight c=$WF_TIMEOUT_CLASS_delivery'` → `b=300 c=retryable`。
- [ ] **Step 2: 跑，确认失败。**
- [ ] **Step 3: 实现**：

```js
const TIMEOUT_RETRYABLE_RE = /超时|timeout|scp\/ssh 失败/i;
function timeoutClass(a) { return (a.failure?.retryable || []).some((s) => TIMEOUT_RETRYABLE_RE.test(String(s))) ? 'retryable' : 'record'; }
// planFor env 末尾：
for (const a of acts) { env[`WF_BUDGET_${a.key}`] = String(a.budget?.max_duration_s ?? 0); }
for (const a of acts) { env[`WF_TIMEOUT_CLASS_${a.key}`] = timeoutClass(a); }
```
wf_load_plan 末尾：`export ${(k)parameters[(I)WF_BUDGET_*]} ${(k)parameters[(I)WF_TIMEOUT_CLASS_*]}`（有值才 export，写法 `local k; for k in ${(k)parameters}; do [[ $k == WF_BUDGET_* || $k == WF_TIMEOUT_CLASS_* ]] && export $k; done`）。
- [ ] **Step 4: `node scripts/product-map/wf-plan.mjs --write && --check` PASS；两套测试绿。**
- [ ] **Step 5: 提交** `feat(product-map): wf-plan 把契约每活动预算与超时分类编进执行计划`。

---

### Task 3: `workflow-result.sh finalize` 出 partial

**Files:**
- Modify: `services/phone-adb-controller/workflow-result.sh`（finalize 分支）
- Test: `services/phone-adb-controller/__tests__/workflow-result.test.mjs`

- [ ] **Step 1: 失败测试**：照既有 finalize 用例 init→enter→stage→finalize，env 加 `WFR_FINAL_REASON=deadline` → `kv.WFR_FINALIZE_FINAL === 'partial'`，`WFR_FINALIZE_MSG` 含 `reason=deadline`；无 reason 仍 completed；有 STOP 时仍 failed（reason 不覆盖 failed）。
- [ ] **Step 2: 跑，失败。**
- [ ] **Step 3: 实现**：`if [[ "$final" == completed && -n "${WFR_FINAL_REASON:-}" ]]; then final=partial; msg="$msg reason=$WFR_FINAL_REASON"; fi`（放在 final 判定之后、echo 之前）。
- [ ] **Step 4: 绿。** **Step 5: 提交** `feat(phone-adb): 账本 finalize 支持 partial 终态并记原因`。

---

### Task 4: `batch2.sh` 词边界总时限 + 落池/分拣预算

**Files:**
- Modify: `services/phone-adb-controller/batch2.sh`
- Test: `services/phone-adb-controller/__tests__/batch2-run-deadline.test.mjs`、`batch2-activity-budget.test.mjs`

**Interfaces（Produces）:** stdout `BATCH2_STOP_REASON=deadline`；`harvest-keyword` rc=4 → discovery failed `budget_exceeded`。

- [ ] **Step 1: 失败测试**
  - deadline：假 date（`+%s` 读 `$HOME/now`，其它透传）+ 假 HK（采完词 1 写 `$HOME/now` 为大值），env `WF_RUN_START_TS=1000 WF_RUN_MAX_SECONDS=100`，初始 now=1010 → hk.log 只有词一；night log `整批总时限到`；ssh.log 有 push-videos/push-raw-comments/sort-comments；stdout 含 `BATCH2_STOP_REASON=deadline`。未设 START_TS → 两词全跑、无 STOP_REASON。
  - budget：假 ssh 遇 `push-videos` sleep 3（读 env `SSH_PUSH_SLEEP`），`WF_BUDGET_delivery=1 WF_TIMEOUT_CLASS_delivery=retryable WF_BOUNDED_POLL=0.1` → ssh.log 里 push-videos 出现 2 次，night log `落池超预算`；`WF_BUDGET_scoring=1`、sort sleep 3、class record → sort 1 次、night log `分拣超预算`、rc=0。
- [ ] **Step 2: 跑，失败。**
- [ ] **Step 3: 实现**：文件头 `source "${0:A:h}/wf-limits.sh" 2>/dev/null || true`；词循环时窗判定后加：

```zsh
  if (( $+functions[wf_deadline_reached] )) && wf_deadline_reached; then
    print "[$(date +%H:%M:%S)] 整批总时限到(${WF_RUN_MAX_SECONDS:-14400}s),采收收工(词$n: $W 起未开跑)" >> $LOG
    DEADLINE_HIT=1; break
  fi
```
`wfr_word_stages` case 加 `4) wfr stage discovery failed "$n" "word=$W budget_exceeded" ...`；落池 ssh 改 `wf_run_bounded "$(wf_budget_of delivery)" ssh ...; prc=$?`，`if (( prc == 124 )) && [[ "$(wf_timeout_class delivery)" == retryable ]]; then log 落池超预算,重试1次; 再跑; fi`；分拣同法（124 只记账）。末尾 `(( DEADLINE_HIT )) && print "BATCH2_STOP_REASON=deadline"`。无 wf-limits 时用 `(( $+functions[...] ))` 守卫，行为与并入前一致。
- [ ] **Step 4: 新旧 batch2 测试全绿（含 `batch2-touch-window`、`harvest-leads-result` 等）。** **Step 5: 提交** `feat(phone-adb): batch2 词边界总时限平滑收工 + 落池/分拣按契约预算封顶`。

---

### Task 5: `harvest-keyword.sh` 视频边界总时限 + 发现/采集预算

**Files:**
- Modify: `services/phone-adb-controller/harvest-keyword.sh`
- Test: `services/phone-adb-controller/__tests__/harvest-keyword-run-deadline.test.mjs`、`harvest-keyword-activity-budget.test.mjs`

- [ ] **Step 1: 失败测试**（照 rescan-loop 假控制器；`HARVEST_KEYWORD_TESTING=1`）
  - deadline：假 ctl 在 `tap-evidence` 时写 `$HOME/now`=大值；假 date `+%s` 读文件；`WF_RUN_START_TS=1000 WF_RUN_MAX_SECONDS=100`，初始 now=1010，NCARDS=4 → tap 恰 1 次、ctl.log 有 `lock-release`、stderr `整批总时限到`、rc=0。到点在拿锁前（now 初始 2000）→ 无 lock-acquire、rc=0。
  - budget：假发现脚本 sleep 3；`WF_BUDGET_discovery=1 WF_BOUNDED_POLL=0.1` → rc=4、stderr `发现超预算`、lock-release 有；加 `WF_TIMEOUT_CLASS_discovery=retryable` → 发现脚本被调 2 次（脚本记 `$HOME/disc.log`）。采集段：`WF_BUDGET_qualification=0 WF_BUDGET_collection=50`，假 ctl tap 时把 now 拨到 +100 → tap 1 次、stderr `采集段超预算`、rc=0。
- [ ] **Step 2: 跑，失败。**
- [ ] **Step 3: 实现**：头部 source wf-limits；拿锁循环内每轮先 `wf_deadline_reached && { log 到点; rm -f $SEENVIDS; exit 0 }`；发现：

```zsh
disc_budget="$(wf_budget_of discovery)"
CARDS="$(wf_run_bounded "$disc_budget" "${DISCOVER_CMD:-...}" "$P" "$KW" "$MAXV" "$TAG" "$LOC")"; drc=$?
if (( drc == 124 )) && [[ "$(wf_timeout_class discovery)" == retryable ]]; then log "发现超预算(${disc_budget}s),契约 retryable 重试 1 次"; CARDS=...再跑; drc=$?; fi
(( drc == 124 )) && { log "发现超预算(${disc_budget}s),本词作废(记账)"; exit 4 }
(( drc != 0 )) && exit 1
```
`COLLECT_T0=$(date +%s)`；视频循环开头：到点 → log break；`cb=$(( $(wf_budget_of qualification) + $(wf_budget_of collection) ))`，`(( cb > 0 && now - COLLECT_T0 >= cb ))` → log `采集段超预算(${cb}s),本词剩余候选作废(记账)` break。
- [ ] **Step 4: 全部 harvest-keyword-*.test.mjs 绿。** **Step 5: 提交** `feat(phone-adb): harvest-keyword 视频边界总时限 + 发现/采集段按契约预算封顶`。

---

### Task 6: `wf-run.sh` 起跑记时 + 预检/取源预算 + partial 收工 + 整链验收测试

**Files:**
- Modify: `services/phone-adb-controller/wf-run.sh`
- Test: `services/phone-adb-controller/__tests__/wf-run-deadline-e2e.test.mjs`、`wf-run.test.mjs`（preflight 预算单测）

- [ ] **Step 1: 失败测试**
  - `wf-run.test.mjs` 新增 lib 用例：`WF_BUDGET_preflight=1 PF_LOCK_WAIT=1 PF_LOCK_TRIES=10`，假 `C` 永远 lock 失败 → `preflight_lock_acquire` 在 ≤3 秒返回、`LOCK_ACQUIRED=0`（预算封顶重试）。
  - e2e：假 adb（get-state 0；`dumpsys power` 输出 `mWakefulness=Awake`；telephony 输出 `mCallState=0`；其它 0）、假 ssh（`cron list --json` 回 escort id；`kpi-gate.js` 回 `{"verdict":"go","reason":"t","words":2}`；`next-keywords.js` 回两词；其它记 ssh.log 回 0）、假 scp 记日志、假 douyin-phone-adb（lock-acquire/release/status 用 `$HOME/lock` 目录真实现；account-current 回 `douyin_id=1`；close-app/return-safe-desktop 0；其它 0）、假 date（`+%H`→23，`+%s` 读 `$HOME/now`）、假 harvest-keyword（吐 VIDEO+LEAD，采完后把 now 拨过时限）、注册表 TSV `p1\t1`。env：`WFR_HOME=$HOME/wfr WFR_NODE=node WFR_JQ=jq WFR_LEDGER_MJS=<repo>/ledger.mjs WFR_SCP_TARGET= WFR_PROBE_STAGES= WFR_BRAIN_ENV=/nonexistent BRAIN_URL= WF_RUN_MAX_SECONDS=60 WALL_REPORT=/nonexistent HARVEST_KEYWORD=<fake> BATCH_SLEEP=0 WF_PLAN_DIR=<repo plans>`。断言：进程 <60s 退出 rc=0；hk.log 只 1 词；harvest-cron.log 含 `总时限到,平滑收工` 与 `final=partial`；`$HOME/lock` 不存在（锁 free）；ssh.log 含 `push-videos.js /tmp/<TAG>.tsv` 且 scp.log 含 night-<TAG>.tsv；ssh.log 含 `cron rm`；ledger cleanup 工件存在。
- [ ] **Step 2: 跑，失败。**
- [ ] **Step 3: 实现**：库块 source wf-limits；`preflight_lock_acquire` 加段起始时刻与 `WF_BUDGET_preflight` 封顶；主体 `WF_RUN_STARTED` 后 `export WF_RUN_START_TS=$(date +%s) WF_RUN_MAX_SECONDS=${WF_RUN_MAX_SECONDS:-14400}`，log；kpi/next-keywords ssh 用 `wf_run_bounded "$(wf_budget_of discovery)"`；B2OUT 后 `grep -q BATCH2_STOP_REASON=deadline` → `export WFR_FINAL_REASON=deadline; log; wr step 3 done "总时限到,平滑收工"`；run_finalize 里 finalize 前 `export WFR_FINAL_REASON`。
- [ ] **Step 4: 全量 `node --test services/phone-adb-controller/__tests__/*.test.mjs` 绿；`bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh` 与 `golden-path-2-smoke.sh` 源码守卫段本地过。** **Step 5: 提交** `feat(phone-adb): wf-run 整批总时限起跑记时+预检/取源预算+到点 partial 收工（验收整链假机测试）`。

---

### Task 7: 收尾

- [ ] 清理 console.log/未用变量；`zsh -n` 三脚本；`node scripts/product-map/wf-plan.mjs --check`。
- [ ] push、开 PR（正文含验收：`WF_RUN_MAX_SECONDS=60` 假控制器整链 60 秒内自收工、锁 free、TSV 行数落池；真机 proven-to-fire 由主会话安排）。
