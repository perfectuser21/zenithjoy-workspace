#!/usr/bin/env bash
# ensure-shizuku-server.sh — Shizuku shell server 存活判定 + 拉起（rog/pc4 常驻机队专用）
#
# 背景：2026-08-15 真机 spike（决策 78bd0467→799ad215→1fe3c420）已验证 Shizuku shell
# 权限级 input tap 可行，但 shizuku_server 进程重启后会消失，必须重新用 adb 拉起
# （Shizuku 官方文档原话："这个过程每次设备重新启动后需要重新进行"）。范围明确限定
# rog/pc4 常驻测试机队（adb 访问在这两台机器上是常驻的），不覆盖脱离机队的远程设备。
# 不建常驻 60s 轮询 daemon——当前没有生产流程消费 Shizuku，先把"能可靠拉起"这个能力
# 做扎实即可（thin 优先）。

# shizuku_server_alive — 判断 adb shell ps -A 的文本输出里有没有 shizuku_server 进程。
# 用法：shizuku_server_alive "$ps_output"；含有则 return 0，不含则 return 1。
shizuku_server_alive() {
  local ps_output="$1"
  printf '%s\n' "$ps_output" | grep -qw 'shizuku_server'
}

# resolve_shizuku_starter_path — 从 adb shell pm path moe.shizuku.privileged.api 的文本
# 输出里解析出 libshizuku.so 启动器路径。
#
# 输入可能是单行，也可能因为 AAB 分包安装而是多行（base.apk + 若干 split_config.*.apk）；
# 只有以 base.apk 结尾的那一行是我们要的（split apk 不含 lib 目录）。把该行路径里的
# "/base.apk" 替换成 "/lib/arm64/libshizuku.so" 后输出到 stdout。
#
# 空输入（App 未安装）或找不到 base.apk 行 → 不输出，return 1。
resolve_shizuku_starter_path() {
  local pm_path_output="$1"
  [ -z "$pm_path_output" ] && return 1

  local base_line
  base_line=$(printf '%s\n' "$pm_path_output" | grep '/base\.apk$' | head -n 1)
  [ -z "$base_line" ] && return 1

  local apk_path="${base_line#package:}"
  printf '%s\n' "${apk_path%/base.apk}/lib/arm64/libshizuku.so"
}

# ensure_shizuku_server — 胶水函数：确保指定 serial 的设备上 shizuku_server 处于存活状态，
# 不存活就重新拉起。调用真实 adb，不在纯函数单测覆盖范围（同目录 dedupe_adb_devices 的
# 胶水调用方也是直接写 CI 内联，不额外造一层 mock）。
#
# 用法：ensure_shizuku_server "<adb serial>"；成功（已存活或成功拉起）return 0，
# 失败（设备未就绪 / App 未安装 / 拉起后仍不存活）return 1，失败原因打到 stderr。
ensure_shizuku_server() {
  local serial="$1"

  local state
  state=$(adb -s "$serial" get-state 2>/dev/null || echo "")
  if [ "$state" != "device" ]; then
    echo "ensure_shizuku_server: 设备 $serial 状态非 device（实际: ${state:-unknown}），跳过" >&2
    return 1
  fi

  local ps_output
  ps_output=$(adb -s "$serial" shell ps -A 2>/dev/null || echo "")
  if shizuku_server_alive "$ps_output"; then
    return 0
  fi

  local pm_path_output
  pm_path_output=$(adb -s "$serial" shell pm path moe.shizuku.privileged.api 2>/dev/null || echo "")
  local starter_path
  starter_path=$(resolve_shizuku_starter_path "$pm_path_output") || {
    echo "ensure_shizuku_server: 设备 $serial 上解析不出 libshizuku.so 路径（App 未安装？）" >&2
    return 1
  }

  adb -s "$serial" shell "$starter_path" >/dev/null 2>&1

  local ps_output_after
  ps_output_after=$(adb -s "$serial" shell ps -A 2>/dev/null || echo "")
  if shizuku_server_alive "$ps_output_after"; then
    return 0
  fi

  echo "ensure_shizuku_server: 设备 $serial 执行拉起命令后 shizuku_server 仍不存活" >&2
  return 1
}
