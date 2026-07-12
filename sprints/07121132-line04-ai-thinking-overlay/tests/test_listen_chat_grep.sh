#!/usr/bin/env bash
# listen_chat 明文日志清零 grep 型回归测试
# 对应：FR-10 / [BEHAVIOR-INV-2] PII 双硬闸
# CI 中直接执行此脚本，退出码 0 = 通过

set -euo pipefail

LISTEN_CHAT_FILE="${1:-services/listen_chat.py}"

if [ ! -f "$LISTEN_CHAT_FILE" ]; then
  echo "SKIP: $LISTEN_CHAT_FILE not found (not yet implemented)"
  exit 77  # exit 77 = skip 语义，非 pass；CI 须用 continue-on-error 或检查退出码 77
fi

echo "=== Checking $LISTEN_CHAT_FILE for plaintext content logging ==="

# 检查是否存在明文 content 日志（原始 PRD 指定的 3 处：4687/4691/4696 行）
# 过滤掉注释行和测试文件
FOUND=$(grep -n "log.*content\|print.*content\|logger.*content" "$LISTEN_CHAT_FILE" \
  | grep -v "^#" \
  | grep -v "redact\|sanitize\|filter\|mask\|pii\|\[已过滤\]\|REDACTED" \
  | wc -l || true)

if [ "$FOUND" -gt 0 ]; then
  echo "FAIL: Found $FOUND plaintext content log(s) in $LISTEN_CHAT_FILE:"
  grep -n "log.*content\|print.*content\|logger.*content" "$LISTEN_CHAT_FILE" \
    | grep -v "redact\|sanitize\|filter\|mask\|pii\|\[已过滤\]\|REDACTED" || true
  exit 1
fi

echo "PASS: No plaintext content logging found in $LISTEN_CHAT_FILE"
exit 0
