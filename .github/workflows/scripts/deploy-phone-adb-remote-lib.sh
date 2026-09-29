#!/bin/bash
# deploy-phone-adb-remote-lib.sh —— phone-adb-controller 自动部署 workflow 的远端判断逻辑
# 从 .github/workflows/deploy-phone-adb-controller.yml 的 SSH 远程 heredoc 里 source，
# 也可独立跑单测（见 __tests__/deploy-phone-adb-remote-lib.test.mjs）。

# check_clean_checkout REPO_DIR
#   只关心已跟踪文件的改动(git reset --hard 会真正覆盖掉的那部分)：
#   REPO_DIR 里已跟踪文件全部干净(无论有没有未跟踪的新文件/目录) -> return 0，无输出
#   已跟踪文件有未提交改动，或 REPO_DIR 根本不是合法git仓库 -> return 1，
#   stderr 打印 ABORT 提示（自动部署绝不 git reset --hard 静默覆盖本地改动）
#   未跟踪文件(git status --short 里 ?? 开头的行)不影响判定——它们不会被 reset --hard 动，
#   不该被这道闸拦住(0929实测: mmv checkout长期有.cecelia/等未跟踪残留,不忽略会导致
#   这道闸永远触发,自动部署一次都跑不成功)。
check_clean_checkout() {
  local repo_dir="$1"
  local status
  if ! status="$(git -C "$repo_dir" status --short 2>/dev/null)"; then
    echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
    return 1
  fi
  local tracked_dirty
  tracked_dirty="$(printf '%s\n' "$status" | grep -v '^?? ' || true)"
  if [[ -n "$tracked_dirty" ]]; then
    echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
    return 1
  fi
  return 0
}
