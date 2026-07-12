#!/usr/bin/env bash
# Smoke test: Line04 AI 思考浮窗（第一刀·动态流）
# Sprint: 07121132-line04-ai-thinking-overlay
# Task ID: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb
#
# CI 环境：windows_cloud (GitHub Actions windows-latest)
# 真机验收：xian-rog
#
# 退出码 0 = PASS，非 0 = FAIL

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SPRINT_DIR="$WORKSPACE_ROOT/sprints/07121132-line04-ai-thinking-overlay"
TESTS_DIR="$SPRINT_DIR/tests"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

log_pass() { echo "[PASS] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
log_fail() { echo "[FAIL] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
log_skip() { echo "[SKIP] $1"; SKIP_COUNT=$((SKIP_COUNT + 1)); }

echo "========================================"
echo "Line04 AI Overlay Smoke Test"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"

# ---- 1. INV-8: 源码中无硬编码 C:\Users\Public 路径 ----
echo ""
echo "--- [INV-8] 禁止 C:\\Users\\Public 路径 ---"
FOUND_PUBLIC=$(grep -rn --include="*.py" --include="*.ts" --include="*.js" \
  -i "C:\\\\Users\\\\Public\|C:/Users/Public\|users.public" \
  "$WORKSPACE_ROOT/apps/" "$WORKSPACE_ROOT/services/" 2>/dev/null | wc -l || echo "0")
if [ "$FOUND_PUBLIC" -eq 0 ]; then
  log_pass "No hardcoded C:\\Users\\Public path found"
else
  log_fail "Found $FOUND_PUBLIC hardcoded C:\\Users\\Public path(s)"
  grep -rn --include="*.py" --include="*.ts" --include="*.js" \
    -i "C:\\\\Users\\\\Public\|C:/Users/Public\|users.public" \
    "$WORKSPACE_ROOT/apps/" "$WORKSPACE_ROOT/services/" 2>/dev/null | head -10 || true
fi

# ---- 2. INV-5: 源码中浮窗展示层无禁用文案（错误/中断/!）----
echo ""
echo "--- [INV-5] 温和异常文案检查 ---"
# 只检查浮窗 UI 相关的前台文案（排除后端日志、测试文件、注释）
OVERLAY_UI_FILES=$(find "$WORKSPACE_ROOT" \
  -path "*/overlay*" \( -name "*.py" -o -name "*.js" -o -name "*.html" \) \
  -not -path "*/test*" -not -path "*/node_modules/*" 2>/dev/null | head -20 || true)

if [ -z "$OVERLAY_UI_FILES" ]; then
  log_skip "Overlay UI files not yet implemented"
else
  FOUND_BAD_TEXT=0
  for f in $OVERLAY_UI_FILES; do
    CNT=$(grep -n "\"错误\|'错误\|\"中断\|'中断\|[\"'].*!" "$f" 2>/dev/null \
      | grep -v "#\|//\|logger\|log\." | wc -l || echo "0")
    FOUND_BAD_TEXT=$((FOUND_BAD_TEXT + CNT))
  done
  if [ "$FOUND_BAD_TEXT" -eq 0 ]; then
    log_pass "No forbidden error text in overlay UI files"
  else
    log_fail "Found $FOUND_BAD_TEXT forbidden error text(s) in overlay UI"
  fi
fi

# ---- 3. listen_chat 明文日志清零 ----
echo ""
echo "--- [FR-10] listen_chat 明文日志清零 ---"
LISTEN_CHAT="$WORKSPACE_ROOT/services/listen_chat.py"
if [ ! -f "$LISTEN_CHAT" ]; then
  log_skip "listen_chat.py not found at $LISTEN_CHAT"
else
  bash "$TESTS_DIR/test_listen_chat_grep.sh" "$LISTEN_CHAT" && \
    log_pass "listen_chat plaintext log check" || \
    log_fail "listen_chat plaintext log check"
fi

# ---- 4. Python 测试套件（纯逻辑，不依赖 Windows）----
echo ""
echo "--- [Python 测试套件] ---"
if command -v python3 &>/dev/null || command -v python &>/dev/null; then
  PYTHON=$(command -v python3 || command -v python)

  # PII 过滤器
  echo "  Running: test_pii_filter.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_pii_filter.py" -q --tb=short 2>&1 && \
    log_pass "PII filter tests" || log_fail "PII filter tests"

  # events.jsonl 管道
  echo "  Running: test_events_jsonl.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_events_jsonl.py" -q --tb=short 2>&1 && \
    log_pass "events.jsonl pipeline tests" || log_fail "events.jsonl pipeline tests"

  # 熔断保护
  echo "  Running: test_circuit_breaker.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_circuit_breaker.py" -q --tb=short 2>&1 && \
    log_pass "Circuit breaker tests" || log_fail "Circuit breaker tests"

  # preflight 隔离
  echo "  Running: test_preflight.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_preflight.py" -q --tb=short 2>&1 && \
    log_pass "Preflight isolation tests" || log_fail "Preflight isolation tests"

  # 浮窗 UI 行为
  echo "  Running: test_overlay_ui.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_overlay_ui.py" -q --tb=short 2>&1 && \
    log_pass "Overlay UI behavior tests" || log_fail "Overlay UI behavior tests"

  # 浮窗生命周期
  echo "  Running: test_overlay_lifecycle.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_overlay_lifecycle.py" -q --tb=short 2>&1 && \
    log_pass "Overlay lifecycle tests" || log_fail "Overlay lifecycle tests"

  # 状态目录路由
  echo "  Running: test_state_dir_routing.py"
  "$PYTHON" -m pytest "$TESTS_DIR/test_state_dir_routing.py" -q --tb=short 2>&1 && \
    log_pass "State dir routing tests" || log_fail "State dir routing tests"
else
  log_skip "Python not available, skipping Python test suite"
fi

# ---- 5. vitest（若 Node.js 可用）----
echo ""
echo "--- [vitest] draft-generate 三路断言 ---"
VITEST_FILE="$TESTS_DIR/test_draft_generate.vitest.ts"
if command -v npx &>/dev/null && [ -f "$WORKSPACE_ROOT/package.json" ]; then
  cd "$WORKSPACE_ROOT"
  npx vitest run "$VITEST_FILE" --reporter=verbose 2>&1 && \
    log_pass "draft-generate vitest" || log_fail "draft-generate vitest"
elif [ -f "$WORKSPACE_ROOT/apps/dashboard/package.json" ]; then
  cd "$WORKSPACE_ROOT/apps/dashboard"
  npx vitest run "$VITEST_FILE" --reporter=verbose 2>&1 && \
    log_pass "draft-generate vitest" || log_fail "draft-generate vitest"
else
  log_skip "npx not available or no package.json, skipping vitest"
fi

# ---- 6. Windows-only 测试（CI 环境跳过）----
echo ""
echo "--- [Win32] NOACTIVATE 测试 ---"
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$(uname -s)" == MINGW* ]]; then
  PYTHON=$(command -v python3 || command -v python)
  "$PYTHON" -m pytest "$TESTS_DIR/test_noactivate_hwnd.py" -q --tb=short 2>&1 && \
    log_pass "NOACTIVATE hwnd tests (Windows)" || log_fail "NOACTIVATE hwnd tests (Windows)"
else
  log_skip "Win32 NOACTIVATE tests skipped on non-Windows (run on xian-rog for true validation)"
fi

# ---- 汇总 ----
echo ""
echo "========================================"
echo "Smoke Test Summary"
echo "  PASS:  $PASS_COUNT"
echo "  FAIL:  $FAIL_COUNT"
echo "  SKIP:  $SKIP_COUNT"
echo "========================================"

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "RESULT: FAIL ($FAIL_COUNT failure(s))"
  exit 1
else
  echo "RESULT: PASS"
  exit 0
fi
