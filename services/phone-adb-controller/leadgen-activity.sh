#!/bin/zsh
# Activity入口属于四流程冻结执行器；禁止绕过定义绑定直接触碰设备或库。
set -euo pipefail
[[ -n "${WFR_RUN_DIR:-}" && -n "${WFR_ATTEMPT:-}" ]] || { print -u2 '缺固定运行身份'; exit 1; }
exec node "${0:A:h}/leadgen-workflow.mjs" "$@"
