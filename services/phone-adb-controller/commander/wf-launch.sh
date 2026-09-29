#!/usr/bin/env bash
# wf-launch.sh —— Commander 发起一次 workflow run（决策 7f842d12：Commander 当入口，不再是脚本第⓪步）
#
# 形状：定时/对话 → Commander(work-commander) → 本脚本 → ①登记 escort 陪跑 → ②ssh 执行机 nohup wf-run.sh
#   → ③回读 WF_RUN_STARTED 确认起跑。run 收工时由 wf-run.sh 的 trap 注销 escort（--commander 传的就是 escort id）。
# 跑在网关机 MMV（openclaw CLI 在本机）；执行机只认 ssh 别名 xian-m4 / xian-m1。
#
# 用法:
#   wf-launch.sh <capability> <host> <profile> <serial> <biz> [--n N] [--push 0|1] [--sources "链接1,链接2"] [--dry-run]
# 输出（最后一行，供 Commander 读）:
#   WF_LAUNCHED tag=<TAG> host=<host> cap=<cap> serial=<serial> escort=<id|none> log=~/wf-logs/<TAG>.out
# 退出码: 0 已起跑 / 2 参数错 / 3 设备忙(已有 run 在跑) / 4 能力未部署到执行机 / 5 起跑失败
set -uo pipefail

OPENCLAW="${OPENCLAW:-openclaw}"
SSH_OPTS=(-o ConnectTimeout=20 -o BatchMode=yes)
FEISHU_TO="${WF_ESCORT_TO:-chat:oc_ef60d6e3f199d90dd695b6ecc213d662}"
ESCORT_SOP="${WF_ESCORT_SOP:-/Users/administrator/.openclaw/cmdr-escort.txt}"
START_WAIT="${WF_START_WAIT:-8}"

die(){ echo "wf-launch: $2" >&2; exit "$1"; }
# 远端 shell 单引号包裹（bash 3.2 的 printf %q 会把中文拆成八进制，不用它）
sq(){ local q=\' s="$1"; s="${s//$q/$q\\$q$q}"; printf "'%s'" "$s"; }
rsh(){ ssh "${SSH_OPTS[@]}" "$HOST" "$1"; }

[[ $# -ge 5 ]] || die 2 "用法: wf-launch.sh <capability> <host> <profile> <serial> <biz> [--n N] [--push 0|1] [--sources 列表] [--dry-run]"
CAP="$1"; HOST="$2"; PROFILE="$3"; SERIAL="$4"; BIZ="$5"; shift 5
N=6; PUSH=1; SOURCES=""; DRY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --n) N="${2:-}"; shift 2 ;;
    --push) PUSH="${2:-}"; shift 2 ;;
    --sources) SOURCES="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) die 2 "未知参数: $1" ;;
  esac
done
[[ "$CAP" =~ ^[a-z0-9_]+$ ]] || die 2 "capability 只允许 [a-z0-9_]: $CAP"
[[ "$HOST" == "xian-m4" || "$HOST" == "xian-m1" ]] || die 2 "host 只允许 xian-m4 / xian-m1: $HOST"
[[ "$PROFILE" =~ ^[A-Za-z0-9_.-]+$ ]] || die 2 "profile 非法: $PROFILE"
[[ "$SERIAL" =~ ^[A-Za-z0-9]+$ ]] || die 2 "serial 非法: $SERIAL"
[[ "$N" =~ ^[0-9]+$ && "$PUSH" =~ ^[01]$ ]] || die 2 "--n 须为整数、--push 须为 0/1"

TAG="cmd$(date +%m%d%H%M)"

# ① 能力已部署到执行机（plans/<cap>.env 由 wf-plan 生成、deploy 同步）
rsh "test -r ~/bin-harvest/plans/$CAP.env && test -x ~/bin-harvest/wf-run.sh" \
  || die 4 "$HOST 上没有 plans/$CAP.env 或 wf-run.sh（能力未部署/未组装通过）"
# ② 设备忙：同 serial 已有采收类 run 在跑 → 不叠跑（一机一单）
BUSY=$(rsh "pgrep -fl 'wf-run.sh .*$SERIAL|harvest-cron.sh .*$SERIAL' | grep -v pgrep | head -3" 2>/dev/null || true)
[[ -z "$BUSY" ]] || die 3 "设备 $SERIAL 正在跑: $(echo "$BUSY" | tr '\n' ' ' | head -c 200)"

SRC_ARGS=""
if [[ -n "$SOURCES" ]]; then
  SRC_FILE="~/wf-sources/$TAG.txt"
  if (( DRY == 0 )); then
    printf '%s\n' "$SOURCES" | awk '{gsub(/，|,/, "\n")} 1' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -v '^$' \
      | ssh "${SSH_OPTS[@]}" "$HOST" "mkdir -p ~/wf-sources && cat > $SRC_FILE" || die 5 "写入源列表失败"
  fi
  SRC_ARGS=" --sources $SRC_FILE"
fi

# ③ escort 陪跑（Commander 的「陪跑手」，SOP=cmdr-escort.txt；与旧 harvest-cron 同参数，拉起失败不阻塞）
ESCORT_ID=""
ESCORT_MSG="先读 $ESCORT_SOP 作为你的SOP并严格遵守辅佐三原则。本轮由 Commander 发起: cap=$CAP TAG=$TAG 机器=$HOST serial=$SERIAL profile=$PROFILE 起跑=$(date +%H:%M) 日志=/Users/administrator/.openclaw/m4-logs/${HOST}-live.log escort名=escort-$HOST-${TAG}。"
if (( DRY == 0 )); then
  for _try in 1 2 3; do
    ESCORT_ID=$("$OPENCLAW" cron add --timeout 90000 --name "escort-$HOST-$TAG" --agent media \
      --session "session:escort-$HOST-$TAG" --every 10m --announce --channel feishu --to "$FEISHU_TO" \
      --account main --best-effort-deliver --message "$ESCORT_MSG" 2>/dev/null \
      | grep -oE '"id": *"[a-f0-9-]+"' | head -1 | grep -oE '[a-f0-9-]{36}')
    [[ -n "$ESCORT_ID" ]] && break
    sleep "${WF_ESCORT_RETRY_SLEEP:-20}"
  done
  [[ -n "$ESCORT_ID" ]] || echo "wf-launch: escort 拉起 3 次失败，本批无陪跑（不阻塞）" >&2
fi

CMD="mkdir -p ~/wf-logs && nohup /bin/zsh ~/bin-harvest/wf-run.sh $CAP $PROFILE $SERIAL $(sq "$BIZ") $N $PUSH$SRC_ARGS --tag $TAG${ESCORT_ID:+ --commander $ESCORT_ID} > ~/wf-logs/$TAG.out 2>&1 < /dev/null & echo PID=\$!"
if (( DRY == 1 )); then
  echo "DRY_RUN host=$HOST cmd=$CMD"
  echo "WF_LAUNCHED tag=$TAG host=$HOST cap=$CAP serial=$SERIAL escort=dry log=~/wf-logs/$TAG.out"
  exit 0
fi

undo_escort(){ [[ -n "$ESCORT_ID" ]] && "$OPENCLAW" cron rm "$ESCORT_ID" >/dev/null 2>&1; true; }
rsh "$CMD" >/dev/null || { undo_escort; die 5 "ssh 起跑失败"; }
# ④ 回读起跑标记：nohup 后台启动 ssh 恒成功，没看到 WF_RUN_STARTED = 没起来（plan 校验失败/语法错）
sleep "$START_WAIT"
if ! rsh "grep -q WF_RUN_STARTED ~/wf-logs/$TAG.out"; then
  TAILLOG=$(rsh "tail -n 5 ~/wf-logs/$TAG.out" 2>/dev/null | tr '\n' ' ' | head -c 300)
  undo_escort
  die 5 "${START_WAIT}s 内未见 WF_RUN_STARTED，判定起跑失败: $TAILLOG"
fi
echo "WF_LAUNCHED tag=$TAG host=$HOST cap=$CAP serial=$SERIAL escort=${ESCORT_ID:-none} log=~/wf-logs/$TAG.out"
