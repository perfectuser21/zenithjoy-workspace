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
# wf_run_bounded SECS cmd... —— 子进程跑 cmd,超 SECS 秒 TERM→0.5s→KILL,rc=124;SECS 为 0/非数字 = 不限,直接透传。
#   stdout/stderr 原样继承(命令替换里照常能拿到输出)。轮询步长 WF_BOUNDED_POLL(默认 1s,单测用 0.1)。
wf_run_bounded(){
  local secs="$1"; shift
  if [[ "$secs" != <-> ]] || (( secs <= 0 )); then "$@"; return $?; fi
  local step="${WF_BOUNDED_POLL:-1}" waited=0 pid rc
  "$@" &
  pid=$!
  while kill -0 $pid 2>/dev/null; do
    if (( waited >= secs )); then
      kill $pid 2>/dev/null; /bin/sleep 0.5; kill -9 $pid 2>/dev/null
      wait $pid 2>/dev/null
      return 124
    fi
    /bin/sleep $step
    (( waited += step ))
  done
  wait $pid; rc=$?
  return $rc
}
