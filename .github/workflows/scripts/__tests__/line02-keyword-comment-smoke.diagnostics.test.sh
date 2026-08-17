#!/usr/bin/env bash
# diagnostics.test.sh — 抓评论 smoke 的诊断必须可达（无需真机，CI linux runner 可跑）
#
# 防的退化：`set -e` 下写 `X=$(cmd)`，cmd 非 0 时会静默杀死整个脚本，把脚本自己
# 写好的错误输出与优雅 skip 分支全部跳过。
#
# 08-17 实测：line02-keyword-comment 在 Step 1 两秒内 exit 1、**零输出**；手动跑
# 那个 node 脚本才看到真因 {"ok":false,"error":"NO_HEADFUL_CHROME: 无
# ZJ_MAIN_DATA_DIR（请先绑定抖音小号）"}。脚本明明在 :73 写了 fail "...完整输出:
# $KW_OUT"、在 :80 写了 DOUYIN_SESSION_EXPIRED 的 skip 分支，但它们永远执行不到。
# 这是"诊断代码被自己的 set -e 打死"的典型，比没写诊断更糟——它让人以为诊断存在。
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/line02-keyword-comment-smoke.sh"

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}

echo "== A. 静态：set -e 下的命令替换不得裸奔 =="
# 两处都要：:70 的 KW_OUT（关键词搜索）与 :110 的 CM_OUT（评论抓取）同病。
check "KW_OUT 赋值带 || true" "yes" \
  "$(grep -qE 'KW_OUT=\$\(.*\)[[:space:]]*\|\|[[:space:]]*true' "$SCRIPT" && echo yes || echo no)"
check "CM_OUT 赋值带 || true" "yes" \
  "$(grep -qE 'CM_OUT=\$\(.*\)[[:space:]]*\|\|[[:space:]]*true' "$SCRIPT" && echo yes || echo no)"

echo "== B. 行为：classify_node_failure 分级 =="
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

OUT_NOCHROME='[keyword-search-douyin] kw="装修" burner=null chrome=C:\Program Files\Google\Chrome\Application\chrome.exe
{"ok":false,"keyword":"装修","video_urls":[],"error":"NO_HEADFUL_CHROME: 无 ZJ_MAIN_DATA_DIR（请先绑定抖音小号）"}'
check "NO_HEADFUL_CHROME 判 fail 且带上原因" "fail:NO_HEADFUL_CHROME" \
  "$(classify_node_failure "$OUT_NOCHROME")"

OUT_EXPIRED='{"ok":false,"error":"DOUYIN_SESSION_EXPIRED"}'
check "DOUYIN_SESSION_EXPIRED 判 skip（已知环境限制）" "skip:DOUYIN_SESSION_EXPIRED" \
  "$(classify_node_failure "$OUT_EXPIRED")"

check "连 JSON 都没有也要给结论" "fail:NO_JSON" \
  "$(classify_node_failure 'node: command not found')"

OUT_NOERR='{"ok":false,"video_urls":[]}'
check "有 JSON 但无 error 字段" "fail:UNKNOWN" "$(classify_node_failure "$OUT_NOERR")"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
