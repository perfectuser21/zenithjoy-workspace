#!/usr/bin/env bash
# find_adb — 找出这台机器上真正可用的 adb，找不到就诚实失败。
#
# 为什么要有这个函数（2026-08-20 确诊）：nightly-android-fleet-pc4 连红三晚，
# 第一步就 exit 127。旧写法是
#     ADB=$(command -v adb 2>/dev/null || echo "C:/platform-tools/adb.exe")
# ——找不到时把一个**写死路径当结果返回**，调用方拿去执行，报的是
# "No such file or directory"，日志里完全看不出"我们其实没找到 adb"。
#
# 两个环境事实（都踩过）：
#   · GitHub self-hosted runner 是**服务进程**，PATH 与交互式 SSH 不同
#     —— `where adb` 在 SSH 里能找到，runner 里却找不到。
#   · pc4 runner 离线时，job 会落到同样带 android-capable 标签的 rog 上，
#     而两台机器的 adb 装在完全不同的位置。
#
# 因此：多路径探测 + **验证可执行** + 找不到时明确列出找过哪些位置。
#
# 用法：
#   source lib/find-adb.sh
#   ADB=$(find_adb) || exit 1        # 失败时 stdout 为空、诊断在 stderr
# 测试注入：FIND_ADB_CANDIDATES="路径1\n路径2" 覆盖候选清单。

find_adb() {
  local candidates
  if [ -n "${FIND_ADB_CANDIDATES:-}" ]; then
    # shellcheck disable=SC2059
    candidates=$(printf "${FIND_ADB_CANDIDATES}\n")
  else
    # 顺序照 e2e-line02-android-collect.yml 里已被真机验证过的那套：
    # scrcpy WinGet 目录优先（rog/pc4 上 adb 的实际位置），再 PATH，再常见安装位。
    candidates=$(printf '%s\n' \
      /c/Users/*/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_*/scrcpy-*/adb.exe \
      "$(command -v adb 2>/dev/null || true)" \
      /c/platform-tools/adb.exe \
      "C:/platform-tools/adb.exe" \
      "$HOME/Library/Android/sdk/platform-tools/adb" \
      /opt/homebrew/share/android-commandlinetools/platform-tools/adb \
      /usr/local/bin/adb)
  fi

  local c
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    [ -x "$c" ] || continue
    printf '%s\n' "$c"
    return 0
  done <<< "$candidates"

  {
    echo "find_adb: 找不到可用的 adb。已在下列位置找过（存在且可执行才算数）："
    printf '%s\n' "$candidates" | sed '/^$/d; s/^/  - /'
    echo "提示：GitHub self-hosted runner 是服务进程，PATH 与交互式 SSH 不同；"
    echo "      若 job 落到了非预期的 runner（如 pc4 离线时落到 rog），adb 位置也会不同。"
  } >&2
  return 1
}
