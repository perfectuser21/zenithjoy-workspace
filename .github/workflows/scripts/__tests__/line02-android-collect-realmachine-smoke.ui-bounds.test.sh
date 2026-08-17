#!/usr/bin/env bash
# ui-bounds.test.sh — uiautomator bounds 解析变异测试（无需真机，CI linux runner 可跑）
#
# 防的退化：回到"截图估坐标"或"取第一个节点"。同一页面常有多个按钮/开关，取错就点错
# 东西——08-17 给小白点「停用 adb 授权超时功能」开关时，目标上方就有一个 checked=true
# 的无线调试开关，靠肉眼估坐标必点错；改用 uiautomator bounds 才点对。
#
# 这段解析服务于 MediaProjection 自动授权（承接 PR #1312）：判定链要逐视频截图，
# 而该授权在 app 进程重启后必然丢失（08-17 实测第四台与小黄的 dumpsys
# media_projection 都是 null），此前只能靠人点弹窗。
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../smoke" && pwd)/line02-android-collect-realmachine-smoke.sh"
# shellcheck source=/dev/null
source "$SCRIPT" --source-only

PASS=0; FAIL=0
check() { # check DESC EXPECT ACTUAL
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✅ $1";
  else FAIL=$((FAIL+1)); echo "  ❌ $1 (期望=$2 实际=$3)"; fi
}

echo "== parse_ui_bounds =="

XML_ONE='<node text="授权截屏" bounds="[100,200][300,400]" />'
check "正常命中→bounds 中心坐标" "200 300" "$(parse_ui_bounds "$XML_ONE" '授权截屏')"

# 目标文案不在第一个节点：必须命中目标，不能取第一个（这条是本测试的区分能力所在，
# 少了它，"永远取第一个节点"的退化实现也会通过）
XML_MULTI='<node text="其它按钮" bounds="[0,0][50,50]" /><node text="授权截屏" bounds="[100,200][300,400]" />'
check "多节点时命中目标而非第一个" "200 300" "$(parse_ui_bounds "$XML_MULTI" '授权截屏')"

check "无匹配文案返回空" "" "$(parse_ui_bounds "$XML_ONE" '立即开始')"

XML_ALLOW='<node text="立即开始" bounds="[600,1800][900,1900]" />'
check "系统弹框文案也能解析" "750 1850" "$(parse_ui_bounds "$XML_ALLOW" '立即开始')"

# 节点有文案但缺 bounds 属性 → 不能崩、也不能吐半个坐标
XML_NOBOUNDS='<node text="授权截屏" clickable="true" />'
check "缺 bounds 属性返回空不崩" "" "$(parse_ui_bounds "$XML_NOBOUNDS" '授权截屏')"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
