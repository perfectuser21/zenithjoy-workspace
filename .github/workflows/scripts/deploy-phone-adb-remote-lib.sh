#!/bin/bash
# deploy-phone-adb-remote-lib.sh —— phone-adb-controller 自动部署 workflow 的远端判断逻辑
# 从 .github/workflows/deploy-phone-adb-controller.yml 的 SSH 远程 heredoc 里 source，
# 也可独立跑单测（见 __tests__/deploy-phone-adb-remote-lib.test.mjs）。

# check_clean_checkout REPO_DIR
#   REPO_DIR 工作区干净(无未提交/未跟踪改动) -> return 0，无输出
#   不干净 -> return 1，stderr 打印 ABORT 提示（自动部署绝不 git reset --hard 静默覆盖本地改动）
check_clean_checkout() {
  local repo_dir="$1"
  if [[ -n "$(git -C "$repo_dir" status --short)" ]]; then
    echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
    return 1
  fi
  return 0
}
