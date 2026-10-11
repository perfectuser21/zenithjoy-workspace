#!/bin/zsh
# harvest-cron.sh PROFILE SERIAL BIZ N PUSH —— 24×7 夜间采收自动扳机(M4/M1 crontab,调用方式一字不改)
# 决策 7f842d12(契约组装执行): 已退成薄壳——全部逻辑搬进 wf-run.sh(按契约执行计划跑的通用驱动),
#   这里固定能力 = keyword_acquisition,参数原样透传。历史注释(0915-0929 各次修复的来龙去脉)随代码一起在 wf-run.sh。
# 库模式: HARVEST_CRON_LIB=1 source 本文件 = source wf-run.sh 的库块(只装函数不跑主体),既有单测照旧。
if [[ "${HARVEST_CRON_LIB:-0}" == "1" ]]; then source "${${(%):-%x}:A:h}/wf-run.sh"; return 0; fi
# 派发总闸D(dd7767b8): crontab 保底直调本脚本时先过 Brain 设备锁——xian-m4 的 crontab 经 ssh 改不动(macOS TCC),
#   闸只能放在这里。harvest-fallback.sh 领到锁后带 HARVEST_BRAIN_LOCK_HELD=1 回调本脚本,才走到下面的 exec。
#   Commander 主路径(wf-launch.sh)直接起 wf-run.sh,不经过本脚本,不受影响。
if [[ -z "${HARVEST_BRAIN_LOCK_HELD:-}" && -f "${0:A:h}/harvest-fallback.sh" ]]; then exec /bin/zsh "${0:A:h}/harvest-fallback.sh" "$@"; fi
exec /bin/zsh "${0:A:h}/wf-run.sh" keyword_acquisition "$@"
