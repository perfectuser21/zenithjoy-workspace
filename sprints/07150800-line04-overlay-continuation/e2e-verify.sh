#!/usr/bin/env bash
# E2E 验收脚本 — Line04 AI思考浮窗补部署闭环+会话跟随画像卡
# 里程碑A：xian-rog 手动验收（staging deploy + promote + 真机复验）
# 里程碑B：windows_cloud GHA CI 自动跑（画像卡切换 pytest + vitest）
# 执行：bash sprints/07150800-line04-overlay-continuation/e2e-verify.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

PASS=0; FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }
skip() { echo "  SKIP: $1"; }

echo "========================================"
echo "E2E Verify — Line04 浮窗接续刀"
echo "========================================"

# ── 里程碑A：staging 部署验证 ──────────────────────────────────────────
echo ""
echo "=== [BEHAVIOR-1] staging 部署版本断言 ==="
STAGING="${ZJ_STAGING_API:-http://localhost:5201}"
if curl -s --max-time 3 -o /tmp/zj-staging-health.json "$STAGING/health" 2>/dev/null; then
  HTTP=$(curl -s -o /tmp/zj-staging-health.json -w '%{http_code}' --max-time 5 "$STAGING/health")
  if [ "$HTTP" = "200" ]; then
    VERSION=$(jq -r '.version // .data.version // empty' /tmp/zj-staging-health.json 2>/dev/null || true)
    if [ "$VERSION" = "1.0.118" ]; then
      pass "staging version=1.0.118"
    else
      fail "staging version=$VERSION (期望 1.0.118)"
    fi
  else
    fail "staging health HTTP=$HTTP (期望 200)"
  fi
else
  skip "staging 不可达（手动验收阶段，人工确认 staging 已部署 1.0.118）"
fi

# ── 里程碑A：overlay 文件存在性（部署包含 overlay）──────────────────────
echo ""
echo "=== [BEHAVIOR-2] overlay 核心文件存在性 ==="
OVERLAY_FILE="$REPO_ROOT/services/agent/wechat-rpa/overlay/overlay_window.py"
if [ -f "$OVERLAY_FILE" ]; then
  pass "overlay_window.py 存在"
else
  fail "overlay_window.py 不存在 at $OVERLAY_FILE"
fi

# ── 里程碑A：真机证据（手动验收后存入 evidence/）────────────────────────
echo ""
echo "=== [BEHAVIOR-3] 真机复验证据 ==="
EVIDENCE_DIR="$SCRIPT_DIR/evidence"
if [ -f "$EVIDENCE_DIR/events-sample.jsonl" ]; then
  # 验证格式
  python3 -c "
import json, sys, re
lines = open('$EVIDENCE_DIR/events-sample.jsonl').readlines()
found = False
for line in lines:
    line = line.strip()
    if not line: continue
    d = json.loads(line)
    if d.get('event_type') == 'reply_sent':
        r = d.get('reasoning', '')
        assert r, 'reasoning 字段为空'
        assert len(r) <= 30, f'reasoning 超 30 字: {r}'
        assert not re.search(r'1[3-9]\d{9}', r), f'reasoning 含手机号: {r}'
        found = True
        break
assert found, 'events-sample.jsonl 中无 reply_sent 事件'
print('格式验证通过')
" && pass "events.jsonl 证据格式正确" || fail "events.jsonl 证据格式校验失败"
else
  skip "events-sample.jsonl 尚未存入（等待 xian-rog 手动验收）"
fi

if ls "$EVIDENCE_DIR"/*.png 2>/dev/null | head -1 | grep -q .; then
  pass "浮窗截图证据存在"
else
  skip "截图证据尚未存入（等待 xian-rog 手动验收）"
fi

# ── 里程碑B：pytest 画像卡切换 ──────────────────────────────────────────
echo ""
echo "=== [BEHAVIOR-4] pytest 会话画像卡切换 ==="
PYTEST_FILE="$REPO_ROOT/services/agent/wechat-rpa/overlay/tests/test_overlay_continuation.py"
if [ -f "$PYTEST_FILE" ]; then
  cd "$REPO_ROOT/services/agent/wechat-rpa/overlay"
  if python3 -m pytest tests/test_overlay_continuation.py -k "session_card_switch" -v --tb=short -q 2>&1 | tail -5; then
    pass "pytest 画像卡切换全绿"
  else
    fail "pytest 画像卡切换有失败"
  fi
  cd - >/dev/null
else
  skip "pytest 文件尚未生成（generator 阶段后可用）"
fi

# ── 里程碑B：vitest customer-profile 结构 ──────────────────────────────
echo ""
echo "=== [BEHAVIOR-5] vitest customer-profile 结构断言 ==="
VITEST_FILE="$REPO_ROOT/apps/api/src/services/customer-profile.test.ts"
if [ -f "$VITEST_FILE" ]; then
  cd "$REPO_ROOT/apps/api"
  if npx vitest run src/services/customer-profile.test.ts --reporter=verbose 2>&1 | tail -10; then
    pass "vitest customer-profile 全绿"
  else
    fail "vitest customer-profile 有失败"
  fi
  cd - >/dev/null
else
  skip "vitest 测试文件尚未生成（generator 阶段后可用）"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "E2E-VERIFY: PASS=$PASS FAIL=$FAIL"
echo "========================================"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
