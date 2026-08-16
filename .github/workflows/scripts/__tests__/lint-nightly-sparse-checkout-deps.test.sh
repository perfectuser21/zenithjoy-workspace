#!/usr/bin/env bash
# lint-nightly-sparse-checkout-deps.test.sh — 守卫行为测试（proven-to-fire）
#
# 3 case（run_case 风格同 lint-smoke-mock-honesty.test.sh）：
#   A: fixture workflow 只 sparse `services/agent/tools`，fixture 脚本依赖 ../wechat-rpa → 期望 lint 红
#   B: fixture 列表补上 `services/agent/wechat-rpa` → 期望 lint 绿
#   D: 变异——依赖改单引号仍红   E: |- 块标量仍能解析(补齐后绿)   F: pathlib 写法守卫自报失明(红)
#   C: 真实仓库 workflow + 真实 selfcheck_bubbles.py → 期望绿（commit-1 阶段这条会红——就是 TDD Red）
#
# 用法: bash lint-nightly-sparse-checkout-deps.test.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
LINT="$REPO_ROOT/.github/workflows/scripts/lint-nightly-sparse-checkout-deps.sh"

PASSED=0; FAILED=0

# run_case <名字> <expect_fail 0|1> <sparse 列表内容(多行, 每行一个目录)> [引号风格 dq|sq] [块标量指示符, 默认 |]
run_case() {
  local name="$1" expect_fail="$2" sparse_dirs="$3" quote="${4:-dq}" scalar="${5:-|}"
  local TMPDIR; TMPDIR=$(mktemp -d)
  mkdir -p "$TMPDIR/.github/workflows" "$TMPDIR/services/agent/tools"
  # fixture 脚本：与真实 selfcheck_bubbles.py 相同形态的 sys.path 注入（dq=双引号，sq=单引号）
  if [ "$quote" = "sq" ]; then
    cat > "$TMPDIR/services/agent/tools/selfcheck_bubbles.py" <<'PY'
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT_RPA = os.path.abspath(os.path.join(_HERE, '..', 'wechat-rpa'))
if _WECHAT_RPA not in sys.path:
    sys.path.insert(0, _WECHAT_RPA)
PY
  elif [ "$quote" = "pathlib" ]; then
    # 守卫解析不到的写法（pathlib）：脚本在改 sys.path 但没有 os.path.join(_HERE, ...) → 守卫必须自报失明
    cat > "$TMPDIR/services/agent/tools/selfcheck_bubbles.py" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "wechat-rpa"))
PY
  else
    cat > "$TMPDIR/services/agent/tools/selfcheck_bubbles.py" <<'PY'
import os, sys
_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT_RPA = os.path.abspath(os.path.join(_HERE, "..", "wechat-rpa"))
if _WECHAT_RPA not in sys.path:
    sys.path.insert(0, _WECHAT_RPA)
PY
  fi
  # fixture workflow：只保留 wechat-bubble job 骨架 + sparse 块
  {
    echo "name: fixture"
    echo "on: workflow_dispatch"
    echo "jobs:"
    echo "  wechat-bubble:"
    echo "    runs-on: [self-hosted, wechat-capable]"
    echo "    steps:"
    echo "      - uses: actions/checkout@v4"
    echo "        with:"
    echo "          sparse-checkout: ${scalar}"
    printf '%s\n' "$sparse_dirs" | sed 's/^/            /'
    echo "          sparse-checkout-cone-mode: false"
    echo "      - name: run"
    echo "        run: python selfcheck_bubbles.py"
  } > "$TMPDIR/.github/workflows/nightly-fixture.yml"

  set +e
  ( cd "$TMPDIR" && bash "$LINT" ".github/workflows/nightly-fixture.yml" "services/agent/tools/selfcheck_bubbles.py" ) > /tmp/lint-nscd-out.txt 2>&1
  local rc=$?
  set -e
  rm -rf "$TMPDIR"

  if [ "$expect_fail" = "1" ] && [ "$rc" -ne 0 ]; then
    echo "  PASS [$name] (期望报红，实得 exit=$rc)"; PASSED=$((PASSED+1))
  elif [ "$expect_fail" = "0" ] && [ "$rc" -eq 0 ]; then
    echo "  PASS [$name] (期望放行，实得 exit=$rc)"; PASSED=$((PASSED+1))
  else
    echo "  FAIL [$name] expect_fail=$expect_fail got_exit=$rc"; cat /tmp/lint-nscd-out.txt; FAILED=$((FAILED+1))
  fi
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  lint-nightly-sparse-checkout-deps.sh 测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$LINT" ]; then
  echo "❌ RED（预期）: $LINT 不存在 —— 尚未实现"
  exit 1
fi

# A: 只拉 tools，脚本依赖 ../wechat-rpa → 必须红（PR#1596 原始 bug 复现）
run_case "missing-wechat-rpa" 1 'services/agent/tools'

# B: 补上 wechat-rpa → 绿
run_case "has-wechat-rpa" 0 'services/agent/tools
services/agent/wechat-rpa'

# D: 变异——脚本依赖改用单引号，列表仍缺 wechat-rpa → 守卫必须仍然红（防"换个引号守卫就瞎"）
run_case "single-quote-still-fires" 1 'services/agent/tools' sq

# E: 块标量写成 |- 时列表仍被正确解析 → 补齐目录后应绿（防 |- 被当 inline 值造成假红/误导）
run_case "block-scalar-strip" 0 'services/agent/tools
services/agent/wechat-rpa' dq '|-'

# F: 脚本改成 pathlib 写法（守卫解析不到）且列表"看起来齐" → 守卫必须自报失明而不是放行
run_case "guard-blind-self-report" 1 'services/agent/tools
services/agent/wechat-rpa' pathlib

# C: 真实仓库文件 → 绿（修复合入前这条就是 TDD Red）
set +e
( cd "$REPO_ROOT" && bash "$LINT" ) > /tmp/lint-nscd-real.txt 2>&1
rc=$?
set -e
if [ "$rc" -eq 0 ]; then
  echo "  PASS [real-repo] (真实 workflow 覆盖了全部依赖目录)"; PASSED=$((PASSED+1))
else
  echo "  FAIL [real-repo] 真实 workflow 缺依赖目录 (exit=$rc)"; cat /tmp/lint-nscd-real.txt; FAILED=$((FAILED+1))
fi

echo ""; echo "lint-nightly-sparse-checkout-deps: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
