#!/usr/bin/env bash
# restore-ime-scope-smoke.sh — restore_ime 作用域 bug 的永久 regression 守卫
#
# BUG（0916 定位，生产实测 0915 多次误伤单据）:
#   douyin-phone-adb 的私信发送段把原输入法存进**函数内 local 变量** original_ime,
#   同时 `trap restore_ime EXIT INT TERM`。zsh 中函数内设的 EXIT trap 在**函数返回时**触发,
#   那一刻 local 变量已销毁,叠加 `set -u` 直接抛 `original_ime: parameter not set`。
#   正常路径侥幸无恙(先手动 restore_ime 再 trap - EXIT);**异常路径必踩**。
#   危害双重: ①输入法没真正恢复(下一单继续踩) ②**次生错误覆盖真正的首因**——
#   比如真凶是"文字回读不匹配",日志里却只剩 parameter not set,排查方向被带偏。
#
# 守卫两层: 层A=行为复现(zsh 真跑,证明修法有效) 层B=源码契约(禁止 local 化回退)
set -euo pipefail
D="services/phone-adb-controller"
C="$D/douyin-phone-adb"
fail() { echo "::error::restore-ime-scope-smoke: $1"; exit 1; }

# ── 层A: 行为复现(zsh 可用才跑) ──
if command -v zsh >/dev/null 2>&1; then
  OUT=$(zsh -c '
    set -uo pipefail
    fixed() {
      _ORIG_IME="com.test/.TestIME"
      restore_ime() { [[ -n "${_ORIG_IME:-}" ]] && print "RESTORED:$_ORIG_IME" || print "SKIPPED" }
      trap restore_ime EXIT INT TERM
      return 1   # 模拟中途 die
    }
    fixed || true
  ' 2>&1) || true
  case "$OUT" in
    *"parameter not set"*) fail "修法失效: 异常路径仍抛 parameter not set(local 作用域 bug 复发)" ;;
    *RESTORED:com.test/.TestIME*) : ;;
    *) fail "行为复现异常,期望 RESTORED:... 实得: $OUT" ;;
  esac
  # 边界: 变量从未设置,必须静默跳过而不是报错
  OUT2=$(zsh -c '
    set -uo pipefail
    never() {
      r() { [[ -n "${_NEVER_SET_IME:-}" ]] && print "RESTORED" || print "SKIPPED" }
      trap r EXIT INT TERM
      return 1
    }
    never || true
  ' 2>&1) || true
  case "$OUT2" in
    *"parameter not set"*) fail "边界失效: 变量未设置时仍报错(缺 \${:-} 防御)" ;;
    *SKIPPED*) : ;;
    *) fail "边界复现异常,期望 SKIPPED 实得: $OUT2" ;;
  esac
else
  echo "::warning::zsh 不可用,层A行为复现跳过(部署侧会跑)"
fi

# ── 层B: 源码契约(禁止回退成 local) ──
[[ -s "$C" ]] || fail "douyin-phone-adb 缺失"
# B1: 原输入法变量禁止出现在 local 声明里(local+EXIT trap = 本 bug 的成因)
if grep -E '^\s*local\b.*\boriginal_ime\b' "$C" >/dev/null 2>&1; then
  fail "original_ime 又被 local 化(EXIT trap 触发时必然 parameter not set,0916 bug 复发)"
fi
# B2: restore_ime 必须带 \${:-} 防御(变量缺失时静默跳过,绝不制造次生错误)
RL=$(grep -n 'restore_ime()' "$C" | head -1 | cut -d: -f1 || true)
[[ -n "$RL" ]] || fail "找不到 restore_ime 定义"
BODY=$(sed -n "${RL}p" "$C")
case "$BODY" in
  *':-'*) : ;;
  *) fail "restore_ime 未带 \${var:-} 防御(变量缺失会抛次生错误掩盖真凶)" ;;
esac

echo "restore-ime-scope-smoke: PASS"
