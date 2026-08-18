#!/usr/bin/env bash
# lint-shell-var-brace.test.sh
#
# 禁止 shell 脚本里出现 `$VAR` 后**紧跟非 ASCII 字符**（如中文全角括号/引号）而不用 ${VAR} 包裹。
#
# 为什么是硬闸（2026-08-18 真机踩爆）：
#   ok "设备在线: $DEV（后续所有 adb 调用绑定 -s）"
# 这行在 Windows git bash 上跑了两天都没事，换到 macOS 的 bash 上直接
#   line 118: DEV<乱码>: unbound variable
# 因为 bash 解析变量名时会把紧跟的多字节字符字节并进标识符，不同 shell/平台
# 的宽容度不一样。CI 只跑 `--source-only`（不执行主流程）也发现不了——
# 这类 bug 会一直潜伏到换台机器跑才炸。
#
# 修法一律是加花括号：$DEV（...） -> ${DEV}（...）
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
          else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi }

scan() {  # scan <file...> -> 打印命中行，返回命中数
python3 - "$@" <<'PY'
import re, sys
pat = re.compile(r'\$[A-Za-z_][A-Za-z0-9_]*(?![A-Za-z0-9_}])[^\x00-\x7F]')
hits = 0
for f in sys.argv[1:]:
    try: lines = open(f, encoding='utf-8').read().split('\n')
    except (FileNotFoundError, UnicodeDecodeError): continue
    for i, l in enumerate(lines, 1):
        if l.strip().startswith('#'):   # 注释里无所谓
            continue
        if pat.search(l):
            hits += 1
            print(f"    {f}:{i}  {l.strip()[:90]}")
print(f"HITS={hits}")
PY
}

echo "== 自测：扫描逻辑本身必须能抓到（防止守卫变成摆设）=="
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
cat > "$TMPD/bad.sh" <<'BAD'
#!/usr/bin/env bash
echo "设备在线: $DEV（后续）"
BAD
cat > "$TMPD/good.sh" <<'GOOD'
#!/usr/bin/env bash
echo "设备在线: ${DEV}（后续）"
# 注释里写 $DEV（这样）不算问题
GOOD
BAD_HITS=$(scan "$TMPD/bad.sh" | grep '^HITS=' | cut -d= -f2)
GOOD_HITS=$(scan "$TMPD/good.sh" | grep '^HITS=' | cut -d= -f2)
check "坏样例能被抓到" "1" "$BAD_HITS"
check "好样例(含\${}与注释)不误报" "0" "$GOOD_HITS"

# 分两层：跨环境跑的真机 smoke 零容忍；其余历史脚本走棘轮（只许降不许升）。
# 理由：这类写法在 repo 里有 76 处历史存量，且在各自固定环境跑了很久没炸；
# 全量重写属无谓 churn。但 line02 真机 smoke 要在 rog(git bash) 与
# mac/pc4 之间来回跑，必须零命中——2026-08-18 就是它在 mac 上炸了才发现这个坑。
STRICT_FILES="$ROOT/.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh
$ROOT/.github/workflows/scripts/smoke/dm-send-realmachine-smoke.sh
$ROOT/.github/workflows/scripts/smoke/line02-keyword-comment-smoke.sh
$ROOT/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "== 严格组：跨环境真机 smoke 必须零命中 =="
# shellcheck disable=SC2086
SOUT=$(scan $STRICT_FILES)
echo "$SOUT" | grep -v '^HITS=' | sed '/^$/d'
SHITS=$(echo "$SOUT" | grep '^HITS=' | cut -d= -f2)
check "严格组零命中" "0" "$SHITS"

echo "== 棘轮组：其余 smoke 存量只许降不许升 =="
BASELINE=76   # 2026-08-18 实测基线；修好一处就把这个数字调小，绝不许调大
ALL=$(ls "$ROOT"/.github/workflows/scripts/smoke/*.sh "$ROOT"/.github/workflows/scripts/smoke/lib/*.sh 2>/dev/null)
OTHER=""
for f in $ALL; do
  case "$STRICT_FILES" in *"$f"*) continue ;; esac
  OTHER="$OTHER $f"
done
# shellcheck disable=SC2086
OHITS=$(scan $OTHER | grep '^HITS=' | cut -d= -f2)
echo "    棘轮组当前=$OHITS 基线=$BASELINE"
if [ "${OHITS:-0}" -le "$BASELINE" ]; then
  check "棘轮组未增加" "ok" "ok"
else
  check "棘轮组未增加" "ok" "增加到 $OHITS（基线 $BASELINE）——新代码不许再用裸 \$VAR 接非 ASCII"
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
