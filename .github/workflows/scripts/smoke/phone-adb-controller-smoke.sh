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

# 层21: commenter-identity 必须在**逐屏**(NEWLINES)上做,不能在**翻完屏后的累积列表**(CC)上做
# (0923生产实证:三台并发批次、两条业务线,逐行身份验证100%炸"nickname mismatch"——根因是
# 翻屏累积再统一处理时,早期屏的tap坐标早就对不上手机翻到最后一屏后的实际画面)。
grep -qE 'for CLINE in "\$\{\(f\)NEWLINES\}"' "$D/harvest-keyword.sh" || fail "harvest-keyword.sh 的身份验证循环没有改成逐屏处理(NEWLINES),翻屏后tap坐标必然作废"
if grep -B3 'commenter-identity' "$D/harvest-keyword.sh" | grep -qE 'for CLINE in "\$\{\(f\)CC\}"'; then
  fail "harvest-keyword.sh 身份验证仍在累积列表(CC)上做,复发0923的翻屏坐标失效bug"
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
  # 0923真机实证(0921晚langzi463485被登出事故的原始信号): 账号身份不符必须一次就识别,
  # 不能落进要等连续2次才反应的"other"桶(继续用错账号重试=用错误身份骚扰真实线索)。
  [[ "$(CF 'current sender account does not match the claimed distribution account')" == "account_mismatch" ]] || fail "classify: 账号身份不符应识别为 account_mismatch,不能落进 other"
  [[ "$(CF 'current Douyin account identity was not visible on the verified Me page')" == "account_mismatch" ]] || fail "classify: Me页身份不可见应识别为 account_mismatch"
else
  echo "::warning::zsh 不可用,层4 归因断言跳过(部署侧会跑)"
fi
# 层4b: account_mismatch 必须一次命中就熔断(不能像 other 那样等连续2次判定才停)
grep -qF 'account_mismatch' "$D/outreach-tick.sh" || fail "outreach-tick 未接 account_mismatch 分类"
ACCT_BRANCH="$(grep -A8 '"$CLS" == "account_mismatch"' "$D/outreach-tick.sh" || true)"
grep -qF 'touch "$PAUSE_FLAG"' <<< "$ACCT_BRANCH" || fail "account_mismatch 分支未直接熔断(必须一次命中就停,不能等连续2次)"
grep -q 'ANOMALY_COUNT' <<< "$ACCT_BRANCH" && fail "account_mismatch 分支不该绕经ANOMALY_COUNT计数(必须一次命中就停,不是等连续2次)"
# 层4c: 0922-11:54单#172原始XML实锤——气泡渲染成功但平台已弹"发送消息过于频繁"限流提示时，
# 之前会被直接判成功(MARKED sent),这跟"仅互关"是两回事,必须分开识别、分开处理。
RATELIMIT_BRANCH="$(grep -A6 'grep -qF "发送消息过于频繁"' "$D/outreach-tick.sh" || true)"
[[ -n "$RATELIMIT_BRANCH" ]] || fail "outreach-tick 未接风控/当日限流二次核验(0922单#172真机实锤:气泡成功但平台限流会被误判送达成功)"
grep -qF 'mark "$RID" rate_limited' <<< "$RATELIMIT_BRANCH" || fail "风控检测未真正接到 rate_limited 分支(字符串存在但没接上判定逻辑,守卫一个词≠守卫一个行为)"
grep -qF 'ORDER_RESULT="rate_limited"' <<< "$RATELIMIT_BRANCH" || fail "风控命中后 ORDER_RESULT 未设为 rate_limited(会被当成 sent 计入成功触达)"
grep -qF 'rate_limited' "$D/next-outreach.js" || fail "next-outreach done模式未接 rate_limited"
# 层4d: 0923真机实证——风控分支曾直接`echo "$CAP" > "$COUNT_FILE"`把"已发送计数"和
# "今日是否该停发"塞进同一个字段,导致legacy号当天真实只发12次(10送达+1受限+1风控)
# 却在日志/状态文件里显示"今日已达阶梯上限60/60",看起来像真发了60条。必须分成独立的
# HALT_FILE,COUNT_FILE只许老实累计真实尝试次数。
grep -qF 'HALT_FILE="$STATE_DIR/dm-halt-$PROFILE-$DATE_TAG.txt"' "$D/outreach-tick.sh" \
  || fail "outreach-tick 未接独立的HALT_FILE(已发数和停发状态还混在一个字段里)"
grep -qF '[[ -f "$HALT_FILE" ]]' "$D/outreach-tick.sh" || fail "outreach-tick 取单闸未检查HALT_FILE"
RATELIMIT_BRANCH2="$(grep -A8 'grep -qF "发送消息过于频繁"' "$D/outreach-tick.sh" || true)"
grep -qF '> "$HALT_FILE"' <<< "$RATELIMIT_BRANCH2" || fail "风控命中未写HALT_FILE(还在直接改COUNT_FILE,已发数会继续撒谎)"
grep -qF '> "$COUNT_FILE"' <<< "$RATELIMIT_BRANCH2" && fail "风控分支不该再直接改写COUNT_FILE(已发数字段必须只反映真实尝试次数)"
grep -qF 'requeue_transient' "$D/outreach-tick.sh" || fail "tick 未接 requeue_transient"
# 层6: 夜批run伴随Commander(决策dcdaa83e: 起跑拉起escort,收工注销,辅佐姿态)
grep -qF 'escort-' "$D/harvest-cron.sh" || fail "harvest 未拉起伴随escort"
grep -qF 'cron rm' "$D/harvest-cron.sh" || fail "harvest 未注销escort(泄漏cron)"
[[ -s "$D/cmdr-escort.txt" ]] || fail "escort SOP文件缺失"
grep -qF '帮不拦' "$D/cmdr-escort.txt" || fail "escort SOP缺辅佐三原则"

# 层5: 落表独立字段(主理人0915逐列验收拍板: 昵称/抖音号/主页链接/IP/留言时间独立成列)
grep -qF '"留言时间"' "$D/push-raw-comments.js" || fail "push-raw-comments 未写留言时间列"
grep -qF '"主页IP"' "$D/push-raw-comments.js" || fail "push-raw-comments 未写主页IP列"
# 0923 搬运逻辑抽进 sort-comments-lib.js(池状态必须最后推进,顺序只有注入假飞书跑一遍才测得出),
# 列的字面量跟着挪过去了,检查点也跟着挪——盯着旧文件 grep 会在重构后变成假绿。
# 认两种写法: "IP属地": 和 ES6 简写 IP属地: —— 只认带引号那种，重构成简写时会假红
grep -qE '"?IP属地"?[[:space:]]*:' "$D/sort-comments-lib.js" || fail "sort-comments 搬运未写IP属地列"
# 0919 字段收敛(主理人拍板): 纯昵称列改名"抖音昵称"，且抽到 lead-fields-lib.js 共享构造，
# 不再是 sort-comments.js 自己的字面量——检查点跟着挪到构造库+接入点两处。
grep -qF '"抖音昵称"' "$D/lead-fields-lib.js" || fail "lead-fields-lib 未写抖音昵称列"
grep -qF 'buildLeadCoreFields' "$D/sort-comments-lib.js" || fail "sort-comments 搬运未接入字段构造库"
grep -qF 'settlePending' "$D/sort-comments.js" || fail "sort-comments 没走 settlePending(顺序保证退回调用方自觉,146条线索就是这么丢的)"
node --check "$D/sort-comments-lib.js" || fail "sort-comments-lib.js 语法错误"
# 0923 真 bug 回流: 池状态推进必须在写线索之后。原实现先标「已分拣+进入最终线索=true」
# 再写线索表,写失败只打日志;下一轮扫池入口是 `处理状态 !== 待分拣 → 跳过`,那条永远捞不回来。
# 线上对账: 池 true 518 条,线索表对得上 372 条,差 146(金诺41/悦升105)。
node -e '
const fs=require("fs");
const code=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(l=>!l.trimStart().startsWith("//")).join("\n");
// 契约: 每一次「把池推成 已分拣+进入最终线索=true」之前, 都必须先有一次写线索结果的成功检查。
// 位置比较行不通——DUP 分支的推进本来就排在 postLead 之前, 一比就误报。
const DONE=/处理状态:\s*[\x27"]已分拣[\x27"],\s*进入最终线索:\s*true/g;
let m, n=0, bad=0;
while((m=DONE.exec(code))){ n++; if(!/okRes\(res\)/.test(code.slice(0,m.index))) bad++; }
if(n<2){ console.error("只找到 "+n+" 处池推进(期望 DUP + 新客户两处) —— 守卫要跟着改"); process.exit(1); }
if(bad){ console.error(bad+" 处池推进前没有写线索的成功检查 —— 原 bug 复活"); process.exit(1); }
' "$D/sort-comments-lib.js" || fail "sort-comments-lib 池状态推进早于线索落地(146条线索就是这么丢的)"
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
# 0923: 落池之后必须紧接着分拣——sort-comments.js此前压根没有任何自动触发点
# (不在cron、不在任何批处理链路里，唯一"手跑干预"的playbook写的是host上根本不存在的
# /root/.openclaw/...路径，从没真正跑通过)。守住"落池后一定调分拣"，不许日后改落池
# 代码时把这一步漏掉或悄悄删掉。
grep -qE 'sort-comments\.js \$(LINE|P)\b' "$D/batch2.sh" || fail "batch2.sh 落池后没有紧接着调用 sort-comments.js(分拣链路仍是悬空的,新评论不会被判定)"
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
# 时间戳必须是条件写入,不能无条件盖。0923 字段构造抽进 keyword-stats-lib.js 之后,
# 「最后测试时间」这个字面量不再出现在本文件里,条件变成了传给 lib 的 stamp 参数。
grep -qE 'stamp:[^,)]*RECENT' "$_KS" || fail "「最后测试时间」仍是无条件写入(stamp 没带上 RECENT 判据)"

# 层14b(0923): 三层真 bug 回流 —— 悦升关键词表四列长期全 0
_KSL="$D/keyword-stats-lib.js"
[[ -s "$_KSL" ]] || fail "keyword-stats-lib.js 缺失"
node --check "$_KSL" || fail "keyword-stats-lib.js 语法错误"
# 第一层: 0916「按业务线路由」改了四个写库脚本,漏了这一个 → 悦升效果回写从来没跑过
# ⚠️ 只扫**代码行**: 这个文件的注释里正引用「连 line-routes 都没 require」当反面教材,
#    扫全文会被自己的注释绊倒(0922 已复发过一次,变异实测这次又中)。
# 用 herestring 而不是 `echo "$VAR" | grep`——后者是本仓认定的假绿模式，
# smoke-selfcheck-smoke.sh 会拦（刚写完就被它抓了一次）。
_KS_CODE=$(grep -vE '^[[:space:]]*//' "$_KS")
grep -qF 'require("./line-routes.js")' <<< "$_KS_CODE" \
  || fail "update-keyword-stats 仍写死 base/table(0916 路由漏改的就是它,悦升效果回写从没跑过)"
if grep -qE '"GNuwbzY0da8[A-Za-z0-9]*"' <<< "$_KS_CODE"; then fail "金诺 base 仍被写死在 update-keyword-stats.js 里"; fi
# 第二层: 悦升「最后测试时间」是日期型,写文本 → DatetimeFieldConvFail,**整条记录**打回
grep -qE '/fields\?page_size' "$_KS" || fail "update-keyword-stats 没读字段类型(悦升的日期列会把整批写入打回)"
grep -qF 'buildStatFields' "$_KS" || fail "字段构造未走 keyword-stats-lib"
# 第三层: 两家线索表都没有「命中关键词」列,按它数有效线索永远是 0
grep -qF 'tallyFromPool' "$_KS" || fail "有效线索数未走 tallyFromPool"
if grep -qE 'for \(const r of leads\)' "$_KS"; then fail "还在遍历线索表统计关键词(线索表没有「命中关键词」列,数出来永远是 0)"; fi
# 自建行的「是否启用」不许写死(悦升那列是单选,写死会把客户下拉框塞满垃圾选项)
grep -qF 'enabledValueFor' "$_KS" || fail "自建行的「是否启用」仍是写死值"

# 层16(0924): 昵称比对两边编码不一致 → 把进对了的人判成「进错人」
# 0923 悦升夜批实证：observed 走 xmllint（会解 XML 字符实体），expected 是调用方
# 从评论区 content-desc 原样传入（没解），同一个人读出两个串：
#   xmllint: '小辣椒🌶️'   vs   原始: '小辣椒&#127798;️'
# 字面比不等 → nickname mismatch → 重试三次全一样 → 放弃。证据：同一人 t2/t3
# 主页昵称都读到「小辣椒🌶️」、抖音号都是 87784291536，每次都进对了每次都判失败。
# 代价：那批 801 人里 68 人昵称带实体(8.5%)，每人白跑三轮约 3~4 分钟 ≈ 4 小时，
# 这批跑了 8.5 小时把 03:00 那批整个挤掉（12 词全「锁被占」LEAD=0）。
_NICK_LIB="$D/nickname-match-lib.js"
[[ -s "$_NICK_LIB" ]] || fail "nickname-match-lib.js 缺失"
node --check "$_NICK_LIB" || fail "nickname-match-lib.js 语法错误"
# 层17(0924): 下发落点必须是调用方真正用的那个路径
# deploy.sh 把 douyin-phone-adb 送到 ~/bin-harvest/，而 harvest-keyword.sh 里写的是
#   C=~/.local/bin/douyin-phone-adb
# 两台机实测：bin-harvest=新版、.local/bin=旧版 —— 下发"成功"了，夜批却永远跑旧的。
# deploy.sh 的注释已经写过「不下发 = 改了控制器却永远到不了手机机」，但落点选错了，
# 等于只把文件搬到了一个没人读的地方（同款形状见 memory
# phone_controller_live_path_is_local_bin_not_repo：这条路径长期两份不同步）。
_CALL_PATH=$(grep -ohE '[~$][^ ]*/douyin-phone-adb' "$D/harvest-keyword.sh" 2>/dev/null | sort -u | head -1)
if [[ -n "$_CALL_PATH" ]]; then
  # 调用方用的目录（去掉文件名），必须出现在 deploy.sh 的下发目标里
  _CALL_DIR="${_CALL_PATH%/douyin-phone-adb}"
  # 只 grep 路径字符串拦不住「if 条件被改成恒假」——字符串照样躺在文件里。
  # 所以这里**真跑一遍 deploy.sh**：把 scp/ssh 打桩成只记账不出网，
  # 读它实际送出的目标清单。查的是行为，不是措辞。
  #
  # 不断言 deploy.sh 的退出码：那受一堆与落点无关的环境差异影响（跑场机有没有
  # zsh、/tmp 可不可写……），本地绿 CI 红查不动。真正要守的是「送到哪了」，
  # 这条断言本身就拦得住去掉 scp / 条件恒假 / 送错目录 / 漏掉一台四种改法。
  _STUB=$(mktemp -d)
  printf '#!/bin/bash\nfor a in "$@"; do printf "%%s\\n" "$a"; done >> "%s/scp.log"\nexit 0\n' "$_STUB" > "$_STUB/scp"
  printf '#!/bin/bash\nexit 0\n' > "$_STUB/ssh"
  chmod +x "$_STUB/scp" "$_STUB/ssh"
  PATH="$_STUB:$PATH" bash "$D/deploy.sh" > "$_STUB/run.log" 2>&1 || true
  for _h in xian-m4 xian-m1; do
    if ! grep -qx "$_h:${_CALL_DIR}/douyin-phone-adb" "$_STUB/scp.log" 2>/dev/null; then
      # 带上现场再死，否则下一个人只能靠猜（本仓死规矩：不拿现场不动手）
      echo "--- deploy.sh 空跑输出(末 15 行) ---" >&2
      tail -15 "$_STUB/run.log" >&2 2>/dev/null || echo "(没有输出)" >&2
      echo "--- 实际送出的目标 ---" >&2
      grep -E '^[a-z0-9-]+:' "$_STUB/scp.log" 2>/dev/null | sort -u >&2 || echo "(scp.log 为空)" >&2
      rm -rf "$_STUB"
      fail "deploy.sh 空跑后没往 $_h:${_CALL_DIR}/ 送 douyin-phone-adb —— 夜批调的就是这个路径(harvest-keyword.sh 里写死 ${_CALL_PATH})，下发到别处=手机上永远跑旧版"
    fi
  done
  rm -rf "$_STUB"
fi

grep -qF 'normalize_nickname' "$D/douyin-phone-adb" \
  || fail "douyin-phone-adb 没有 normalize_nickname —— 昵称比对又回到裸字符串比，带 emoji 的人会被全判成进错人"
# 比对处必须比归一后的值，不能比原始值
grep -qE 'norm_observed.*!=.*norm_expected|norm_expected.*!=.*norm_observed' "$D/douyin-phone-adb" \
  || fail "比对处没用归一后的值"
# ⚠️ 转义 & 会让 &#127798; 变成 &amp;#127798;，xmllint 解出来还原成字面，等于没做
if grep -qF 'raw//&/&amp;' "$D/douyin-phone-adb"; then
  fail "normalize_nickname 又把 & 转义了 —— 实体会被还原成字面，归一化等于没做（第一版原样复现）"
fi
# 真跑一遍 zsh 归一函数：静态 grep 抓不住"写了但不生效"（第一版转义写错、去空白用了
# 需要 extendedglob 的写法，两处都是 grep 全绿、真跑才露馅）
if command -v zsh >/dev/null 2>&1; then
  # ⚠️ 用 env -i 剥光环境跑：locale 缺失时 zsh 的 ${(#)n} 按单字节处理，
  #    码点会被静默截成错的字符（本机有 LANG 看不出来，CI runner 没有就中招——
  #    实测空环境出「小辣椒6」而非「小辣椒🌶」）。守卫必须在**最差环境**下验。
  _NICK_OUT=$(env -i PATH=/usr/bin:/bin zsh -c '
    eval "$(awk "/^normalize_nickname\(\) \{/,/^\}/" '"$PWD/$D"'/douyin-phone-adb)"
    print -n -- "$(normalize_nickname "小辣椒&#127798;️")|$(normalize_nickname "  峥嵘岁月  ")"
  ' 2>/dev/null)
  [[ "$_NICK_OUT" == "小辣椒🌶|峥嵘岁月" ]] \
    || fail "normalize_nickname 真跑结果不对: 实得[$_NICK_OUT] 期望[小辣椒🌶|峥嵘岁月]"
else
  echo "  ⏭ 跳过昵称归一真跑（本机无 zsh）"
fi
# 调用方必须把业务线传进去。0923 实证:harvest-cron.sh 调它时一个参数都不传,
# 而脚本内部写死金诺 base —— 于是 m1 跑悦升的批次也在往**金诺**表回写,
# 悦升关键词表四列长期全 0。改成按 line-routes 路由之后不传参数会直接抛「未配路由」,
# 夜批当晚就红;但那已经是事故了,这里在 CI 就拦住。
grep -qF "update-keyword-stats.js '\${BIZ}'" "$D/harvest-cron.sh" \
  || fail "harvest-cron.sh 调 update-keyword-stats 没传业务线(不传=抛未配路由,夜批当晚炸;老写法则是静默写进金诺表)"
if grep -qE 'fields\["是否启用"\] *= *"是"' "$_KS"; then fail "「是否启用」写死\"是\",悦升单选列会被自动新增选项污染"; fi

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

# 层19: 0922建数据库正本第一刀——leadgen-db-lib.js 是纯逻辑+依赖注入(不 require('pg')),
# 因为 openclaw-scripts-test job 跑本目录 __tests__/*.test.mjs 时不装任何依赖(纯 node --test,
# 见 ci-l3-code.yml 注释)。真连接在 leadgen-db-connect.js 里,一旦 leadgen-db-lib.js 不小心
# require 了 pg,CI 会直接找不到模块炸掉——这道闸把这个风险锁死在源头,而不是等 CI 红了才发现。
_DBLIB="$D/leadgen-db-lib.js"
[[ -s "$_DBLIB" ]] || fail "leadgen-db-lib.js 缺失或为空"
# 只看非注释行(грep会连注释里提到"require('pg')"这几个字的说明性文字一起误判,
# 0922真机实测踩过:本文件头部注释本身就写了这几个字来解释"为什么不能这么做")。
_PG_HIT=$(grep -nE "require\(['\"]pg['\"]\)" "$_DBLIB" | grep -vE '^[0-9]+:[[:space:]]*//' || true)
[[ -z "$_PG_HIT" ]] || fail "leadgen-db-lib.js 不能直接 require('pg')——本目录测试跑在不装依赖的CI job里,必须靠依赖注入的pool参数,真连接放leadgen-db-connect.js"
for fn in commentDedupKey upsertVideo listPendingVideos markVideoJudgment upsertComment listPendingComments markCommentJudgment upsertLead; do
  grep -qF "$fn" "$_DBLIB" || fail "leadgen-db-lib.js 缺少导出函数 $fn"
done

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


# 层22: deploy.sh 清单不能悄悄漂移(0923补建:这套脚本从未有过自动部署,合并进main≠
# 生产在跑——建了deploy.sh一键同步三台机器,但清单是写死的文件名数组,新增文件不会自动
# 进清单。守住"仓库里每个顶层.js/.sh都在deploy.sh某个清单里",漏了会在这里报错，
# 而不是等到某天有人发现"PR明明改了这个新文件，机器上却没有"才追查到清单漏了它。
_DEPLOY="$D/deploy.sh"
[[ -s "$_DEPLOY" ]] || fail "deploy.sh 缺失(0923一键同步脚本,别让它跟着别的文件一起悄悄消失)"
bash -n "$_DEPLOY" || fail "deploy.sh 语法错误"
# v4实验管线(batch2-v4.sh/harvest-cron-v4.sh)已实测确认未接入任何crontab、目标机上
# 也不存在,是明确排除项,不算漂移。
_V4_EXCLUDE="batch2-v4.sh harvest-cron-v4.sh"
for f in "$D"/*.js; do
  bn="$(basename "$f")"
  grep -qF "$bn" "$_DEPLOY" || fail "deploy.sh 清单漏了 $bn(新增/改名的.js文件必须补进 MMV_JS_FILES,否则合并PR后机器上永远是旧版)"
done
for f in "$D"/*.sh; do
  bn="$(basename "$f")"
  [[ "$bn" == "deploy.sh" ]] && continue
  case " $_V4_EXCLUDE " in *" $bn "*) continue ;; esac
  grep -qF "$bn" "$_DEPLOY" || fail "deploy.sh 清单漏了 $bn(新增/改名的.sh文件必须补进 DEVICE_SH_FILES,否则合并PR后机器上永远是旧版)"
done


# 层23: video-judge接线三件套(0923补齐,真机验证过:录制+提取+转写+判定全链路真实跑通)
# ①写入端: push-videos.js必须双写Postgres(否则leadgen_videos表永远是空的,judge-video.js
#   无米下锅) ②真机录制端: harvest-keyword.sh必须真的调record-start/stop/extract-audio
#   (不能只有title兜底) ③触发端: batch2.sh必须把录到的音频传到mmv并调用judge-video.js。
grep -qE 'await upsertVideo\(pool' "$D/push-videos.js" || fail "push-videos.js 未接入Postgres双写(judge-video.js会永远无数据可判)"
grep -qF 'leadgen-db-connect' "$D/push-videos.js" || fail "push-videos.js 未引入leadgen-db-connect(Postgres连接缺失)"
grep -qF 'record-start' "$D/harvest-keyword.sh" || fail "harvest-keyword.sh 未接真机录制(record-start),视频判定只能靠标题兜底"
grep -qF 'record-extract-audio' "$D/harvest-keyword.sh" || fail "harvest-keyword.sh 未接音频提取(record-extract-audio)"
grep -qE 'print -- "AUDIO' "$D/harvest-keyword.sh" || fail "harvest-keyword.sh 录了音频但没输出AUDIO行,batch2.sh收不到"
grep -qE 'ssh .*node .*judge-video\.js' "$D/batch2.sh" || fail "batch2.sh 未接入judge-video.js触发(视频判定链路悬空)"
grep -qE "grep '\^AUDIO" "$D/batch2.sh" || fail "batch2.sh 未从采收输出里提取AUDIO行(音频传不到mmv)"


# 层24: batch2.sh里凡是ssh过去会touch Postgres(leadgen-db-connect.js读DATABASE_URL)的
# 命令,必须在同一条ssh命令里先source凭据(0923真机实测发现:裸ssh过去的shell不会自动
# source ~/.credentials/,不带这行DATABASE_URL就是空,push-videos.js的双写和judge-video.js
# 的读取会静默连到pg默认本地库——没有zenithjoy schema,全部静默失败,今天刚部署就撞上)。
_PV_SSH_LINE="$(grep 'node .*push-videos\.js' "$D/batch2.sh" | grep 'ssh ' || true)"
grep -qF 'source ~/.credentials/zenithjoy-db.env' <<< "$_PV_SSH_LINE" \
  || fail "batch2.sh 调用push-videos.js的ssh命令没有source ~/.credentials/zenithjoy-db.env(Postgres双写会静默连错库)"
_JV_SSH_LINES="$(grep 'node .*judge-video\.js' "$D/batch2.sh" | grep 'ssh ' || true)"
[[ -z "$_JV_SSH_LINES" ]] && fail "batch2.sh 找不到任何judge-video.js的ssh调用(层23应该已经守住,层24逻辑错了)"
while IFS= read -r _line; do
  [[ -z "$_line" ]] && continue
  grep -qF 'source ~/.credentials/zenithjoy-db.env' <<< "$_line" \
    || fail "batch2.sh 有一处调用judge-video.js的ssh命令没有source ~/.credentials/zenithjoy-db.env(判定读不到Postgres数据)"
done <<< "$_JV_SSH_LINES"

# 层25: 录制前音量必须幂等驱动到 RECORD_MEDIA_VOLUME,不能再无脑 VOLUME_UP x2
# (0924 真机复盘: record_start 每条视频无条件按两次 KEYCODE_VOLUME_UP 且录完不复位,
#  形成 +2 单向棘轮,生产两台实测爬到 12/17 和 10/17,非录制阶段全程大音量外放,
#  西安办公室不可忍。同轮实测钉死: 媒体音量 0 录到 -91dB 死寂、1 录到 -35.4dB、
#  4 录到 -35.3dB —— 采集电平是开关行为不随音量衰减,故驱动到 1 即零音质损失。
#  另证抖音不存在独立 app 内静音标志,稳态零按键安全。)
grep -qE '^RECORD_MEDIA_VOLUME=' "$C" || fail "douyin-phone-adb 缺 RECORD_MEDIA_VOLUME 常量(录制目标音量没有单一出处)"
grep -qE '^ensure_media_volume\(\)' "$C" || fail "douyin-phone-adb 缺 ensure_media_volume() 幂等音量驱动函数"
grep -qE 'ensure_media_volume "\$RECORD_MEDIA_VOLUME"' "$C" || fail "record_start 没有调用 ensure_media_volume \"\$RECORD_MEDIA_VOLUME\"(音量棘轮会复发)"
_RS_BODY="$(sed -n '/^record_start()/,/^}/p' "$C")"
_RS_VOLUP_COUNT="$(grep -c 'KEYCODE_VOLUME_UP' <<< "$_RS_BODY" || true)"
[[ "$_RS_VOLUP_COUNT" == "0" ]] || fail "record_start 里仍有 $_RS_VOLUP_COUNT 处裸 KEYCODE_VOLUME_UP(音量棘轮的病根,必须全部收进 ensure_media_volume)"
# ensure_media_volume 里读音量的命令替换必须带 || true：本脚本 set -euo pipefail,
# 函数内命令替换失败会直接打死整个进程,降级分支永远到不了(0924 code-review 实测复现:
# adb 读不到音量 → record-start 整条命令静默失败 → 判定退化 title-only 且无人察觉)。
_EMV_BODY="$(sed -n '/^ensure_media_volume()/,/^}/p' "$C")"
_EMV_RAW_READ="$(grep -c 'cur="\$(media_volume)"' <<< "$_EMV_BODY" || true)"
[[ "$_EMV_RAW_READ" == "0" ]] || fail "ensure_media_volume 里有 $_EMV_RAW_READ 处裸 \$(media_volume) 未带 || true(set -e 下读不到音量会打死整个控制器,降级分支失效)"
_DEVICE_LIST="$(sed -n '/^DEVICE_SH_FILES=(/,/^)/p' "$D/deploy.sh")"
grep -qE '(^|[[:space:]])douyin-phone-adb([[:space:]]|$)' <<< "$_DEVICE_LIST" || fail "deploy.sh 的 DEVICE_SH_FILES 漏了 douyin-phone-adb(改了控制器却到不了手机机)"

echo "phone-adb-controller-smoke: PASS"
