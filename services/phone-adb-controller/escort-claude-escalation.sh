#!/bin/zsh
# escort-claude-escalation.sh — 三级响应第2级:哨兵搞不定→唤起 headless Claude 分身(0916主理人拍板)。跑在 mmv 本机 launchd com.zenithjoy.escortclaude。
# v2: account1(account2 OAuth过期) + claude -p 加 </dev/null(防偷吃tail管道stdin)
# v3(0930,任务 975aa6ec): 升级文件统一到 MMV 本机 ~/.openclaw/m4-logs/escalation.log——0921 网关迁 MMV 后 escort/stream
#   哨兵(跑在 MMV 网关)把升级行写到 MMV 文件,而这里还 ssh us-vps tail 宿主文件,两边各写各读,升级行无人接管。
#   现在直接 tail 本机文件,零 ssh;分身简报也落本机 escalation-reports.log。由 deploy.sh(MMV_BIN_FILES)同步到 ~/bin/,
#   换版后 deploy.sh 自动 launchctl kickstart -k。
# 环境变量(测试/定制): ESC_LOG_DIR(默认 ~/.openclaw/m4-logs) / ESC_LOG / ESC_LOCK / ESC_RECONNECT_SLEEP / ESC_COOLDOWN(分身收工后冷却秒)
# 追加而不是前置: 测试靠 PATH 首位的假 claude 拦真唤起
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-/Users/administrator/.claude-account1}"
LOG_DIR="${ESC_LOG_DIR:-$HOME/.openclaw/m4-logs}"
ESC_FILE="$LOG_DIR/escalation.log"
REPORTS_FILE="$LOG_DIR/escalation-reports.log"
LOG="${ESC_LOG:-$HOME/escort-escalation.log}"
LOCK="${ESC_LOCK:-/tmp/escort-claude-lock}"
RECONNECT_SLEEP="${ESC_RECONNECT_SLEEP:-15}"
COOLDOWN="${ESC_COOLDOWN:-60}"
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }

CONSTITUTION='你是获客Commander的Claude分身(三级响应第2级),stream哨兵处理不了的事件升级给你。你有有头Claude的全部能力,但受宪法约束(违反任何一条=角色失败):
1. 帮不拦:绝不终止业务流程、绝不删除任务/单据、无杀权——你的使命是把workflow救到终点,永远救活不弄死。
2. 先动手后汇报:白名单内(唤醒锁屏/清尸锁/重试瞬时失败/重推卡住的单步)直接做;拿不准=只取证不动手。
3. 读不到就说读不到,绝不根据缺失的信息编造结论(0913血教训)。
4. 不修改任何代码/配置文件——发现需要改代码的bug,把根因和修法写进报告留给白天有头session走PR。
5. 危险动作绝不做:删数据/改DB schema/改网络配置/重启**健康**容器——只写进报告。
   例外-救活权(0916拍板): 重启**已确认死亡**(exited)或持续unhealthy的容器属于救活不属于危险,允许做,但必须①先取证(docker inspect状态+日志尾,写进报告)②只对确已停摆的目标动手,健康容器一律不碰③重启后回读验证并写报告。依据:使命是永远救活不弄死;0916网关死6小时无人救导致三批连环夭折。
可用资源: ssh xian-m4(金诺采收机,日志~/harvest-cron.log,adb设备ANGYVB4227006983/ANGYVB4402004137) / ssh xian-m1(悦升机,adb e6c7ef34) / 本机=mmv(网关=openclaw ...原生调用,cron list/runs排查;0921起us-vps那份openclaw-gateway容器已退役,不要再往那边打)。双机实时日志在本机 '"$LOG_DIR"'/xian-m4-live.log 与 xian-m1-live.log。
排查铁律:先抓现场(日志尾30行/adb前台窗口/screencap)再判断,禁止猜。
收尾必做:把简报(事件/现场证据/动作/结果/剩余风险,10行内)追加到本机报告文件 '"$REPORTS_FILE"' 输入格式 [时间][分身] 内容。'

mkdir -p "$LOG_DIR"
while true; do
  touch "$ESC_FILE"
  tail -F -n0 "$ESC_FILE" 2>/dev/null | while read -r LINE; do
    [[ -z "$LINE" ]] && continue
    if ! mkdir "$LOCK" 2>/dev/null; then log "分身占线,跳过(哨兵会重报): $LINE"; continue; fi
    log "唤起分身: $LINE"
    ( claude -p "$CONSTITUTION

升级事件: $LINE

现在开始处置。" --dangerously-skip-permissions --output-format text < /dev/null >> $LOG 2>&1
      log "分身收工: $LINE"
      sleep "$COOLDOWN"; rmdir "$LOCK" 2>/dev/null ) &
  done
  log "tail 断开,${RECONNECT_SLEEP}s 重挂"
  sleep "$RECONNECT_SLEEP"
done
