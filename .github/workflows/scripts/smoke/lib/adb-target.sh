#!/usr/bin/env bash
# adb-target.sh — 选定唯一 adb 目标设备，供所有真机 smoke 绑定 -s 使用。
#
# 背景（2026-08-17 实测）：adb server 每次重启会通过 mDNS **自动**再连一个 transport，
# 同一台物理手机因此同时出现 `192.168.1.96:5555` 与
# `adb-<序列号>-xxxx._adb-tls-connect._tcp` 两条 device 行。此时任何不带 -s 的
# adb 调用都返回 `more than one device/emulator`，调用方 grep 拿到空 →
# 误报"包未安装 / 无障碍未开"这类假环境错误（e2e-line02-android-collect 连红 12+ 晚
# 的两大成因之一）。清理旧 transport 治不了本——几分钟后 mDNS 又会把它加回来，
# 所以正解是所有调用显式绑定 -s。
#
# 与 lib/dedupe-adb-devices.sh 的分工：那个按 ro.serialno 给"要遍历多台设备"的车道
# 去重；本文件解决"只操作一台时该用哪一台"，不需要逐台 getprop 往返。
#
# select_adb_device ADB_CMD [ENDPOINT]
#   ADB_CMD  — adb 可执行路径或函数名（测试用函数注入）
#   ENDPOINT — 期望的目标（通常是 $ANDROID_ADB_ENDPOINT）。在线则优先选它：
#              这是"配置意图"，比"adb devices 第一行"可预测。
#   未设 ENDPOINT 或它不在线 → 回落到第一个 device 行（保持不配端点车道的原有行为，
#   与 lib/ensure-device-online.sh 的设计一致）。
#   顺带修掉一个老缺陷：原先各脚本直接 `awk '/device$/{print $1; exit}'`，多台手机
#   在线时等于随机挑一台（0804 gp2 smoke 审计已记录）。
#   输出：选中的 adb serial（stdout）；无任何在线设备 → 输出空、返回 1。
select_adb_device() {
    local adb_cmd="$1"
    local endpoint="${2:-}"
    local devices
    devices=$("$adb_cmd" devices 2>/dev/null)

    if [ -n "$endpoint" ] \
       && printf '%s\n' "$devices" | grep -qE "^${endpoint}[[:space:]]+device$"; then
        printf '%s' "$endpoint"
        return 0
    fi

    local first
    first=$(printf '%s\n' "$devices" | awk '/[[:space:]]device$/{print $1; exit}')
    [ -n "$first" ] || return 1
    printf '%s' "$first"
}
