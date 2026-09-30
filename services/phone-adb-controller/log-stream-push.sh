#!/bin/zsh
# log-stream-push.sh v4 — 执行机实时推流到 MMV(任务 975aa6ec,决策 1220810b)
# v3(0916): 每行打机器标签防哨兵认错机;只 tail 存在的文件防 ==> 表头污染。
# v4(0930): 推送目标由 us-vps 宿主目录改为 MMV 本机 ~/.openclaw/m4-logs/——0921 网关迁 MMV 后 escort/stream
#   哨兵读的是 MMV 文件,而这里一直往 us-vps 写,MMV 那份停在 0918 快照,escort 据死文件判"日志停滞"自杀 58 次。
#   us-vps 那份不再维护。标签改用 zsh 逐行读写(不依赖 sed -u,保证逐行即时到达)。
# launchd: com.zenithjoy.logstreampush(KeepAlive);换版后必须 launchctl kickstart -k,运行中的进程读的是旧 inode。
# 环境变量(测试/定制): LSP_HOST 覆盖机器名 / LSP_SRC_DIR 源日志目录(默认 ~) / LSP_TARGET_HOST(默认 mmv)
#   / LSP_TARGET_DIR(默认 /Users/administrator/.openclaw/m4-logs) / LSP_RETRY_SLEEP 断线重连秒数(默认 15)
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
HOST="${LSP_HOST:-$(hostname -s | grep -qi m4 && echo xian-m4 || echo xian-m1)}"
SRC_DIR="${LSP_SRC_DIR:-$HOME}"
TARGET_HOST="${LSP_TARGET_HOST:-mmv}"
TARGET_DIR="${LSP_TARGET_DIR:-/Users/administrator/.openclaw/m4-logs}"
RETRY_SLEEP="${LSP_RETRY_SLEEP:-15}"
while true; do
  FILES=()
  [[ -f "$SRC_DIR/harvest-cron.log" ]] && FILES+=("$SRC_DIR/harvest-cron.log")
  [[ -f "$SRC_DIR/outreach.log" ]] && FILES+=("$SRC_DIR/outreach.log")
  if (( ${#FILES} == 0 )); then sleep 60; continue; fi
  tail -F -q -n0 $FILES 2>/dev/null \
    | while IFS= read -r line; do print -r -- "[$HOST] $line"; done \
    | ssh -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 "$TARGET_HOST" "cat >> $TARGET_DIR/${HOST}-live.log"
  sleep "$RETRY_SLEEP"
done
