#!/usr/bin/env bash
# phone-adb-controller-smoke.sh — ADB 控制器八件套守卫(0914 融合刀 F1 回流)
# 三层: 1) 语法闸(zsh 可用才跑,CI ubuntu 无 zsh 降级 warning) 2) 融合刀函数存在性 3) 烂死模式检测
set -euo pipefail
D="services/phone-adb-controller"
C="$D/douyin-phone-adb"
fail() { echo "::error::phone-adb-controller-smoke: $1"; exit 1; }
# 0916 死规矩: 对变量做 grep 一律用 here-string `grep ... <<< "$VAR"`。
# 禁止 `echo "$VAR" | grep`——本文件头部是 set -euo pipefail,大变量下 grep 命中即退、
# echo 收 SIGPIPE 退 141,pipefail 把整条管道判失败 → `if...then fail` 永不触发(实锤假绿)。

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
# 注: 'locate_cached utab' 于 0916 随搜索路线一并删除(见层12),故不再要求存在
for pat in 'clip_guard_check' 'clip_guard_record' 'foreground_gate' 'FG_DISMISS_LABELS' 'lock-refresh)' 'failure_class=' 'ensure_feed' 'profile url shape not allowed' 'link route:' '"$#" == 5 || "$#" == 6' 'AppLinkHandler' '打开抖音看更多内容' ; do
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
# 0919 字段收敛(主理人拍板): 纯昵称列改名"抖音昵称"，且抽到 lead-fields-lib.js 共享构造，
# 不再是 sort-comments.js 自己的字面量——检查点跟着挪到构造库+接入点两处。
grep -qF '"抖音昵称"' "$D/lead-fields-lib.js" || fail "lead-fields-lib 未写抖音昵称列"
grep -qF 'buildLeadCoreFields' "$D/sort-comments.js" || fail "sort-comments 搬运未接入字段构造库"
grep -qF 'buildLeadCoreFields' "$D/push-leads.js" || fail "push-leads 未接入字段构造库"
node --check "$D/lead-fields-lib.js" || fail "lead-fields-lib.js 语法错误"
if grep -qF 'seen.add' "$D/sort-comments.js"; then fail "sort-comments seen.add复活(Map无add方法,每轮搬运第一条后必崩)"; fi
grep -qF 'outreach-tick.lock' "$D/outreach-tick.sh" || fail "tick 未接 mkdir 互斥锁"
grep -qF 'profile_url' "$D/next-outreach.js" || fail "选单器未出 profile_url"
# 0919 真机验证实锤: harvest-keyword.sh 跑在手机机(xian-m4/xian-m1)不持有飞书凭据,
# fetch-seen-videos.js 需要凭据+联网,必须经 SSH 到网关机执行，
# 禁止在本机直接 node 调用(会因缺 clawdbot.json 静默拿到空表,去重形同虚设)。
# 0921 网关迁移(决策 96054a8b): us-vps 那份 openclaw-gateway 容器已退役,脚本随迁移落到
# MMV 原生跑(不再经 docker exec)——守卫改认新地址,同时禁止旧 docker exec 写法复活。
grep -qF 'ssh -o ConnectTimeout=15 mmv "node /Users/administrator/.openclaw/leadgen-scripts/fetch-seen-videos.js' "$D/harvest-keyword.sh" || fail "同视频去重未经SSH路由到网关(会在手机机因缺凭据静默失效)"
if grep -qF 'docker exec openclaw-gateway' "$D/harvest-keyword.sh"; then fail "fetch-seen-videos.js 调用复活了已退役的 us-vps docker exec 写法(决策 96054a8b)"; fi
if grep -E '^[^#]*\bnode "\$\(dirname "\$0"\)/fetch-seen-videos\.js"' "$D/harvest-keyword.sh" | grep -qv 'ssh'; then
  fail "fetch-seen-videos.js 被本机直接调用(手机机无飞书凭据,已实锤会静默失效)"
fi
# 0919 真机实证(截图+ui-evidence XML): 私信气泡渲染成功≠真送达,对方"仅互关可发消息"
# 限制生效时气泡照样能发出来但对方收不到——outreach-tick.sh 发送后必须二次核验限制提示，
# 命中时走 restricted 分支(成功触达=否),不能只信 send_status=sent。
grep -qF '暂无法给对方发送消息' "$D/outreach-tick.sh" || fail "outreach-tick 未接仅互关限制二次核验(0919真机实证会误判送达成功)"
grep -qF 'restricted' "$D/outreach-tick.sh" || fail "outreach-tick 未接 restricted 分支"
grep -qF 'restrictedFields' "$D/next-outreach.js" || fail "next-outreach done模式未接 restrictedFields"
grep -qF 'restrictedFields' "$D/next-outreach-lib.js" || fail "next-outreach-lib 缺 restrictedFields"
# 0920 阶梯测试安全网: 当日发送上限闸 + 连续未识别失败自动熔断，缺任一个都不能上线
# (往真实账号加压测阈值,没有熔断=有可能真把号测坏)。
[[ -s "$D/dm-rate-ramp-lib.js" ]] || fail "dm-rate-ramp-lib.js 缺失或为空"
[[ -s "$D/dm-daily-cap.js" ]] || fail "dm-daily-cap.js 缺失或为空"
[[ -s "$D/config/dm-rate-ramp.json" ]] || fail "dm-rate-ramp.json 配置缺失"
node --check "$D/dm-rate-ramp-lib.js" || fail "dm-rate-ramp-lib.js 语法错误"
node --check "$D/dm-daily-cap.js" || fail "dm-daily-cap.js 语法错误"
grep -qF 'dm-daily-cap.js' "$D/outreach-tick.sh" || fail "outreach-tick 未接当日发送上限闸"
grep -qF 'dm-paused-' "$D/outreach-tick.sh" || fail "outreach-tick 未接熔断标记读取"
grep -qF 'ANOMALY_COUNT >= 2' "$D/outreach-tick.sh" || fail "outreach-tick 未接连续未识别失败自动熔断"
# 0920 真机三轮实证(综合tab自动播放导致dump必挂→切视频tab发现tab顺序/卡片位置都不
# 固定→最终改视觉定位彻底绕开这两个假设): refill-profile-links.sh 必须用 locate-tap
# 视觉定位,禁止再出现"裸ui-evidence接tail -1当文件路径用"或"写死坐标点第一张卡"这两个
# 已经真机实测证明会 100% 失败的写法。
grep -qF 'locate-tap' "$D/refill-profile-links.sh" || fail "refill-profile-links 未接 locate-tap 视觉定位(0920真机实证: dump+固定坐标两版都失败)"
if grep -E '\bui-evidence\b.*\|\s*tail -1' "$D/refill-profile-links.sh" >/dev/null; then
  fail "refill-profile-links 出现裸ui-evidence接tail -1当路径用(已实锤此写法在综合tab下必挂)"
fi
if grep -qE '\btap [0-9]+ [0-9]+\b' "$D/refill-profile-links.sh"; then
  fail "refill-profile-links 出现写死坐标tap(已实锤用户tab位置/卡片位置都不固定,会点错人)"
fi
# 0920 实测发现: 每30分钟一次tick+每次最多发1条,理论上限才17条/号/天,天花板配到55/60
# 根本够不着——outreach-tick 必须能一次tick内连发多条(时间预算内循环取单),否则阶梯
# 测试的天花板毫无意义。
grep -qF 'TICK_BUDGET' "$D/outreach-tick.sh" || fail "outreach-tick 未接单tick内连发时间预算(0920实测:单tick单发理论上限仅17条/天,够不着阶梯天花板)"
grep -qF 'SENDS_THIS_TICK' "$D/outreach-tick.sh" || fail "outreach-tick 未接单tick多发计数"


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
grep -A2 '设备离线' <<< "$_H_CODE" | grep -q 'escalate' || fail "设备离线仍是静默exit(无人知晓)"
# 0916: 措辞从"词单为空"改为"取词单失败"(加了兜底词单分支),断言跟着改为匹配结构而非措辞
grep -A8 'KWERR' <<< "$_H_CODE" | grep -q 'escalate' || fail "取词单失败路径仍是静默exit(0915凌晨三批正是这样全灭)"
# 7d: 宪法必须给分身"救活已死容器"的权力(永远救活不弄死),且带取证前提
grep -qF '已确认死亡' "$D/COMMANDER.md" || fail "COMMANDER.md 未授权分身救活已死容器(网关死则workflow无人能救)"
grep -qF '已确认死亡' "$D/escort-claude-escalation.sh" || fail "分身唤起词未同步救活授权(宪法投影不同步)"

# 层8: 网关停摆单独识别 + 救活权代码化(0916分身首战实弹报告提案,熟化:判例→代码)
# 0921 网关迁移(决策 96054a8b): 判据从"容器 is not running"改成"MMV ssh 不可达"的信号词,
# 术语从"网关容器停摆"改成"网关机(MMV)不可达"——同一条铁律(区分基建死了vs真词单为空),换了地址。
_H8=$(grep -vE '^[[:space:]]*#' "$D/harvest-cron.sh")
# 8a: 取词单失败必须区分"网关机不可达"与"真词单为空"——0916凌晨两批真凶是前者却被误报成后者
grep -q 'Connection refused' <<< "$_H8" || fail "取词单失败未识别网关机不可达(Connection refused),网关死会被误报成词单为空"
grep -q '网关机(MMV)不可达' <<< "$_H8" || fail "缺'网关机(MMV)不可达'专属升级分支(根因指向错=分身查错方向)"
# 8b: 救活权代码化——守卫检测到容器 exited 必须取证+自动重启+回读验证(能写死的判据不该留给LLM)
_G="$D/disk-gateway-guard.sh"
_G8=$(grep -vE '^[[:space:]]*#' "$_G")
grep -q 'docker start\|docker restart' <<< "$_G8" || fail "守卫无救活动作(网关死6h无人救的0916事故未根治)"
grep -q 'docker inspect' <<< "$_G8" || fail "守卫救活前未取证(宪法救活权三前提之一)"
grep -qE 'exited' <<< "$_G8" || fail "守卫未按 exited 状态判定确已死亡(可能误重启健康容器)"
grep -qF '回读验证' "$_G" || fail "守卫救活后未回读验证(宪法救活权三前提之一)"

# 层9: KPI 驱动自动获客(0916主理人要求"KPI接入,不是一天三次")
[[ -s "$D/kpi-gate.js" ]] || fail "kpi-gate.js 缺失(KPI闸=目标表与执行层的唯一接口)"
node --check "$D/kpi-gate.js" || fail "kpi-gate.js 语法错误"
_H9=$(grep -vE '^[[:space:]]*#' "$D/harvest-cron.sh")
# 9a: 执行层必须过 KPI 闸(否则达标了照跑、缺口大了也不补=KPI形同虚设)
grep -q 'kpi-gate.js' <<< "$_H9" || fail "harvest-cron.sh 未接 KPI 闸(执行层不知道KPI存在)"
grep -q 'verdict' <<< "$_H9" || fail "harvest-cron.sh 未读 KPI 闸裁决"
# 注:不能裸 grep 'done'——会匹配 shell 的 for...done 关键字(0916变异测试实测到的假守卫)
grep -q 'KPI_VERDICT" == "done"' <<< "$_H9" || fail "harvest-cron.sh 未处理达标退让(done)裁决"
# 9b: KPI 闸必须 fail-open(宪法帮不拦: 闸自身故障绝不能停掉生产)
grep -qF 'fail-open' "$D/kpi-gate.js" || fail "kpi-gate.js 无 fail-open 兜底(闸故障会停产)"
grep -qF 'catch' "$D/kpi-gate.js" || fail "kpi-gate.js 无异常捕获"
# 9c: KPI 闸顺序必须在取词单之前(先判跑不跑,再决定取几词)——否则达标也白取一次词
_ln_kpi=$(grep -n 'kpi-gate.js' "$D/harvest-cron.sh" | head -1 | cut -d: -f1)
_ln_kw9=$(grep -n 'next-keywords.js' "$D/harvest-cron.sh" | head -1 | cut -d: -f1)
[[ -n "$_ln_kpi" && -n "$_ln_kw9" ]] && (( _ln_kpi < _ln_kw9 )) || fail "KPI闸(${_ln_kpi}行)未排在取词单(${_ln_kw9}行)之前"

# 层10: 词单本地兜底(0916主理人追问"为何100%跑不完"的根因修复)
# 采收六步中只有取词单是"网关挂=批次夭折"的死步(0915凌晨三批同型全灭),其余要么不依赖网关要么fail-open
_H10=$(grep -vE '^[[:space:]]*#' "$D/harvest-cron.sh")
# 10a: 取词单成功必须落本地缓存
grep -q 'KWCACHE' <<< "$_H10" || fail "harvest-cron.sh 无词单本地缓存(KWCACHE),网关挂即批次夭折"
# 注:必须精确到复制方向——反向的 cp $KWCACHE $WF(兜底读缓存)也含KWCACHE,松匹配会放行(0916变异实测)
grep -qF 'cp $WF $KWCACHE' <<< "$_H10" || fail "取词单成功后未写入缓存(方向须为 WF→CACHE)"
# 10b: 取词单失败必须尝试缓存续跑(而不是直接 exit)
grep -q '兜底词单' <<< "$_H10" || fail "取词单失败未走缓存兜底(仍是直接夭折)"
# 10c: 走兜底必须留痕+告知分身(不能静默用旧词单)
_fb=$(grep -A6 '兜底词单' <<< "$_H10" | grep -c 'escalate\|log ' || true)
[[ "$_fb" -ge 1 ]] || fail "走兜底词单未留痕/未告知(静默降级=看不见的腐烂)"

# 层11: AdbIME 启用/切换必须当场校验并报明原因(0916判例固化)
# 判例: M1悦升机装了ADBKeyboard但未启用→生产只报 "cannot be enabled for user #0",
#       要人去猜是"没装"还是"没启用"还是"ROM拦了"。代码原本把 enable 结果 >/dev/null 吞掉且不校验,
#       失败被拖到后面(输入不进字/回读不匹配)才暴露,首因丢失。
if grep -E 'ime enable com\.android\.adbkeyboard.*>/dev/null$' "$C" >/dev/null 2>&1; then
  fail "AdbIME enable 结果仍被 >/dev/null 吞掉且无校验(失败时首因丢失,要人去猜)"
fi
grep -qF 'AdbIME 未安装' "$C" || fail "AdbIME 失败时未区分'未安装'(该机需装 ADBKeyboard.apk)"
grep -qF 'AdbIME 切换未生效' "$C" || fail "ime set 后未回读校验真生效(切换失败会静默继续,后面才炸)"
_H_CODE_C=$(grep -vE '^[[:space:]]*#' "$C")

# 层12: 触达路线单一化(0916主理人拍板)
# ①采收已拿短链,触达直接开链即可;缺链单在选单器(next-outreach.js 缺链闸)就被标「待补链」拦掉,
#   搜索路线永远走不到=死代码。留着只是多一条没人验证、还会把"搜不到人"混进归因的岔路。
# ②私信入口统一走右上「更多」面板选「发私信」——官方号/旗舰店/个人号都有该入口;
#   主页直挂 DM 按钮因号型而异,先找它=多一个失败面,且面板里必须区分「发私信」与「联系客服」。
grep -qF 'profile_url is required' "$C" || fail "PROFILE_URL 仍可选(应必填:无链单不该进发送,选单器已在上游闸掉)"
# 注: 不能裸禁 snssdk1128://search/tabs——采收正当地用它搜关键词找视频(open-search/复位各处)。
# 只禁「私信发送里按抖音号搜人」这一段,其特征是 keyword=$target_douyin_id。
if grep -q 'search/tabs?keyword=$target_douyin_id' <<< "$_H_CODE_C"; then fail "私信发送仍保留按抖音号搜人的路线(死代码+把'搜不到人'混进归因)"; fi
if grep -q 'no card in top-3 user results' <<< "$_H_CODE_C"; then fail "搜索路线的前3卡兜底未删除"; fi
grep -qF '统一走「更多」面板' "$C" || fail "私信入口未统一走更多面板(应去掉先找直挂DM按钮的分支)"
grep -qF '联系客服' "$C" || fail "更多面板未区分「发私信」与「联系客服」(选错=发到客服通道)"
# 12b: 身份强校验必须大小写不敏感(0916真机实测: 主页显示 Zenithjoyai / 搜索页显示 zenithjoyai,
#      抖音号本身大小写不敏感,裸 == 比较会把同一个人判成"不是他"而静默拒发——开闸即大面积失败)
if grep -qE '\[\[ "\$(observed_target_id|_web_id)" == "\$target_douyin_id" \]\]' <<< "$_H_CODE_C"; then
  fail "身份校验仍是大小写敏感的裸比较(0916实测 Zenithjoyai≠zenithjoyai 致误拒)"
fi
grep -qF 'tr "[:upper:]" "[:lower:]"' "$C" || fail "身份校验未做大小写归一"

# 层13: 业务线路由(0916主理人问"悦升客资表咋不见了"→查明表一直在,是链路没接)
# 悦升有独立 base H3OrbAH49aLNebs7XvOcpS1enec(17张表齐全),但落池脚本写死金诺 base,
# 且 M1 crontab PUSH=0 → 采收数据既不进悦升也不进金诺,只躺本地 tsv(当时已攒35条)。
# 死规矩: 凡写库脚本必须按业务线取 base/table,禁止写死单一 base。
[[ -s "$D/line-routes.js" ]] || fail "缺业务线路由表 line-routes.js(base/table 的 SSOT)"
node --check "$D/line-routes.js" || fail "line-routes.js 语法错误"
grep -qF 'H3OrbAH49aLNebs7XvOcpS1enec' "$D/line-routes.js" || fail "路由表缺悦升 base"
grep -qF 'GNuwbzY0da8GP0sv6MGcOTu9ntd' "$D/line-routes.js" || fail "路由表缺金诺 base"
# 注:不能只 grep 'LINE'——`const LINE = "";` 也含它(0916变异实测的宽松断言)。必须查真读了 argv。
# 注:也不能只查 argv[3]——write 模式读 json 文件用的也是它。必须是**同一行**里 LINE 赋值读了 argv。
grep -qE 'LINE *=[^;]*process\.argv' "$D/sort-comments.js" || fail "分拣脚本的 LINE 没真读入参(写死空值=悦升池永远没人消化)"
[[ -s "$D/batch2.sh" ]] || fail "batch2.sh 未回流 repo(只活在机器上=重装即丢,且无守卫)"
if command -v zsh >/dev/null 2>&1; then zsh -n "$D/batch2.sh" || fail "batch2.sh zsh 语法错误"; fi
# 0922: 载体从 profile 换成业务线标记 ${LINE}——隔离点在「活」上不在「机器」上
# （主理人原话：生产要求你生产回填哪，研发要求你研发回填哪）。
# 守的**意图没变**：落池必须拿得到业务线，否则悦升数据会写进金诺表；
# 变的只是传什么。${LINE} 缺省退回 profile 名，两者 line-routes 都认。
grep -qE 'push-raw-comments\.js [^ ]+ \$TAG \$(LINE|P)\b' "$D/batch2.sh" || fail "batch2.sh 落池没把业务线标记传下去(路由拿不到业务线,悦升数据会写错表)"
grep -qE 'push-videos\.js [^ ]+ \$TAG \$(LINE|P)\b' "$D/batch2.sh" || fail "batch2.sh 视频落池没把业务线标记传下去"
# 认不出的标记必须拒收——旧实现兜底倒进金诺，等于静默污染别人的库
grep -qE 'throw new Error' "$D/line-routes.js" || fail "line-routes 认不出标记时不再抛错(退回兜底=悦升研发数据会静默写进金诺生产表)"
for f in push-raw-comments.js push-videos.js sort-comments.js; do
  grep -qF 'line-routes' "$D/$f" || fail "$f 未走业务线路由(写死单一 base = 悦升数据无处可去)"
  # 写死 base 常量必须已移除(允许出现在注释里)
  if grep -vE '^[[:space:]]*(//|\*|/\*)' "$D/$f" | grep -qE 'const B *= *"GNuwbzY'; then
    fail "$f 仍写死金诺 base 常量"
  fi
done

# 层14: 词表轮换不许被刷平(0916查明的静默bug)
# update-keyword-stats 的 stat 从池全量重算,含**所有历史词**,却给每个词都写当前 now →
# 所有词「最后测试时间」相同 → next-keywords 的"最久未测优先"排序完全失效,轮换退化成瞎转。
# 死规矩: 只给**本轮真跑过**的词打时间戳。
_KS="$D/update-keyword-stats.js"
[[ -s "$_KS" ]] || fail "update-keyword-stats.js 缺失"
node --check "$_KS" || fail "update-keyword-stats.js 语法错误"
grep -qF 'RECENT' "$_KS" || fail "未区分本轮跑过的词(全量刷时间戳=毁掉最久未测轮换)"
# 时间戳必须是条件写入,不能无条件盖
grep -qE '最后测试时间.*RECENT|RECENT.*最后测试时间' "$_KS" || fail "「最后测试时间」仍是无条件写入"

# 层15: 网关迁移(0921,决策 96054a8b) ratchet——us-vps 那份 openclaw-gateway 容器已退役
# (/root/.openclaw-gateway-retired),取单/去重/落池/词单/KPI闸/escort拉起全部改经 MMV
# 原生 node/openclaw 调用。禁止任何触达/采收/落池脚本复活 docker exec openclaw-gateway
# 写法——复活了就是又在死容器上取单,会静默失败大半天却只报"无待触达单"。
for f in outreach-tick.sh harvest-keyword.sh harvest-cron.sh batch2.sh; do
  if grep -qF 'docker exec openclaw-gateway' "$D/$f"; then
    fail "$f 复活了已退役的 us-vps docker exec openclaw-gateway 写法(决策 96054a8b),必须走 ssh mmv 原生调用"
  fi
done
grep -qF "ssh -o ConnectTimeout=15 mmv 'node /Users/administrator/.openclaw/leadgen-scripts/next-outreach.js next'" "$D/outreach-tick.sh" \
  || fail "outreach-tick.sh 取单未走迁移后的 MMV 原生地址"

# 层16: 0921真机实证——zsh(set -u)下变量名紧跟CJK字符会被当成一个变量名的一部分
# (如 $DYID的卡片 被解析成变量"DYID的卡片"而非 $DYID + 字面量"的卡片"),
# 实测 refill-profile-links.sh 第37行真崩过("DYID的卡片: parameter not set")。
# 全仓禁止"$变量名紧跟中日韩统一表意文字、无花括号分隔"这个写法。
# 注: 不用 grep -P + \x{4e00}-\x{9fff}——系统自带 BSD grep 不支持 PCRE,这条会静默永远不
# 命中(假绿,曾亲手在此踩中并用变异测试揪出来),改用 python3(CI/本机都保证有) 判定。
_CJK_HIT=$(python3 - "$D" <<'PYEOF'
import re, sys, glob, os
D = sys.argv[1]
pat = re.compile(r'\$[A-Za-z_][A-Za-z0-9_]*[一-鿿]')
hits = []
for path in glob.glob(os.path.join(D, "*.sh")):
    with open(path, encoding="utf-8", errors="ignore") as f:
        for i, line in enumerate(f, 1):
            if line.lstrip().startswith("#"):
                continue
            if pat.search(line):
                hits.append(f"{path}:{i}:{line.rstrip()}")
print("\n".join(hits))
PYEOF
)
if [[ -n "$_CJK_HIT" ]]; then
  echo "$_CJK_HIT"
  fail "检测到未加花括号的shell变量紧跟CJK字符(0921真机实锤: zsh set -u下会被解析成一整个未定义变量名崩溃),必须写成\${VAR}中文"
fi

# 层17: 0921真机实证——补链28条0成功,逐张截图排查出根因:①用户tab识图偶发漏判
# 从不重试 ②抖音搜索模糊匹配,目标账号常不在第一屏,脚本从不滚动。禁止这两处
# retry/滚动逻辑被删掉复活成"一次不中就放弃"。
_RF="$D/refill-profile-links.sh"
grep -qF 'for _ut in 1 2' "$_RF" || fail "refill-profile-links 用户tab定位重试逻辑缺失(0921实证:识图单次调用有误判率,不重试=白白放弃能找到的号)"
grep -qF 'for _ct in 1 2 3' "$_RF" || fail "refill-profile-links 卡片定位滚动重试逻辑缺失(0921实证:抖音模糊匹配目标常不在第一屏,不滚动=永远够不到)"
grep -qF 'swipe 600 2000 600 900 400' "$_RF" || fail "refill-profile-links 缺少下滑一屏的滚动动作"

# 层18: 0922真机实证——账号轮流分配若按"今日已触达数sent的奇偶性"判断,而sent只在
# 真正成功后才变化,队首记录(pending[0]确定性排序)一旦分给暂停/故障账号会死循环
# 永远选中同一个坏账号,legacy完全轮不上,整条队列卡死(0922实测:同一条记录连续
# 3个tick原地重试)。禁止 sent%2 这种确定性选号复活,必须用不依赖计数器的随机选号。
_NO="$D/next-outreach.js"
if grep -qE 'sent\s*%\s*2\s*===\s*0' "$_NO"; then
  fail "next-outreach.js 账号分配用了sent奇偶判断(0922实测:队首卡坏账号时会死循环,legacy永远轮不上)"
fi
grep -qF 'Math.random() < 0.5' "$_NO" || fail "next-outreach.js 缺少随机选号逻辑(账号轮流不能依赖会卡住不动的计数器)"

# 层20: 0922视频文案判定(阶段3)——judge-jev.js的复核官(judgeCommander)是判定链最后
#一道关卡,真机实测时曾把"httpPost网络异常/超时"这种情况漏处理:异常会直接从
# judgeCommander往外抛,冲穿judgeContent,让整条视频判定崩溃退出、这一批后面的视频全部
# 陪跑失败(找到时是靠单测复现的,不是真机踩的坑,提前补上守卫防止真机复发)。
# 必须在httpPost调用外面包一层try/catch,失败保守判rejected(存疑不放行),不能让异常裸抛。
_JJ="$D/judge-jev.js"
[[ -s "$_JJ" ]] || fail "judge-jev.js 缺失或为空"
_COMMANDER_BODY=$(awk '/^async function judgeCommander/,/^}/' "$_JJ")
grep -q "try {" <<< "$_COMMANDER_BODY" || fail "judgeCommander 缺少try/catch包裹httpPost调用(网络异常会裸抛,炸穿整条判定链)"
grep -q "catch" <<< "$_COMMANDER_BODY" || fail "judgeCommander 缺少catch分支"

echo "phone-adb-controller-smoke: PASS"
