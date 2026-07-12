#!/usr/bin/env bash
# smoke: content-judgment-client-wiring
# 验证 Android 单元测试 ContentJudgmentClientWiringTest 全部通过
# CI 环境: windows-latest runner（gradlew 在 Windows 上用 gradlew.bat，此脚本在 bash/Git Bash 环境执行）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
AGENT_ANDROID_DIR="${REPO_ROOT}/services/agent-android"

echo "[smoke] content-judgment-client-wiring: 开始"
echo "[smoke] Android 项目目录: ${AGENT_ANDROID_DIR}"

# 检查目录存在
if [ ! -d "${AGENT_ANDROID_DIR}" ]; then
  echo "[smoke] ERROR: ${AGENT_ANDROID_DIR} 不存在"
  exit 1
fi

cd "${AGENT_ANDROID_DIR}"

# 检查 gradlew 存在
if [ ! -f "./gradlew" ] && [ ! -f "./gradlew.bat" ]; then
  echo "[smoke] ERROR: gradlew 不存在于 ${AGENT_ANDROID_DIR}"
  exit 1
fi

# 选择 gradlew 命令（Windows CI 用 gradlew.bat，Unix 用 ./gradlew）
if [ -f "./gradlew.bat" ] && [[ "${OS:-}" == "Windows_NT" ]]; then
  GRADLEW="./gradlew.bat"
else
  GRADLEW="./gradlew"
  chmod +x "${GRADLEW}" 2>/dev/null || true
fi

echo "[smoke] 执行: ${GRADLEW} :app:testDebugUnitTest --tests '*ContentJudgmentClientWiringTest*'"

${GRADLEW} :app:testDebugUnitTest \
  --tests "*ContentJudgmentClientWiringTest*" \
  --no-daemon \
  --stacktrace

EXIT_CODE=$?

if [ ${EXIT_CODE} -eq 0 ]; then
  echo "[smoke] PASS: ContentJudgmentClientWiringTest 全部通过"
else
  echo "[smoke] FAIL: ContentJudgmentClientWiringTest 存在失败用例，exit code=${EXIT_CODE}"
  exit ${EXIT_CODE}
fi
