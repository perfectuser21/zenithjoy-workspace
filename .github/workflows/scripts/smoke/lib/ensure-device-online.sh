#!/usr/bin/env bash
# ensure-device-online.sh — WiFi-adb 掉线自愈（真机夜车根因）
#
# 四号机等走 WiFi-adb 的真机(如 192.168.1.96:5555)夜里息屏后连接会掉，rog runner 只
# `adb devices` 查不到就 envfail，从不重连——nightly 因此连红。本函数在设备不在线时
# `adb connect <endpoint>` + 唤醒 + 有界重试自愈。
#
# 仅当 ANDROID_ADB_ENDPOINT 设置（或显式传第二参）时才重连；未设置=交给调用方原有
# envfail（如 us-m4 走 remote-adb.sh 自管连接的车道，不设该 env，行为完全不变）。
#
# 用法：
#   source "$(dirname "$0")/lib/ensure-device-online.sh"
#   ensure_device_online "$ADB" "${ANDROID_ADB_ENDPOINT:-}" \
#     || envfail "无 Android 设备在线（重连失败）"
#
# 返回 0 = 设备在线（可能刚重连上）；非 0 = 仍不在线，调用方 envfail。

ensure_device_online() {
    local adb="$1"
    local endpoint="${2:-${ANDROID_ADB_ENDPOINT:-}}"

    # 已有在线设备（adb devices 出现 'device' 行）→ 直接放行。
    if "$adb" devices 2>/dev/null | grep -qE '[[:space:]]device$'; then
        return 0
    fi

    # 没配端点又不在线 → 无从重连，交回调用方 envfail。
    [ -n "$endpoint" ] || return 1

    local i
    for i in 1 2 3 4 5; do
        echo "  [ensure-device-online $i/5] adb connect $endpoint …" >&2
        "$adb" connect "$endpoint" >/dev/null 2>&1 || true
        sleep 2
        if "$adb" devices 2>/dev/null | grep -qE '[[:space:]]device$'; then
            # 连回来后唤醒屏幕（息屏态下无障碍/采集常拿不到有效树）。
            "$adb" -s "$endpoint" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
            echo "  [ensure-device-online] 已重连 $endpoint" >&2
            return 0
        fi
        # offline 态先清一下再重试。
        "$adb" reconnect offline >/dev/null 2>&1 || true
        "$adb" disconnect "$endpoint" >/dev/null 2>&1 || true
        sleep 3
    done
    return 1
}
