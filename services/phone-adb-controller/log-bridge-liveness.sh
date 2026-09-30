#!/bin/bash
# log-bridge-liveness.sh —— MMV 日志桥活性守卫(任务 975aa6ec,决策 1220810b)。装在 mmv 本机 launchd 每 10 分钟跑。
#
# 根因: 执行机 xian-m4/xian-m1 的 log-stream-push.sh 实时推流到 MMV ~/.openclaw/m4-logs/<host>-live.log,
# escort/stream 哨兵靠它判 run 活性。09-18 起这两份文件死了 12 天没人知道,escort 据死文件判"日志停滞"自杀。
# 判据: 有 run 在跑(Brain workflow_run in_progress 含该机器,或 ssh 该机 pgrep 到执行链进程)且 live.log
#       超 LB_STALE_SEC(30 分钟)没更新 → Bark(同机器 LB_BARK_INTERVAL_SEC=1 小时内只发一次);
#       没 run 在跑的停更是正常空闲(IDLE),不吵。任何单点故障(Brain/ssh/Bark 不可达)都不崩,exit 0。
# 输出: 每台一行 "LIVENESS host=<h> age=<秒> running=<0|1> → OK|IDLE|STALE [bark=sent|suppressed|failed|no-token]"
#       末尾一行 "LOGBRIDGE_LIVENESS OK|STALE";launchd 日志 ~/Library/Logs/logbridge-liveness.log。
# Bark: source ~/.credentials/bark.env(export BARK_TOKEN=...)后 POST https://api.day.app/$BARK_TOKEN,token 绝不打印。
# proven-to-fire: LB_TITLE_PREFIX='[测试]' + 把 live.log mtime touch 旧 + 该机确有进程 → 真发一条测试 Bark。
#
# 环境变量(测试/定制): LB_LOG_DIR / LB_HOSTS / LB_STALE_SEC / LB_BARK_INTERVAL_SEC / LB_STATE_DIR
#   / LB_BRAIN_URL / LB_BARK_ENV / LB_BARK_URL_BASE / LB_TITLE_PREFIX
set -uo pipefail
# 追加而不是前置: 测试靠 PATH 首位的假 curl/ssh 拦外联,前置 /opt/homebrew/bin 会让 homebrew curl 抢先真打 Brain/真 ssh 执行机
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

LOG_DIR="${LB_LOG_DIR:-/Users/administrator/.openclaw/m4-logs}"
read -ra HOSTS <<< "${LB_HOSTS:-xian-m4 xian-m1}"
STALE_SEC="${LB_STALE_SEC:-1800}"
BARK_INTERVAL_SEC="${LB_BARK_INTERVAL_SEC:-3600}"
STATE_DIR="${LB_STATE_DIR:-$HOME/.logbridge-liveness}"
BRAIN_URL="${LB_BRAIN_URL:-http://localhost:5221}"
BARK_ENV="${LB_BARK_ENV:-$HOME/.credentials/bark.env}"
BARK_URL_BASE="${LB_BARK_URL_BASE:-https://api.day.app}"
TITLE_PREFIX="${LB_TITLE_PREFIX:-}"
# pgrep 用 [w] 括号法: 远端 sh -c 自己的 cmdline 也含模式串,不加括号必然自匹配成"在跑"
PGREP_PATTERN='[w]f-run.sh|[h]arvest-keyword.sh|[b]atch2.sh|[o]utreach-tick.sh|[d]iscover-keyword.sh'
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

now() { date +%s; }
# GNU stat 先(-c %Y);macOS 的 BSD stat 不认 -c 才退到 -f %m。顺序不能反: GNU 的 -f 是"文件系统信息",不报错但输出 "File: ..." 垃圾
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }
ts() { TZ=Asia/Shanghai date '+%F %T'; }

# Brain 在跑清单只拉一次;拉不到当空,由 pgrep 兜底
BRAIN_JSON="$(curl -s -m 8 "$BRAIN_URL/api/brain/tasks?status=in_progress&task_type=workflow_run&limit=50" 2>/dev/null || true)"

host_running() {
  local h="$1"
  if [[ -n "$BRAIN_JSON" ]] && grep -q "$h" <<< "$BRAIN_JSON"; then return 0; fi
  ssh "${SSH_OPTS[@]}" "$h" "pgrep -f '$PGREP_PATTERN' >/dev/null" 2>/dev/null
}

# bark <host> <age_sec>  → 打印 sent|suppressed|failed|no-token
bark() {
  local h="$1" age="$2" marker last token title body payload
  mkdir -p "$STATE_DIR"
  marker="$STATE_DIR/barked-$h"
  if [[ -f "$marker" ]]; then
    last="$(cat "$marker" 2>/dev/null || echo 0)"
    if (( $(now) - ${last:-0} < BARK_INTERVAL_SEC )); then echo suppressed; return; fi
  fi
  token=""
  if [[ -r "$BARK_ENV" ]]; then
    # shellcheck source=/dev/null
    token="$(BARK_TOKEN=""; . "$BARK_ENV" >/dev/null 2>&1; printf '%s' "${BARK_TOKEN:-}")"
  fi
  if [[ -z "$token" ]]; then echo no-token; return; fi
  title="${TITLE_PREFIX}日志桥停更 $h"
  if (( age < 0 )); then body="$h-live.log 不存在"; else body="$h-live.log 已 $((age / 60)) 分钟没有新条目"; fi
  body="$body,但该机有 run 在跑——escort 正在读死文件。查执行机 launchd com.zenithjoy.logstreampush(launchctl kickstart -k)与 ssh mmv 连通性。$(ts)"
  payload=$(printf '{"title":"%s","body":"%s","group":"leadgen","level":"timeSensitive"}' "$title" "$body")
  if curl -s -m 10 -X POST "$BARK_URL_BASE/$token" -H 'Content-Type: application/json; charset=utf-8' -d "$payload" 2>/dev/null | grep -q '"code":200'; then
    now > "$marker"
    echo sent
  else
    echo failed
  fi
}

overall=OK
for h in "${HOSTS[@]}"; do
  f="$LOG_DIR/$h-live.log"
  if [[ -f "$f" ]]; then age=$(( $(now) - $(mtime "$f") )); else age=-1; fi
  running=0
  if (( age < 0 || age > STALE_SEC )); then
    host_running "$h" && running=1
  fi
  if (( age >= 0 && age <= STALE_SEC )); then
    echo "[$(ts)] LIVENESS host=$h age=${age}s → OK"
  elif (( running == 0 )); then
    echo "[$(ts)] LIVENESS host=$h age=${age}s running=0 → IDLE(无 run 在跑,停更属正常)"
  else
    overall=STALE
    r="$(bark "$h" "$age")"
    echo "[$(ts)] LIVENESS host=$h age=${age}s running=1 → STALE bark=$r"
  fi
done
echo "LOGBRIDGE_LIVENESS $overall"
exit 0
