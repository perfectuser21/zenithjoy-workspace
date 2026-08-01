#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/e2e-line02-android-collect.yml"
GRADLE="$ROOT/services/agent-android/app/build.gradle.kts"
SMOKE="$ROOT/.github/workflows/scripts/smoke/line02-android-cancel-realmachine-smoke.sh"
SETUP="$ROOT/.github/workflows/scripts/smoke/line02-android-cancel-candidate-setup.sh"
REMOTE_ADB="$ROOT/.github/workflows/scripts/smoke/remote-adb.sh"
REMOTE_INSTALL="$ROOT/.github/workflows/scripts/smoke/remote-android-install.sh"
ACCESSIBILITY_UI="$ROOT/.github/workflows/scripts/smoke/line02-android-accessibility-ui.sh"
E2E_MANIFEST="$ROOT/services/agent-android/app/src/e2e/AndroidManifest.xml"

grep -Fq 'create("e2e")' "$GRADLE"
grep -Fq 'applicationIdSuffix = ".e2e"' "$GRADLE"
grep -Fq 'gradle :app:assembleE2e' "$WORKFLOW"
grep -Fq 'group: e2e-line02-android-collect-v2' "$WORKFLOW"
grep -Fq 'run-name: ${{ inputs.attempt_marker }}' "$WORKFLOW"
grep -Fq 'runs-on: [self-hosted, android-capable, us-m4]' "$WORKFLOW"
grep -Fq 'ANDROID_REMOTE_HOST: xian-m4-cf' "$WORKFLOW"
grep -Fq 'ANDROID_DEVICE_ENDPOINT: 192.168.3.242:5555' "$WORKFLOW"
if grep -Fq 'adb connect 100.90.248.81:5555' "$WORKFLOW"; then
  echo "Xian-side adb must use the phone LAN endpoint, not Tailscale" >&2
  exit 1
fi
grep -Fq 'scp ' "$WORKFLOW"
grep -Fq 'remote-adb.sh' "$WORKFLOW"
grep -Fq 'remote-android-install.sh' "$WORKFLOW"
grep -Fq 'createdb "$E2E_DATABASE_NAME"' "$WORKFLOW"
grep -Fq 'E2E_DATABASE_URL=postgresql://' "$WORKFLOW"
grep -Fq 'dropdb --force --if-exists "$E2E_DATABASE_NAME"' "$WORKFLOW"
grep -Fq 'npm run build --workspace apps/api' "$WORKFLOW"
grep -Fq 'node -r dotenv/config apps/api/dist/index.js' "$WORKFLOW"
grep -Fq 'API_PORT=$((20000 + GITHUB_RUN_ID % 20000))' "$WORKFLOW"
grep -Fq 'PORT="$API_PORT"' "$WORKFLOW"
grep -Fq 'API_BASE=http://127.0.0.1:$API_PORT' "$WORKFLOW"
grep -Fq 'API_WS_URL=ws://$TAILNET_IP:$API_PORT/agent-ws' "$WORKFLOW"
grep -Fq 'API_PID=$!' "$WORKFLOW"
grep -Fq 'echo "API_PID=$API_PID"' "$WORKFLOW"
if grep -Fq 'PORT=5301' "$WORKFLOW"; then
  echo "Candidate API must not collide with long-lived OrbStack port mappings" >&2
  exit 1
fi
if grep -Fq 'npm run dev --workspace apps/api' "$WORKFLOW"; then
  echo "Candidate API must run its exact built dist, not ts-node-dev" >&2
  exit 1
fi
if grep -Fq 'E2E_DATABASE_URL: ${{ secrets.E2E_DATABASE_URL }}' "$WORKFLOW"; then
  echo "Android cancel workflow must own an isolated local E2E database" >&2
  exit 1
fi
grep -Fq 'line02-android-cancel-candidate-setup.sh' "$WORKFLOW"
grep -Fq 'ADB_BIND_URI=' "$SETUP"
grep -Fq -- '-d "$ADB_BIND_URI"' "$SETUP"
if grep -Fq -- '-d "$BIND_URI"' "$SETUP"; then
  echo "adb shell must quote the deep-link ampersand before parsing on-device" >&2
  exit 1
fi
FORCE_STOP_LINE=$(grep -nF 'am force-stop "$AGENT_PACKAGE"' "$SETUP" | cut -d: -f1)
ACCESSIBILITY_ENABLE_LINE=$(grep -nF '"$ACCESSIBILITY_UI" enable' "$SETUP" | cut -d: -f1)
test -n "$FORCE_STOP_LINE"
test -n "$ACCESSIBILITY_ENABLE_LINE"
if [ "$FORCE_STOP_LINE" -ge "$ACCESSIBILITY_ENABLE_LINE" ]; then
  echo "ColorOS force-stop must happen before accessibility UI admission" >&2
  exit 1
fi
grep -Fq 'line02-android-accessibility-ui.sh' "$SETUP"
grep -Fq 'line02-android-accessibility-ui.sh' \
  "$ROOT/.github/workflows/scripts/smoke/line02-android-cancel-candidate-cleanup.sh"
if grep -Fq 'settings put secure' "$SETUP" \
  || grep -Fq 'settings put secure' \
    "$ROOT/.github/workflows/scripts/smoke/line02-android-cancel-candidate-cleanup.sh"; then
  echo "Candidate fixture must grant and revoke accessibility through the phone UI" >&2
  exit 1
fi
test -x "$ACCESSIBILITY_UI"
grep -Fq 'android.settings.ACCESSIBILITY_SETTINGS' "$ACCESSIBILITY_UI"
grep -Fq 'am force-stop com.android.settings' "$ACCESSIBILITY_UI"
grep -Fq '已下载的应用' "$ACCESSIBILITY_UI"
grep -Fq 'ZenithJoy Collect E2E' "$ACCESSIBILITY_UI"
grep -Fq 'wait_and_tap_text "停止"' "$ACCESSIBILITY_UI"
grep -Fq 'enabled_accessibility_services' "$ACCESSIBILITY_UI"
grep -Fq 'expected_before' "$ACCESSIBILITY_UI"
if grep -Fq 'settings put secure' "$ACCESSIBILITY_UI"; then
  echo "Accessibility helper must not bypass WRITE_SECURE_SETTINGS" >&2
  exit 1
fi
grep -Fq 'android:label="ZenithJoy Collect E2E"' "$E2E_MANIFEST"
grep -Fq 'android:name=".collect.DouyinCollectService"' "$E2E_MANIFEST"
grep -Fq "status, agent_id, started_at" "$SMOKE"
grep -Fq 'TASK_AGENT_ID" = "$E2E_AGENT_UUID' "$SMOKE"
grep -Fq 'stage1 task received: keyword=装修 id=$TASK_ID' "$SMOKE"
grep -Fq 'logcat --pid="$APP_PID"' "$SMOKE"
grep -Fq "/api/acquisition/collect/cancel" "$SMOKE"
grep -Fq 'CANCEL_HTTP_STATUS' "$SMOKE"
grep -Fq 'task status before cancel=' "$SMOKE"
grep -Fq "status = 'cancelled'" "$SMOKE"
test -x "$SETUP"
test -x "$REMOTE_ADB"
test -x "$REMOTE_INSTALL"
grep -Fq 'install --no-streaming -r' "$REMOTE_INSTALL"
grep -Fq 'text="继续安装"' "$REMOTE_INSTALL"
grep -Fq 'pm path "$AGENT_PACKAGE"' "$REMOTE_INSTALL"

echo "PASS: Android cancel workflow owns a real candidate API/PG/phone fixture"
