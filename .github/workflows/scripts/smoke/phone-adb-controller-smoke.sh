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
# 5b: escort 拉起必须用 custom session 且带机器名(0915首夜实证: M4/M1同分钟起跑TAG撞名,
#     session 不带 HOSTKEY=两机escort共享会话互相污染,name 不带=SOP自杀条款按名找id误杀对方)
grep -qF -- "--session 'session:escort-\$HOSTKEY-\$TAG'" "$D/harvest-cron.sh" || fail "escort 会话未带 HOSTKEY(session:escort-\$HOSTKEY-\$TAG),同分钟跨机撞名串线"
grep -qF -- "--name 'escort-\$HOSTKEY-\$TAG'" "$D/harvest-cron.sh" || fail "escort cron名未带 HOSTKEY(escort-\$HOSTKEY-\$TAG),自杀条款按名找id会误杀对方"
if grep -F -- "--session isolated" "$D/harvest-cron.sh" | grep -qF "escort-"; then fail "escort 拉起回退成 --session isolated(失忆形态复活)"; fi
if grep -F -- "--session isolated" "$D/harvest-cron.sh" | grep -qF "escort-"; then fail "escort 拉起回退成 --session isolated(失忆形态复活)"; fi
# 5c: SOP 必须带 FINDINGS 夜际记忆条款(读历史判例+追加新判例)
grep -qF "escort-findings.md" "$D/cmdr-escort.txt" || fail "cmdr-escort.txt 缺 escort-findings.md 夜际记忆条款"

# 层6: Commander三层值守件在管(0916主理人拍板"值守者须有头级全能力",COMMANDER.md=身份宪法SSOT)
for f in COMMANDER.md cmdr-stream.txt log-stream-push.sh escort-claude-escalation.sh disk-gateway-guard.sh com.zenithjoy.logstreampush.plist; do
  [[ -s "$D/$f" ]] || fail "Commander件缺失或为空: $f"
done
if command -v zsh >/dev/null 2>&1; then
  zsh -n "$D/log-stream-push.sh" || fail "log-stream-push.sh zsh 语法错误"
  zsh -n "$D/escort-claude-escalation.sh" || fail "escort-claude-escalation.sh zsh 语法错误"
fi
bash -n "$D/disk-gateway-guard.sh" || fail "disk-gateway-guard.sh bash 语法错误"
# 6a: 宪法五条必须在 COMMANDER.md 里(改宪法改这里,禁止只改投影)
for pat in '帮不拦' '无杀权' '读不到就说读不到' '不改代码' '危险动作绝不做'; do
  grep -qF "$pat" "$D/COMMANDER.md" || fail "COMMANDER.md 宪法缺条款: $pat"
done
# 6b: 分身唤起词必须内嵌宪法(headless无人监督,宪法不在prompt里=没有约束)
for pat in '无杀权' '永远救活不弄死' '读不到就说读不到' '不修改任何代码' 'escalation-reports.log'; do
  grep -qF "$pat" "$D/escort-claude-escalation.sh" || fail "分身唤起词缺宪法约束: $pat"
done
# 6c: 推流必须打机器标签(0916实证:不打标签哨兵会把M4事件报成M1)
grep -qF 's/^/[$HOST] /' "$D/log-stream-push.sh" || fail "推流未给每行打[机器]标签(哨兵会认错机器)"
# 6d: 哨兵SOP必须带升级条款+机器识别铁律
grep -qF 'escalation.log' "$D/cmdr-stream.txt" || fail "cmdr-stream.txt 缺升级条款(三级响应断链)"
grep -qF 'escalation.log' "$D/cmdr-escort.txt" || fail "cmdr-escort.txt 缺升级条款(三级响应断链)"

# 层7: Commander第一步上岗+失败不静默(0916主理人指出;昨晚凌晨三批静默全灭6小时无告警的根治)
H="$D/harvest-cron.sh"
# 7a: escort 拉起必须排在 preflight(设备检查)与取词单之前——Commander是第一步,不是第三步
_ln_escort=$(grep -n 'openclaw cron add' "$H" | head -1 | cut -d: -f1)
_ln_pre=$(grep -n 'mWakefulness' "$H" | head -1 | cut -d: -f1)
_ln_kw=$(grep -n 'next-keywords.js' "$H" | head -1 | cut -d: -f1)
[[ -n "$_ln_escort" && -n "$_ln_pre" && -n "$_ln_kw" ]] || fail "harvest-cron.sh 关键锚点缺失(escort拉起/preflight/取词单)"
(( _ln_escort < _ln_pre )) || fail "escort拉起(${_ln_escort}行)排在设备preflight(${_ln_pre}行)之后——前置失败无人看护(0915凌晨三批静默全灭)"
(( _ln_escort < _ln_kw )) || fail "escort拉起(${_ln_escort}行)排在取词单(${_ln_kw}行)之后——取词单失败无人看护"
# 7b: 必须有 escalate 函数,且走 us-vps 宿主文件(容器死了也能写——昨晚容器死/宿主活)
grep -qE '^escalate\(\)' "$H" || fail "harvest-cron.sh 缺 escalate() 报警函数"
grep -qF 'escalation.log' "$H" || fail "escalate 未写 escalation.log(三级响应断链)"
if grep -A6 '^escalate()' "$H" | grep -q 'docker exec'; then fail "escalate 走了 docker exec(容器死时必失效),必须直写宿主文件"; fi
# 7c: 静默退出死绝——设备离线/词单为空必须先报警再退
# 注:必须先剔注释行再 grep——否则把 escalate 注释掉守卫照样绿(0916 变异测试实测到的假守卫)
_H_CODE=$(grep -vE '^[[:space:]]*#' "$H")
echo "$_H_CODE" | grep -A2 '设备离线' | grep -q 'escalate' || fail "设备离线仍是静默exit(无人知晓)"
echo "$_H_CODE" | grep -A3 '词单为空' | grep -q 'escalate' || fail "词单为空仍是静默exit(0915凌晨三批正是这样全灭)"
# 7d: 宪法必须给分身"救活已死容器"的权力(永远救活不弄死),且带取证前提
grep -qF '已确认死亡' "$D/COMMANDER.md" || fail "COMMANDER.md 未授权分身救活已死容器(网关死则workflow无人能救)"
grep -qF '已确认死亡' "$D/escort-claude-escalation.sh" || fail "分身唤起词未同步救活授权(宪法投影不同步)"

# 层8: 网关停摆单独识别 + 救活权代码化(0916分身首战实弹报告提案,熟化:判例→代码)
_H8=$(grep -vE '^[[:space:]]*#' "$D/harvest-cron.sh")
# 8a: 取词单失败必须区分"网关容器停摆"与"真词单为空"——0916凌晨两批真凶是前者却被误报成后者
echo "$_H8" | grep -q 'is not running' || fail "取词单失败未识别容器停摆(is not running),网关死会被误报成词单为空"
echo "$_H8" | grep -q '网关容器停摆' || fail "缺'网关容器停摆'专属升级分支(根因指向错=分身查错方向)"
# 8b: 救活权代码化——守卫检测到容器 exited 必须取证+自动重启+回读验证(能写死的判据不该留给LLM)
_G="$D/disk-gateway-guard.sh"
_G8=$(grep -vE '^[[:space:]]*#' "$_G")
echo "$_G8" | grep -q 'docker start\|docker restart' || fail "守卫无救活动作(网关死6h无人救的0916事故未根治)"
echo "$_G8" | grep -q 'docker inspect' || fail "守卫救活前未取证(宪法救活权三前提之一)"
echo "$_G8" | grep -qE 'exited' || fail "守卫未按 exited 状态判定确已死亡(可能误重启健康容器)"
grep -qF '回读验证' "$_G" || fail "守卫救活后未回读验证(宪法救活权三前提之一)"

echo "phone-adb-controller-smoke: PASS"
