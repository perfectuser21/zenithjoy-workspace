#!/usr/bin/env bash
# phone-adb-controller-smoke.sh — ADB 控制器八件套守卫(0914 融合刀 F1 回流)
# 三层: 1) 语法闸(zsh 可用才跑,CI ubuntu 无 zsh 降级 warning) 2) 融合刀函数存在性 3) 烂死模式检测
set -euo pipefail
D="services/phone-adb-controller"
C="$D/douyin-phone-adb"
fail() { echo "::error::phone-adb-controller-smoke: $1"; exit 1; }

# 层0: 八件套存在
for f in douyin-phone-adb harvest-keyword.sh refill-profile-links.sh push-leads.js update-profile-links.js next-outreach.js next-outreach-lib.js outreach-tick.sh; do
  [[ -s "$D/$f" ]] || fail "$f 缺失或为空"
done

# 层1: 语法闸
if command -v zsh >/dev/null 2>&1; then
  zsh -n "$C" || fail "控制器 zsh 语法错误"
  zsh -n "$D/harvest-keyword.sh" || fail "harvest zsh 语法错误"
  zsh -n "$D/refill-profile-links.sh" || fail "refill zsh 语法错误"
  zsh -n "$D/outreach-tick.sh" || fail "outreach-tick zsh 语法错误"
else
  echo "::warning::zsh 不可用,语法闸跳过(部署侧会跑)"
fi
node --check "$D/push-leads.js" || fail "push-leads.js 语法错误"
node --check "$D/update-profile-links.js" || fail "update-profile-links.js 语法错误"
node --check "$D/next-outreach.js" || fail "next-outreach.js 语法错误"
node --check "$D/next-outreach-lib.js" || fail "next-outreach-lib.js 语法错误"

# 层2: 融合刀函数/命令存在性(六刀签名)
for pat in 'clip_guard_check' 'clip_guard_record' 'foreground_gate' 'FG_DISMISS_LABELS' 'lock-refresh)' 'failure_class=' 'ensure_feed' 'locate_cached utab' 'profile url shape not allowed' 'link route:' '"$#" == 5 || "$#" == 6' 'AppLinkHandler' '打开抖音看更多内容' ; do
  grep -qF "$pat" "$C" || fail "融合刀签名缺失: $pat"
done
# harvest 必须接了心跳与作品地址
grep -qF 'lock-refresh' "$D/harvest-keyword.sh" || fail "harvest 未接 lock-refresh 心跳"
grep -qF 'current-video-link' "$D/harvest-keyword.sh" || fail "harvest 未接原爆款作品地址"
# push-leads 必须吃 11/12 列
grep -qF 'purl' "$D/push-leads.js" || fail "push-leads 未接主页直链列"

# 层3: 烂死模式检测(0914 实证的静默腐烂形态,proven-to-fire)
# 3a: 变量被提前展开成空串的尸块('"" -s ""' 形态)
if grep -qF '"" -s ""' "$C"; then fail '检测到变量展开尸块("" -s ""),某次补丁把变量毁成空串'; fi
# 3b: 死函数复活(ui_evidence_retry 已删,再出现=有人从旧版本抄回来了)
if grep -qE '^ui_evidence_retry\(\)' "$C"; then fail "死函数 ui_evidence_retry 复活(0914 已删除,禁止回抄)"; fi
# 3c: card-link 禁止短链→长链转换复活(决策 f88a5b86 主理人拍板: 剪贴板原文短链直存直开,
# curl 抠 sec_uid 转 www.douyin.com/user 长链会丢"App可直开"属性——0915 真机实证长链 intent 不可解析)
if sed -n '/commenter-card-link)/,/^  [a-z-]*)$/p' "$C" | grep -q '/usr/bin/curl'; then fail "card-link 段出现 curl 转换命令(决策 f88a5b86: 存原文短链,禁止转长链)"; fi

# 层4: outreach-tick 归因分类功能断言(source 守卫模式,决策 c5828297)
if command -v zsh >/dev/null 2>&1; then
  CF() { zsh -c "OUTREACH_TICK_SOURCED=1 source '$D/outreach-tick.sh'; classify_failure \"\$1\"" _ "$1"; }
  [[ "$(CF 'blah
failure_class=TARGET_ABSENT')" == "terminal" ]] || fail "classify: TARGET_ABSENT 应 terminal"
  [[ "$(CF 'Unknown input method com.android.adbkeyboard/.AdbIME cannot be enabled for user #0')" == "transient" ]] || fail "classify: AdbIME 应 transient"
  [[ "$(CF 'restore_ime: original_ime: parameter not set')" == "transient" ]] || fail "classify: restore_ime 应 transient"
  [[ "$(CF 'warning: foreground gate: douyin not foreground (round 1)
no card matched
failure_class=TARGET_ABSENT')" == "terminal" ]] || fail "classify: warning:foreground 不得污染 TARGET_ABSENT 判终止"
  [[ "$(CF 'some other die message')" == "other" ]] || fail "classify: 未知失败应 other"
else
  echo "::warning::zsh 不可用,层4 归因断言跳过(部署侧会跑)"
fi
grep -qF 'requeue_transient' "$D/outreach-tick.sh" || fail "tick 未接 requeue_transient"
# 层6: 夜批run伴随Commander(决策dcdaa83e: 起跑拉起escort,收工注销,辅佐姿态)
grep -qF 'escort-' "$D/harvest-cron.sh" || fail "harvest 未拉起伴随escort"
grep -qF 'cron rm' "$D/harvest-cron.sh" || fail "harvest 未注销escort(泄漏cron)"
[[ -s "$D/cmdr-escort.txt" ]] || fail "escort SOP文件缺失"
grep -qF '帮不拦' "$D/cmdr-escort.txt" || fail "escort SOP缺辅佐三原则"

# 层5: 落表独立字段(主理人0915逐列验收拍板: 昵称/抖音号/主页链接/IP/留言时间独立成列)
grep -qF '"留言时间"' "$D/push-raw-comments.js" || fail "push-raw-comments 未写留言时间列"
grep -qF '"主页IP"' "$D/push-raw-comments.js" || fail "push-raw-comments 未写主页IP列"
grep -qF '"IP属地"' "$D/sort-comments.js" || fail "sort-comments 搬运未写IP属地列"
grep -qF '"昵称"' "$D/sort-comments.js" || fail "sort-comments 搬运未写纯昵称列"
if grep -qF 'seen.add' "$D/sort-comments.js"; then fail "sort-comments seen.add复活(Map无add方法,每轮搬运第一条后必崩)"; fi
grep -qF 'outreach-tick.lock' "$D/outreach-tick.sh" || fail "tick 未接 mkdir 互斥锁"
grep -qF 'profile_url' "$D/next-outreach.js" || fail "选单器未出 profile_url"


# 层5: escort 跨轮记忆契约(决策 c2901aff, 0915 主理人拍板修老Commander失忆病)
# 5a: harvest-cron.sh 必须在管(存在+zsh语法)
[[ -s "$D/harvest-cron.sh" ]] || fail "harvest-cron.sh 缺失或为空"
if command -v zsh >/dev/null 2>&1; then
  zsh -n "$D/harvest-cron.sh" || fail "harvest-cron.sh zsh 语法错误"
fi
# 5b: escort 拉起必须用 custom session(session:escort-$TAG=同夜tick共享上下文),禁回退 isolated 失忆形态
grep -qF -- "--session 'session:escort-" "$D/harvest-cron.sh" || fail "escort 拉起未用 session:escort-\$TAG 跨轮记忆会话(失忆形态回归)"
if grep -F -- "--session isolated" "$D/harvest-cron.sh" | grep -qF "escort-"; then fail "escort 拉起回退成 --session isolated(失忆形态复活)"; fi
# 5c: SOP 必须带 FINDINGS 夜际记忆条款(读历史判例+追加新判例)
grep -qF "escort-findings.md" "$D/cmdr-escort.txt" || fail "cmdr-escort.txt 缺 escort-findings.md 夜际记忆条款"

echo "phone-adb-controller-smoke: PASS"
