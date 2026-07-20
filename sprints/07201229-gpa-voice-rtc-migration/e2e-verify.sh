#!/usr/bin/env bash
# e2e-verify.sh — GP-A RTC 迁移 E2E 验证（真机 windows_wechat 段）
#
# CI 不可达段：需真机 xian-rog 执行
# 本脚本提供等价 CI 断言（TODO(real-machine) 标注）

set -euo pipefail

echo "=== GP-A RTC Migration E2E Verify ==="

# TODO(real-machine): 以下步骤需 xian-rog 真机执行
echo "TODO(real-machine): sidecar 启动 + audio_bridge.py 握手通过"
echo "TODO(real-machine): StartVoiceChat → room_id + token ≤5s"
echo "TODO(real-machine): OnUserJoined 事件 ≤5s"
echo "TODO(real-machine): 真实语音通话 ≥2 轮对话"

# CI 等价断言
echo ""
echo "=== CI 等价断言 ==="
bash .github/workflows/scripts/smoke/gpa-voice-rtc-smoke.sh
