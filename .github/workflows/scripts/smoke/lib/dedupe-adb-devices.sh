#!/usr/bin/env bash
# dedupe_adb_devices — 按硬件序列号(ro.serialno)对 adb serial 列表去重。
#
# 背景：同一台物理 Android 设备可能同时挂 USB serial + 无线调试 IP:port 两条
# adb 连接 entry（或无线调试换端口后旧 entry 未清理），adb devices 输出的多条
# entry 可能指向同一台真机——不去重会导致同一物理设备被两个不同 job 并发操作、
# 互相干扰（2026-08-03 夜 pc4 车道实测复现：2 红 1 取消）。
#
# 用法：从 stdin 读 "adb_id<TAB>hw_serial" 配对（每行一对，调用方负责枚举
# hw_serial，通常用 `adb -s <serial> shell getprop ro.serialno`），输出去重后的
# adb_id 列表（stdout，每行一个，保留每个 hw_serial 首次出现的 adb_id）。
# hw_serial 为空（读取失败/设备刚断连）的行原样保留，不去重——读不到就不敢猜，
# 宁可少去重也不可误杀真设备。
dedupe_adb_devices() {
  local seen=""
  local adb_id hw_serial
  while IFS=$'\t' read -r adb_id hw_serial; do
    [ -z "$adb_id" ] && continue
    if [ -z "$hw_serial" ]; then
      echo "$adb_id"
      continue
    fi
    case "$seen" in
      *"|${hw_serial}|"*) continue ;;
    esac
    seen="${seen}|${hw_serial}|"
    echo "$adb_id"
  done
}
