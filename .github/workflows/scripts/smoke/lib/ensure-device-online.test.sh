#!/usr/bin/env bash
# ensure-device-online.test.sh — 用 mock adb 验重连自愈逻辑（task c0efdb69）
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/ensure-device-online.sh"
PASS=0; FAIL=0
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# mock adb：行为由 $TMP/state 控制。devices 第 N 次调用读 $TMP/devN 内容。
make_adb() {
    cat > "$TMP/adb" <<'MOCK'
#!/usr/bin/env bash
STATE_DIR="$MOCK_STATE"
case "$1" in
  devices)
    n=$(cat "$STATE_DIR/dev_calls" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$STATE_DIR/dev_calls"
    cat "$STATE_DIR/dev_out_$n" 2>/dev/null || cat "$STATE_DIR/dev_out_default" 2>/dev/null || echo "List of devices attached"
    ;;
  connect) echo "connect $2" >> "$STATE_DIR/connect_log" ;;
  *) : ;;
esac
MOCK
    chmod +x "$TMP/adb"
}
make_adb
export MOCK_STATE="$TMP"

reset_state() { rm -f "$TMP"/dev_out_* "$TMP"/dev_calls "$TMP"/connect_log; }
assert() { if [ "$2" = "$3" ]; then echo "✅ $1"; PASS=$((PASS+1)); else echo "❌ $1: 得 $3 期 $2"; FAIL=$((FAIL+1)); fi; }

# Case 1: 已在线 → 返回 0，不调 connect
reset_state
printf 'List of devices attached\n192.168.1.96:5555\tdevice\n' > "$TMP/dev_out_default"
ensure_device_online "$TMP/adb" "192.168.1.96:5555"; rc=$?
assert "已在线返回 0" 0 "$rc"
assert "已在线不调 connect" "" "$(cat "$TMP/connect_log" 2>/dev/null || echo '')"

# Case 2: 先离线，connect 后第 2 次 devices 出现 device → 自愈返回 0
reset_state
printf 'List of devices attached\n' > "$TMP/dev_out_1"
printf 'List of devices attached\n192.168.1.96:5555\tdevice\n' > "$TMP/dev_out_2"
printf 'List of devices attached\n192.168.1.96:5555\tdevice\n' > "$TMP/dev_out_default"
ensure_device_online "$TMP/adb" "192.168.1.96:5555"; rc=$?
assert "掉线自愈返回 0" 0 "$rc"
assert "掉线自愈调了 connect" "connect 192.168.1.96:5555" "$(head -1 "$TMP/connect_log" 2>/dev/null)"

# Case 3: 一直离线且无端点 → 返回 1（交调用方 envfail）
reset_state
printf 'List of devices attached\n' > "$TMP/dev_out_default"
ensure_device_online "$TMP/adb" ""; rc=$?
assert "离线无端点返回 1" 1 "$rc"

echo "=== ensure-device-online: $PASS PASS / $FAIL FAIL ==="
[ "$FAIL" -eq 0 ]
