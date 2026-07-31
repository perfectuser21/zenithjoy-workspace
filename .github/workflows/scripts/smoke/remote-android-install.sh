#!/usr/bin/env bash
set -euo pipefail

: "${REMOTE_APK:?}"
: "${ANDROID_DEVICE_ENDPOINT:?}"
: "${AGENT_PACKAGE:?}"

ADB=/opt/homebrew/bin/adb
INSTALL_LOG=$(mktemp /tmp/zenithjoy-android-install.XXXXXX)
UI_XML="/sdcard/zenithjoy-install-$$.xml"
cleanup() {
  status=$?
  trap - EXIT
  rm -f "$INSTALL_LOG"
  "$ADB" shell rm -f "$UI_XML" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

"$ADB" disconnect 100.90.248.81:5555 >/dev/null 2>&1 || true
"$ADB" connect "$ANDROID_DEVICE_ENDPOINT" >/dev/null
"$ADB" wait-for-device
"$ADB" uninstall "$AGENT_PACKAGE" >/dev/null 2>&1 || true

# ColorOS refuses to finish a USB install while the device is locked.
"$ADB" shell input keyevent 224 || true
"$ADB" shell input swipe 540 1900 540 500 300 || true
"$ADB" shell input keyevent 82 || true

"$ADB" install --no-streaming -r "$REMOTE_APK" >"$INSTALL_LOG" 2>&1 &
install_pid=$!
confirmed=false

for _ in $(seq 1 90); do
  if ! kill -0 "$install_pid" 2>/dev/null; then
    break
  fi

  "$ADB" shell uiautomator dump "$UI_XML" >/dev/null 2>&1 || true
  install_node=$("$ADB" shell cat "$UI_XML" 2>/dev/null \
    | grep -o '<node[^>]*text="继续安装"[^>]*>' \
    | head -1 || true)
  if [ -n "$install_node" ]; then
    bounds=$(printf '%s\n' "$install_node" \
      | sed -En 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/p')
    read -r left top right bottom <<<"$bounds"
    test -n "${bottom:-}"
    "$ADB" shell input tap "$(((left + right) / 2))" "$(((top + bottom) / 2))"
    confirmed=true
  fi
  sleep 1
done

if kill -0 "$install_pid" 2>/dev/null; then
  kill "$install_pid" 2>/dev/null || true
  wait "$install_pid" 2>/dev/null || true
  cat "$INSTALL_LOG" >&2
  echo "Timed out waiting for ColorOS package installation" >&2
  exit 7
fi

set +e
wait "$install_pid"
install_status=$?
set -e
cat "$INSTALL_LOG"
test "$install_status" -eq 0
test "$confirmed" = true
"$ADB" shell pm path "$AGENT_PACKAGE" | grep -Fq 'package:'

# Close ColorOS's optional post-install "enhanced protection" suggestion.
"$ADB" shell input keyevent 4 || true
echo "PASS: exact E2E APK installed through Xian LAN device endpoint"
