#!/usr/bin/env bash
# smoke-selfcheck-smoke.sh — 守卫的守卫: 防止「假绿断言模式」混进任何 smoke 脚本
#
# 0916 实锤的假绿(本文件因此而生):
#   smoke 脚本头部普遍是 `set -euo pipefail`。在此环境下写
#       if echo "$BIG_VAR" | grep -q 'pattern'; then fail "..."; fi
#   当 BIG_VAR 很大且 pattern 出现在靠前位置时:
#       grep -q 命中即刻退出 → echo 还在写 → echo 收 SIGPIPE 退 141
#       → pipefail 把整条管道判成失败(141) → if 条件为假 → **fail 永不触发**
#   实测: 96718 字符变量,管道退出码 141,here-string 版退出码 0。
#   后果比没写守卫更糟——CI 长绿,人以为被守着,其实裸奔(0916 层12 三条禁止型断言全失效)。
#
# 死规矩: 对变量做 grep,一律用 here-string `grep -q PATTERN <<< "$VAR"`,禁止 `echo "$VAR" | grep`。
set -euo pipefail
DIR=".github/workflows/scripts/smoke"
DEBT=".github/workflows/scripts/smoke-falsegreen-debt.txt"
fail() { echo "::error::smoke-selfcheck: $1"; exit 1; }

[[ -d "$DIR" ]] || fail "smoke 目录不存在: $DIR"

# ── 层A: 行为证明(真跑一次,证明这个陷阱是真的,也证明本守卫的判据不是臆想) ──
PROOF=$(bash -c '
  set -euo pipefail
  BIG=$(head -c 200000 /dev/urandom | base64 | tr -d "\n")
  BIG="NEEDLE_AT_FRONT
$BIG"
  set +e
  echo "$BIG" | grep -q "NEEDLE_AT_FRONT"; PIPE_RC=$?
  grep -q "NEEDLE_AT_FRONT" <<< "$BIG"; HS_RC=$?
  echo "pipe=$PIPE_RC hs=$HS_RC"
') || true
case "$PROOF" in
  "pipe=141 hs=0") : ;;   # 陷阱如期复现
  "pipe=0 hs=0")   echo "::warning::smoke-selfcheck: 本机未复现 SIGPIPE(缓冲区差异),源码闸仍然生效" ;;
  *) fail "自检行为层异常: $PROOF" ;;
esac

# ── 层B: 源码闸(扫所有 smoke 脚本,禁止管道式变量 grep) ──
OFFENDERS=""
for f in "$DIR"/*.sh; do
  [[ -e "$f" ]] || continue
  b="$(basename "$f")"
  [[ "$b" == "smoke-selfcheck-smoke.sh" ]] && continue   # 本文件含反例说明,豁免
  # 棘轮: 存量债只警告不阻塞(清偿一个从 debt 文件删一行);清单外新增一律红
  if [[ -f "$DEBT" ]] && grep -qxF "$b" "$DEBT"; then
    grep -nE '^[^#]*echo "\$[A-Za-z_][A-Za-z_0-9]*" \| *grep' "$f" >/dev/null 2>&1 \
      && echo "::warning::smoke-selfcheck: 存量债 $b 仍含假绿模式(见 smoke-falsegreen-debt.txt)"
    continue
  fi
  # 只查「对 shell 变量做 grep」的管道写法;对文件/命令输出做 grep 不在此列
  if grep -nE '^[^#]*echo "\$[A-Za-z_][A-Za-z_0-9]*" \| *grep' "$f" >/dev/null 2>&1; then
    OFFENDERS="$OFFENDERS $b"
  fi
done
if [[ -n "$OFFENDERS" ]]; then
  echo "::error::smoke-selfcheck: 以下脚本用了假绿模式 echo \"\$VAR\" | grep —— 改为 grep PATTERN <<< \"\$VAR\""
  for b in $OFFENDERS; do echo "::error::  → $b"; done
  exit 1
fi

echo "smoke-selfcheck-smoke: PASS"
