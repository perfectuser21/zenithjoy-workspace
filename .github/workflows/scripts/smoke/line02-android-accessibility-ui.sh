#!/usr/bin/env bash
set -euo pipefail

: "${ADB:?}"
: "${RUNNER_TEMP:?}"

ACTION="${1:?usage: $0 enable|restore}"
AGENT_PACKAGE="${AGENT_PACKAGE:-com.zenithjoy.agent.e2e}"
ACCESSIBILITY_SERVICE="$AGENT_PACKAGE/com.zenithjoy.agent.collect.DouyinCollectService"
SERVICE_LABEL="ZenithJoy Collect E2E"
BEFORE_SERVICES_FILE="$RUNNER_TEMP/r16-accessibility-services-before.txt"
BEFORE_ENABLED_FILE="$RUNNER_TEMP/r16-accessibility-enabled-before.txt"
UI_XML="/sdcard/zenithjoy-accessibility-$$.xml"
UI_CACHE="$RUNNER_TEMP/zenithjoy-accessibility-$$.xml"

cleanup() {
  "$ADB" shell rm -f "$UI_XML" >/dev/null 2>&1 || true
  rm -f "$UI_CACHE"
}
trap cleanup EXIT

read_services() {
  local value
  value=$("$ADB" shell settings get secure enabled_accessibility_services | tr -d '\r')
  if [ "$value" = "null" ]; then value=""; fi
  printf '%s' "$value"
}

has_target_service() {
  local services="$1"
  case ":$services:" in
    *":$ACCESSIBILITY_SERVICE:"*) return 0 ;;
    *) return 1 ;;
  esac
}

dump_ui() {
  "$ADB" shell uiautomator dump "$UI_XML" >/dev/null 2>&1
  "$ADB" shell cat "$UI_XML" | tr -d '\r' > "$UI_CACHE"
}

node_for_text() {
  local text="$1"
  sed 's/></>\n</g' "$UI_CACHE" \
    | grep -F "text=\"$text\"" \
    | grep -o '<node[^>]*>' \
    | head -1
}

node_for_resource() {
  local resource="$1"
  sed 's/></>\n</g' "$UI_CACHE" \
    | grep -F "resource-id=\"$resource\"" \
    | grep -o '<node[^>]*>' \
    | head -1
}

tap_node() {
  local node="$1" bounds left top right bottom
  bounds=$(printf '%s\n' "$node" \
    | sed -En 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/p')
  read -r left top right bottom <<<"$bounds"
  test -n "${bottom:-}"
  "$ADB" shell input tap "$(((left + right) / 2))" "$(((top + bottom) / 2))"
}

wait_and_tap_text() {
  local text="$1" node=""
  for _ in $(seq 1 20); do
    dump_ui || true
    node=$(node_for_text "$text" || true)
    if [ -n "$node" ]; then
      tap_node "$node"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for Android UI text: $text" >&2
  return 1
}

wait_and_tap_resource() {
  local resource="$1" node=""
  for _ in $(seq 1 20); do
    dump_ui || true
    node=$(node_for_resource "$resource" || true)
    if [ -n "$node" ]; then
      tap_node "$node"
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for Android UI resource: $resource" >&2
  return 1
}

wait_for_target_state() {
  local wanted="$1" current=""
  for _ in $(seq 1 20); do
    current=$(read_services)
    if [ "$wanted" = enabled ] && has_target_service "$current"; then
      return 0
    fi
    if [ "$wanted" = disabled ] && ! has_target_service "$current"; then
      return 0
    fi
    sleep 1
  done
  echo "Accessibility service did not become $wanted through the system UI" >&2
  return 1
}

open_target_service() {
  # Wake and unlock without changing the device's security policy.
  "$ADB" shell input keyevent 224 || true
  "$ADB" shell input swipe 540 1900 540 500 300 || true
  "$ADB" shell input keyevent 82 || true

  # ColorOS may show this optional prompt after PackageInstaller has already
  # returned success. Close it before opening Settings.
  dump_ui || true
  if [ -n "$(node_for_text "要开启安装增强防护吗？" || true)" ]; then
    wait_and_tap_text "取消"
  fi

  # ColorOS reuses the currently open Settings fragment for this action. A
  # clean Settings task is required when a previous run stopped on a service
  # detail page; this changes no setting and only resets the navigation stack.
  "$ADB" shell am force-stop com.android.settings
  "$ADB" shell am start -W -a android.settings.ACCESSIBILITY_SETTINGS >/dev/null
  wait_and_tap_text "已下载的应用"
  wait_and_tap_text "$SERVICE_LABEL"
}

case "$ACTION" in
  enable)
    if has_target_service "$(read_services)"; then
      echo "PASS: E2E accessibility service was already enabled"
      exit 0
    fi
    open_target_service
    wait_and_tap_resource "android:id/switch_widget"
    wait_and_tap_text "允许"
    wait_for_target_state enabled
    echo "PASS: E2E accessibility service enabled through Android UI"
    ;;
  restore)
    test -f "$BEFORE_SERVICES_FILE"
    expected_before=$(cat "$BEFORE_SERVICES_FILE")
    if [ "$expected_before" = "null" ]; then expected_before=""; fi
    if has_target_service "$expected_before"; then
      has_target_service "$(read_services)"
    elif has_target_service "$(read_services)"; then
      open_target_service
      wait_and_tap_resource "android:id/switch_widget"
      wait_and_tap_text "停止"
      wait_for_target_state disabled
    fi

    current=$(read_services)
    if [ "$current" != "$expected_before" ]; then
      echo "Accessibility services were not restored exactly" >&2
      echo "expected: $expected_before" >&2
      echo "actual:   $current" >&2
      exit 8
    fi
    if [ -f "$BEFORE_ENABLED_FILE" ]; then
      expected_enabled=$(cat "$BEFORE_ENABLED_FILE")
      current_enabled=$("$ADB" shell settings get secure accessibility_enabled | tr -d '\r')
      test "$current_enabled" = "$expected_enabled"
    fi
    echo "PASS: original accessibility state restored through Android UI"
    ;;
  *)
    echo "Unknown action: $ACTION" >&2
    exit 2
    ;;
esac
