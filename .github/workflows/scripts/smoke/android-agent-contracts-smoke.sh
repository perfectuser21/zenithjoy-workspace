#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
project="$root/services/agent-android"
if [ "${1:-}" != "--verify-results" ]; then
  sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
  if [ ! -d "$sdk/platforms" ] && ! grep -q '^sdk.dir=' "$project/local.properties" 2>/dev/null; then
    echo 'FAIL: Android SDK is required; SDK absence cannot pass command/judgment contracts' >&2
    exit 1
  fi
  cd "$project"
  ./gradlew :app:testDebugUnitTest --tests 'com.zenithjoy.agent.command.*' --tests '*AgentServiceCommandRouteTest*' --tests '*ContentJudgmentClientWiringTest*' --console=plain --no-daemon
fi
python3 "$root/.github/workflows/scripts/smoke/helpers/android-agent-contracts.py" "$project/app/build/test-results/testDebugUnitTest"
