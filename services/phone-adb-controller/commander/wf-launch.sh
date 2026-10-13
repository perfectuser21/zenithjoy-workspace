#!/usr/bin/env bash
# wf-launch.sh —— Commander 发起一次 workflow run（决策 7f842d12：Commander 当入口，不再是脚本第⓪步）
#
# 形状：定时/对话 → Commander(work-commander) → 本脚本 → ①登记 escort 陪跑 → ②ssh 执行机 nohup wf-run.sh
#   → ③回读 WF_RUN_STARTED 确认起跑。run 收工时由 wf-run.sh 的 trap 注销 escort（--commander 传的就是 escort id）。
# 跑在网关机 MMV（openclaw CLI 在本机）；执行机只认 ssh 别名 xian-m4 / xian-m1。
#
# 用法:
#   wf-launch.sh <capability> <host> <profile> <serial> <biz> [--n N] [--push 0|1] [--sources "链接1,链接2"] [--allow-missing] [--dry-run]
#               [--run-id RUN --task-id TASK]（Brain workflow_dispatch 派发单必带；codex_agent 形态必填，获客 wf-run 形态忽略）
# 输出（最后一行，供 Commander 读）:
#   WF_LAUNCHED tag=<TAG> host=<host> cap=<cap> serial=<serial> escort=<id|none> log=~/wf-logs/<TAG>.out
# 两种形态（按 commander/workflow-contracts.json 的 execution_profile 分）：
#   获客 wf-run 形态（plans/<cap>.plan）：escort 陪跑 + ssh 执行机 nohup wf-run.sh（下文 ①~④）
#   codex_agent 形态（任务 c0fe7e30，决策 2186700a）：MMV 独立会话 wf-agent-run.sh = 共享外壳准备 → Codex 业务块 → 共享外壳收尾，
#     不起 escort（Commander 本会话陪跑到终态），输出 host=mmv，状态用 wf-status.sh mmv <TAG> 查
# 退出码: 0 已起跑 / 2 参数错 / 3 设备忙(已有 run 在跑) / 4 能力未部署到执行机 / 5 起跑失败
set -uo pipefail

if [[ "${1:-}" == "--ready" || "${1:-}" == "--envelope" ]]; then
  exec python3 "$(cd "$(dirname "$0")" && pwd)/wf-v2.py" launch "$@"
fi

OPENCLAW="${OPENCLAW:-openclaw}"
SSH_OPTS=(-o ConnectTimeout=20 -o BatchMode=yes)
# 陪跑不投递飞书（决策 c7ff6e02）：运行记录进 Brain runs → Notion「最近执行」
ESCORT_SOP="${WF_ESCORT_SOP:-/Users/administrator/.openclaw/cmdr-escort.txt}"
START_WAIT="${WF_START_WAIT:-8}"
# Brain 心跳/起跑登记入口（决策 3c98fb36 阶段1，任务 17ea4536）：网关 localhost:5221 是 socat 到 us-vps Brain 的代理
BRAIN_URL="${WF_BRAIN_URL:-http://localhost:5221}"

die(){ echo "wf-launch: $2" >&2; exit "$1"; }
# 远端 shell 单引号包裹（bash 3.2 的 printf %q 会把中文拆成八进制，不用它）
sq(){ local q=\' s="$1"; s="${s//$q/$q\\$q$q}"; printf "'%s'" "$s"; }
rsh(){ ssh "${SSH_OPTS[@]}" "$HOST" "$1"; }

[[ $# -ge 5 ]] || die 2 "用法: wf-launch.sh <capability> <host> <profile> <serial> <biz> [--n N] [--push 0|1] [--sources 列表] [--allow-missing] [--dry-run]"
CAP="$1"; HOST="$2"; PROFILE="$3"; SERIAL="$4"; BIZ="$5"; shift 5
N=6; PUSH=1; SOURCES=""; DRY=0; ALLOW_MISSING=""; RUN_ID=""; TASK_ID=""; PARENT_SESSION="${WF_PARENT_SESSION_KEY:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --n) N="${2:-}"; shift 2 ;;
    --push) PUSH="${2:-}"; shift 2 ;;
    --sources) SOURCES="${2:-}"; shift 2 ;;
    --allow-missing) ALLOW_MISSING=" --allow-missing"; shift ;;  # 契约有未实现步骤仍跑(真机调试用)
    --dry-run) DRY=1; shift ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --task-id) TASK_ID="${2:-}"; shift 2 ;;
    --parent-session) PARENT_SESSION="${2:-}"; shift 2 ;;
    *) die 2 "未知参数: $1" ;;
  esac
done
[[ "$CAP" =~ ^[a-z0-9_]+$ ]] || die 2 "capability 只允许 [a-z0-9_]: $CAP"
[[ "$HOST" == "xian-m4" || "$HOST" == "xian-m1" ]] || die 2 "host 只允许 xian-m4 / xian-m1: $HOST"
[[ "$PROFILE" =~ ^[A-Za-z0-9_.-]+$ ]] || die 2 "profile 非法: $PROFILE"
[[ "$SERIAL" =~ ^[A-Za-z0-9]+$ ]] || die 2 "serial 非法: $SERIAL"
[[ "$N" =~ ^[0-9]+$ && "$PUSH" =~ ^[01]$ ]] || die 2 "--n 须为整数、--push 须为 0/1"

# 网关 MMV 系统时区是美西(us-mac 约定 LA),TAG/起跑时间一律按北京时间,与执行机日志、采收时窗对得上
bj(){ TZ=Asia/Shanghai date "$@"; }
TAG="cmd$(bj +%m%d%H%M)"

# ⓪ 形态判定：codex_agent 合同走 MMV 本机外壳 runner（合同清单由 gen-commander-contracts.mjs 生成、deploy 同步）
HERE="$(cd "$(dirname "$0")" && pwd)"
CONTRACTS_JSON="${WF_CONTRACTS_JSON:-$HERE/workflow-contracts.json}"
AGENT_RUNNER="${WF_AGENT_RUNNER:-$HERE/wf-agent-run.sh}"
EXEC_PROFILE="$(python3 "$HERE/wf-agent-lib.py" profile "$CONTRACTS_JSON" "$CAP" 2>/dev/null || true)"
if [[ "$EXEC_PROFILE" == codex_agent ]]; then
  [[ "$RUN_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$ && "$TASK_ID" =~ ^[0-9a-f-]{36}$ ]] \
    || die 2 "codex_agent 形态须由 Brain 派发单带 --run-id <run> --task-id <uuid>（缺或非法）"
  [[ "$PARENT_SESSION" == agent:work-commander:* ]] || die 2 "codex_agent 须带 Commander 父会话 --parent-session"
  [[ -x "$AGENT_RUNNER" ]] || die 4 "MMV 上没有 ${AGENT_RUNNER}（codex_agent 外壳未部署）"
  LBUSY=$(pgrep -fl "wf-agent-run.sh .* $SERIAL " 2>/dev/null | grep -v pgrep | head -3 || true)
  [[ -z "$LBUSY" ]] || die 3 "设备 $SERIAL 正在跑: $(echo "$LBUSY" | tr '\n' ' ' | head -c 200)"
  RBUSY=$(rsh "pgrep -fl 'wf-run.sh .*$SERIAL|harvest-cron.sh .*$SERIAL' | grep -v pgrep | head -3" 2>/dev/null || true)
  [[ -z "$RBUSY" ]] || die 3 "设备 $SERIAL 正在跑: $(echo "$RBUSY" | tr '\n' ' ' | head -c 200)"
  if (( DRY == 1 )); then
    echo "DRY_RUN host=mmv profile=codex_agent runner=$AGENT_RUNNER run_id=$RUN_ID task_id=$TASK_ID"
    echo "WF_LAUNCHED tag=$TAG host=mmv cap=$CAP serial=$SERIAL escort=dry run_id=$RUN_ID profile=codex_agent log=~/wf-logs/$TAG.out"
    exit 0
  fi
  mkdir -p "$HOME/wf-logs"
  # gateway_exec 返回时会清理调用进程组；nohup 只屏蔽 HUP，不能抵挡组 SIGKILL。
  # 外壳必须拥有独立 session/进程组，才能继续执行业务和自己的 trap 收尾。
  python3 - "$HOME/wf-logs/$TAG.out" "$AGENT_RUNNER" "$CAP" "$HOST" "$PROFILE" "$SERIAL" "$BIZ" --tag "$TAG" --run-id "$RUN_ID" --task-id "$TASK_ID" --parent-session "$PARENT_SESSION" <<'PY' \
    || die 5 "MMV 独立会话外壳启动失败"
import subprocess
import sys

with open(sys.argv[1], "wb") as log:
    subprocess.Popen(["bash", *sys.argv[2:]], stdin=subprocess.DEVNULL,
                     stdout=log, stderr=subprocess.STDOUT,
                     start_new_session=True, close_fds=True)
PY
  sleep "$START_WAIT"
  grep -q WF_RUN_STARTED "$HOME/wf-logs/$TAG.out" 2>/dev/null \
    || die 5 "${START_WAIT}s 内未见 WF_RUN_STARTED，判定起跑失败: $(tail -n 5 "$HOME/wf-logs/$TAG.out" 2>/dev/null | tr '\n' ' ' | head -c 300)"
  echo "WF_LAUNCHED tag=$TAG host=mmv cap=$CAP serial=$SERIAL escort=none run_id=$RUN_ID profile=codex_agent log=~/wf-logs/$TAG.out"
  exit 0
fi

# ① 能力已部署到执行机（plans/<cap>.plan 由 wf-plan 生成、deploy 同步）
rsh "test -r ~/bin-harvest/plans/$CAP.plan && test -x ~/bin-harvest/wf-run.sh" \
  || die 4 "$HOST 上没有 plans/$CAP.plan 或 wf-run.sh（能力未部署/未组装通过）"
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
ESCORT_MSG="先读 $ESCORT_SOP 作为你的SOP并严格遵守辅佐三原则。本轮由 Commander 发起: cap=$CAP TAG=$TAG 机器=$HOST serial=$SERIAL profile=$PROFILE 起跑=$(bj +%H:%M) 日志=/Users/administrator/.openclaw/m4-logs/${HOST}-live.log escort名=escort-$HOST-${TAG}。每轮末尾必须发心跳(SOP 第5条): curl -s -m 8 -X POST $BRAIN_URL/api/brain/commander-heartbeat -H 'Content-Type: application/json' -d '{\"tag\":\"$TAG\",\"host\":\"$HOST\",\"serial\":\"$SERIAL\",\"escort_name\":\"escort-$HOST-$TAG\"}'"
# 起跑登记（best-effort，Brain 单此刻还没建）：escort id 落 Brain working_memory commander_launch:<TAG>，
# 心跳/看门狗/lost 善后随后合并进单。失败只记 stderr，绝不阻塞起跑。
brain_launch_register(){
  [[ -n "$ESCORT_ID" ]] || return 0
  curl -s -m 5 -o /dev/null -X POST "$BRAIN_URL/api/brain/commander-heartbeat" -H 'Content-Type: application/json' \
    -d "{\"kind\":\"launch\",\"tag\":\"$TAG\",\"host\":\"$HOST\",\"serial\":\"$SERIAL\",\"profile\":\"$PROFILE\",\"cap\":\"$CAP\",\"escort_name\":\"escort-$HOST-$TAG\",\"escort_id\":\"$ESCORT_ID\"}" \
    || echo "wf-launch: Brain 起跑登记未成（不阻塞）" >&2
  true
}
if (( DRY == 0 )); then
  for _try in 1 2 3; do
    ESCORT_ID=$("$OPENCLAW" cron add --timeout 90000 --name "escort-$HOST-$TAG" --agent media \
      --session "session:escort-$HOST-$TAG" --every 10m --no-deliver --message "$ESCORT_MSG" 2>/dev/null \
      | grep -oE '"id": *"[a-f0-9-]+"' | head -1 | grep -oE '[a-f0-9-]{36}')
    [[ -n "$ESCORT_ID" ]] && break
    sleep "${WF_ESCORT_RETRY_SLEEP:-20}"
  done
  [[ -n "$ESCORT_ID" ]] || echo "wf-launch: escort 拉起 3 次失败，本批无陪跑（不阻塞）" >&2
fi

CMD="mkdir -p ~/wf-logs && nohup /bin/zsh ~/bin-harvest/wf-run.sh $CAP $PROFILE $SERIAL $(sq "$BIZ") $N $PUSH$SRC_ARGS$ALLOW_MISSING --tag $TAG${ESCORT_ID:+ --commander $ESCORT_ID} > ~/wf-logs/$TAG.out 2>&1 < /dev/null & echo PID=\$!"
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
brain_launch_register
echo "WF_LAUNCHED tag=$TAG host=$HOST cap=$CAP serial=$SERIAL escort=${ESCORT_ID:-none} log=~/wf-logs/$TAG.out"
