#!/bin/zsh
# wf-limits.sh — 执行器限时共享库(任务 7d150e33,决策 3c98fb36 阶段1「先稳」)。
# 被 wf-run.sh(库块)/batch2.sh/harvest-keyword.sh 以 `source "${0:A:h}/wf-limits.sh"` 装入;只装函数,不跑主体。
# 0930 事故: 三部手机死循环 6 小时无人能停——执行器既无整批总时限,也没把契约每活动 budget.max_duration_s 用起来。
# 设计口径(PRD 阶段1 7d150e33):
#   ① 整批总时限只在**边界**判(batch2 词边界 / harvest-keyword 视频边界),到点平滑收工,绝不 kill 手机侧动作;
#   ② 活动预算对手机侧动作同样只在边界判;wf_run_bounded 只用于远程调用(ssh/scp/发现脚本)这类杀了也不留手机现场的子进程。
# 三个输入全由 wf-run.sh 起跑 export: WF_RUN_START_TS(epoch 秒)/WF_RUN_MAX_SECONDS(默认 14400)/WF_BUDGET_*、WF_TIMEOUT_CLASS_*(执行计划)。
# 脚本被单独手跑(没有这些 env)→ 永不到点、预算 0=不限,行为与并入前逐字一致。

# wf_deadline_reached —— rc 0 = 整批总时限已到;缺/非数字起跑时刻 rc 1。WF_NOW_TS 只供测试注入当前时刻
wf_deadline_reached(){
  local now start="${WF_RUN_START_TS:-}" max="${WF_RUN_MAX_SECONDS:-14400}"
  [[ "$start" == <-> && "$max" == <-> ]] || return 1
  now="${WF_NOW_TS:-$(date +%s)}"
  [[ "$now" == <-> ]] || return 1
  (( now - start >= max ))
}
# wf_stop_requested —— rc 0 = Commander 请求平滑收工(任务 2fc3b6fc,决策 018e4e84 三档「自动做」的正规入口)。
#   约定: wf-run.sh 起跑 export WF_STOP_FILE=~/wf-runs/<TAG>.stop;Commander(escort/分身)在执行机 touch 该文件,
#   batch2 词边界 / harvest-keyword 视频边界检测到即按 deadline 同路径收工(已采落池、放锁、账本 partial)。
#   缺 WF_STOP_FILE(单独手跑/旧部署)→ 恒 rc 1,行为与并入前一致。禁止用 kill 代替:kill 不清手机现场、不放锁、账本 lost。
wf_stop_requested(){
  [[ -n "${WF_STOP_FILE:-}" && -e "$WF_STOP_FILE" ]]
}
# wf_stop_reason —— 打印本边界的收工原因: deadline(总时限是硬上限,优先) / commander_stop / 空(继续跑)
wf_stop_reason(){
  if wf_deadline_reached; then print -r -- deadline
  elif wf_stop_requested; then print -r -- commander_stop
  fi
}
# wf_budget_of KEY —— 打印活动 KEY 的预算秒数(WF_BUDGET_<KEY>);未设/非数字 → 0(不限)
wf_budget_of(){
  local v="${(P)${:-WF_BUDGET_$1}:-0}"
  [[ "$v" == <-> ]] || v=0
  print -r -- "$v"
}
# wf_timeout_class KEY —— 打印活动 KEY 超时时的契约失败分类(WF_TIMEOUT_CLASS_<KEY>): retryable(重试一次) / record(记账进入下一单元)
wf_timeout_class(){
  local v="${(P)${:-WF_TIMEOUT_CLASS_$1}:-record}"
  [[ "$v" == retryable ]] || v=record
  print -r -- "$v"
}
# _wf_kill_tree PID SIG —— 先杀子孙再杀自己:发现脚本/ssh 下面还挂着 adb/sleep 等孙进程,只杀 PID 它们会继续占着
#   stdout 管道,命令替换 $(...) 就一直等到它们自己跑完,预算等于没封(单测 4s 假发现实证)。
_wf_kill_tree(){
  local pid="$1" sig="$2" c
  for c in $(pgrep -P "$pid" 2>/dev/null); do _wf_kill_tree "$c" "$sig"; done
  kill "-$sig" "$pid" 2>/dev/null
}
# wf_run_bounded SECS cmd... —— 子进程跑 cmd,超 SECS 秒 TERM→0.5s→KILL(整棵子进程树),rc=124;SECS 为 0/非数字 = 不限,直接透传。
#   stdout/stderr 原样继承(命令替换里照常能拿到输出)。轮询步长 WF_BOUNDED_POLL(默认 1s,单测用 0.1)。
wf_run_bounded(){
  local secs="$1"; shift
  if [[ "$secs" != <-> ]] || (( secs <= 0 )); then "$@"; return $?; fi
  local step="${WF_BOUNDED_POLL:-1}" waited=0 pid rc
  "$@" &
  pid=$!
  while kill -0 $pid 2>/dev/null; do
    if (( waited >= secs )); then
      _wf_kill_tree $pid TERM; /bin/sleep 0.5; _wf_kill_tree $pid KILL
      wait $pid 2>/dev/null
      return 124
    fi
    /bin/sleep $step
    (( waited += step ))
  done
  wait $pid; rc=$?
  return $rc
}
