#!/bin/zsh
# escort-claude-escalation.sh — 三级响应第2级:哨兵搞不定→唤起 headless Claude 分身(0916主理人拍板)
# v2: account1(account2 OAuth过期) + claude -p 加 </dev/null(防偷吃tail管道stdin)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export CLAUDE_CONFIG_DIR=/Users/administrator/.claude-account1
LOG=~/escort-escalation.log
LOCK=/tmp/escort-claude-lock
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }

CONSTITUTION='你是获客Commander的Claude分身(三级响应第2级),stream哨兵处理不了的事件升级给你。你有有头Claude的全部能力,但受宪法约束(违反任何一条=角色失败):
1. 帮不拦:绝不终止业务流程、绝不删除任务/单据、无杀权——你的使命是把workflow救到终点,永远救活不弄死。
2. 先动手后汇报:白名单内(唤醒锁屏/清尸锁/重试瞬时失败/重推卡住的单步)直接做;拿不准=只取证不动手。
3. 读不到就说读不到,绝不根据缺失的信息编造结论(0913血教训)。
4. 不修改任何代码/配置文件——发现需要改代码的bug,把根因和修法写进报告留给白天有头session走PR。
5. 危险动作绝不做:删数据/docker重启生产容器/改DB schema/网络配置——只写进报告。
可用资源: ssh xian-m4(金诺采收机,日志~/harvest-cron.log,adb设备ANGYVB4227006983/ANGYVB4402004137) / ssh xian-m1(悦升机,adb e6c7ef34) / ssh us-vps(网关=docker exec openclaw-gateway openclaw ...,cron list/runs排查)。
排查铁律:先抓现场(日志尾30行/adb前台窗口/screencap)再判断,禁止猜。
收尾必做:把简报(事件/现场证据/动作/结果/剩余风险,10行内)追加到报告文件: ssh us-vps "cat >> /opt/openclaw/state/m4-logs/escalation-reports.log" 输入格式 [时间][分身] 内容。'

while true; do
  ssh -o ConnectTimeout=20 -o ServerAliveInterval=30 us-vps 'touch /opt/openclaw/state/m4-logs/escalation.log; tail -F -n0 /opt/openclaw/state/m4-logs/escalation.log' | while read -r LINE; do
    [[ -z "$LINE" ]] && continue
    if ! mkdir "$LOCK" 2>/dev/null; then log "分身占线,跳过(哨兵会重报): $LINE"; continue; fi
    log "唤起分身: $LINE"
    ( claude -p "$CONSTITUTION

升级事件: $LINE

现在开始处置。" --dangerously-skip-permissions --output-format text < /dev/null >> $LOG 2>&1
      log "分身收工: $LINE"
      sleep 60; rmdir "$LOCK" 2>/dev/null ) &
  done
  log "推流断开,15s重连"
  sleep 15
done
