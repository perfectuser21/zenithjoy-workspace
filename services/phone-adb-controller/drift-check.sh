#!/bin/bash
# drift-check.sh —— 获客脚本部署漂移对账(0929 补建, deploy.sh 的对账另一半)
#
# 根因: deploy.sh 只能人工一键触发,且部署后没有任何对账。09-27 有人只手拷了 xian-m4,
# xian-m1 跑了一整天旧版无人发现。GitHub Actions 连不到这几台内网机器,只能由 mmv 本机定时对账。
#
# 做法: 从 origin/main 上的 deploy.sh 解析应部署清单(MMV_JS_FILES / MMV_TOPLEVEL_FILES /
# DEVICE_SH_FILES / DEVICE_NODE_FILES / DEVICE_CTL_FILES × DEVICE_CTL_DIRS),逐个用
# `git show origin/main:<path>` 的 md5 对比三台机器上的实际文件(每台一次 ssh,路径相对 $HOME,
# 因此 xian-m4 的 /Users/jinnuoshengyuan 与 xian-m1 的 $HOME 天然适配)。
# 有不一致/缺失/连不上 → 经 mmv 上的 notify-bark.js 发 Bark(参数 base64,BARK_OK 判成败,
# 与 outreach-tick.sh notify() 同约定);同一组不一致当天只告警一次,发送失败不记 marker 下次重试。
#
# 用法:  bash drift-check.sh           对账,一致 exit 0 / 有漂移 exit 1 / 取清单失败 exit 2
#        bash drift-check.sh --list    只打印解析出的部署目标(host 相对路径 仓库文件名)
# 定时:  mmv 上 launchd 每天北京时间 09:30 跑一次,模板见 launchd/com.zenithjoy.leadgen-drift-check.plist
#
# 环境变量(测试/定制用):
#   DRIFT_REPO        只读 fetch 的仓库(默认 mmv 主仓库,只动 .git 引用不碰工作区)
#   DRIFT_REF         对账基准(默认 origin/main)   DRIFT_SKIP_FETCH=1 跳过 git fetch
#   DRIFT_STATE_DIR   告警去重 marker 目录          DRIFT_DATE 覆盖日期(YYYYMMDD,北京时间)
#   DRIFT_MMV_HOST / DRIFT_DEVICE_HOSTS / DRIFT_NOTIFY_HOST / DRIFT_NOTIFY_JS
set -uo pipefail

REPO="${DRIFT_REPO:-/Users/administrator/perfect21/zenithjoy-workspace}"
REF="${DRIFT_REF:-origin/main}"
SUBDIR="services/phone-adb-controller"
STATE_DIR="${DRIFT_STATE_DIR:-$HOME/.leadgen-drift-check}"
MMV_HOST="${DRIFT_MMV_HOST:-mmv}"
read -ra DEVICE_HOSTS <<< "${DRIFT_DEVICE_HOSTS:-xian-m4 xian-m1}"
NOTIFY_HOST="${DRIFT_NOTIFY_HOST:-mmv}"
NOTIFY_JS="${DRIFT_NOTIFY_JS:-/Users/administrator/.openclaw/leadgen-scripts/notify-bark.js}"
DATE_TAG="${DRIFT_DATE:-$(TZ=Asia/Shanghai date +%Y%m%d)}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

log() { printf '[%s] %s\n' "$(TZ=Asia/Shanghai date '+%F %T')" "$*" >&2; }

# parse_array <数组名> —— stdin 为 deploy.sh 文本;支持多行/单行数组,去掉行内注释
parse_array() {
  awk -v n="$1" '
    !f && index($0, n "=(") == 1 { f = 1; $0 = substr($0, length(n) + 3) }
    f { line = $0; sub(/#.*/, "", line); e = 0
        if (index(line, ")")) { line = substr(line, 1, index(line, ")") - 1); e = 1 }
        printf "%s ", line; if (e) exit }'
}

md5_stdin() {
  if command -v md5sum >/dev/null 2>&1; then md5sum | cut -d' ' -f1; else md5 -q; fi
}

# 输出部署目标: "<host> <相对 $HOME 的路径> <仓库文件名>"
list_targets() {
  local deploy f h d
  deploy="$(git -C "$REPO" show "$REF:$SUBDIR/deploy.sh" 2>/dev/null)" || { log "读不到 $REF:$SUBDIR/deploy.sh"; return 2; }
  local -a js top sh node ctl dirs
  read -ra js <<< "$(parse_array MMV_JS_FILES <<< "$deploy")"
  read -ra top <<< "$(parse_array MMV_TOPLEVEL_FILES <<< "$deploy")"
  read -ra sh <<< "$(parse_array DEVICE_SH_FILES <<< "$deploy")"
  read -ra node <<< "$(parse_array DEVICE_NODE_FILES <<< "$deploy")"
  read -ra ctl <<< "$(parse_array DEVICE_CTL_FILES <<< "$deploy")"
  read -ra dirs <<< "$(parse_array DEVICE_CTL_DIRS <<< "$deploy")"
  if (( ${#js[@]} == 0 || ${#sh[@]} == 0 || ${#ctl[@]} == 0 || ${#dirs[@]} == 0 )); then
    log "deploy.sh 清单解析为空(数组被改名/改形状?),拒绝给出假绿"; return 2
  fi
  for f in "${js[@]}"; do echo "$MMV_HOST .openclaw/leadgen-scripts/$f $f"; done
  for f in ${top[@]+"${top[@]}"}; do echo "$MMV_HOST .openclaw/$f $f"; done
  for h in "${DEVICE_HOSTS[@]}"; do
    for f in "${sh[@]}" ${node[@]+"${node[@]}"}; do echo "$h bin-harvest/$f $f"; done
    for f in "${ctl[@]}"; do
      for d in "${dirs[@]}"; do echo "$h $d/$f $f"; done
    done
  done
}

# 远端: stdin 逐行读相对路径,输出 "<md5> <path>" 或 "MISSING <path>",末尾打结束标记证明 ssh 真跑完了
REMOTE_MD5='while IFS= read -r p; do if [ -f "$p" ]; then if command -v md5 >/dev/null 2>&1; then m=$(md5 -q "$p"); else m=$(md5sum "$p" | cut -d" " -f1); fi; echo "$m $p"; else echo "MISSING $p"; fi; done; echo __DRIFT_END__'

notify() {
  local tb bb out
  tb=$(printf '%s' "$1" | base64 | tr -d '\n')
  bb=$(printf '%s' "$2" | base64 | tr -d '\n')
  out=$(ssh "${SSH_OPTS[@]}" "$NOTIFY_HOST" "node $NOTIFY_JS $tb $bb timeSensitive" 2>/dev/null)
  [[ "$out" == *BARK_OK* ]]
}

main() {
  if [[ "${DRIFT_SKIP_FETCH:-}" != "1" ]]; then
    git -C "$REPO" fetch -q origin main 2>/dev/null || log "git fetch 失败,用本地已有的 $REF 对账"
  fi
  local targets
  targets="$(list_targets)" || exit 2
  if [[ "${1:-}" == "--list" ]]; then printf '%s\n' "$targets"; exit 0; fi

  local commit; commit="$(git -C "$REPO" rev-parse --short "$REF")"
  # launchd 下是 /bin/bash 3.2,没有关联数组——期望/实际 md5 全部落临时文件,用 awk 连接比对
  local work; work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  local f
  awk '{print $3}' <<< "$targets" | sort -u | while read -r f; do
    echo "$f $(git -C "$REPO" show "$REF:$SUBDIR/$f" 2>/dev/null | md5_stdin)"
  done > "$work/want"

  local total=0 hosts h paths out line
  : > "$work/problems"
  hosts="$(awk '!s[$1]++ {print $1}' <<< "$targets")"
  for h in $hosts; do
    paths="$(awk -v h="$h" '$1 == h {print $2}' <<< "$targets")"
    total=$((total + $(grep -c . <<< "$paths")))
    out="$(ssh "${SSH_OPTS[@]}" "$h" "$REMOTE_MD5" <<< "$paths" 2>/dev/null)"
    if [[ "$out" != *__DRIFT_END__* ]]; then
      echo "UNREACHABLE $h" >> "$work/problems"
      continue
    fi
    grep -v '^__DRIFT_END__$' <<< "$out" > "$work/got"
    awk -v h="$h" '$1 == h' <<< "$targets" > "$work/tg"
    awk -v h="$h" '
      FILENAME == ARGV[1] { want[$1] = $2; next }
      FILENAME == ARGV[2] { if ($1 == "MISSING") miss[$2] = 1; else got[$2] = $1; next }
      { p = $2; f = $3
        if ((p in miss) || !(p in got)) print "MISSING " h ":" p
        else if (got[p] != want[f]) print "DRIFT " h ":" p }
    ' "$work/want" "$work/got" "$work/tg" >> "$work/problems"
  done
  local -a problems=()
  while IFS= read -r line; do [[ -n "$line" ]] && problems+=("$line"); done < "$work/problems"

  if (( ${#problems[@]} == 0 )); then
    echo "DRIFT_CHECK OK ref=$commit files=$total hosts=$(echo $hosts | tr ' ' ',')"
    exit 0
  fi

  printf '%s\n' "${problems[@]}"
  echo "DRIFT_CHECK FAIL ref=$commit problems=${#problems[@]} files=$total"

  mkdir -p "$STATE_DIR"
  find "$STATE_DIR" -name 'alerted-*' -mtime +7 -delete 2>/dev/null
  local sig marker
  sig="$(printf '%s\n' "${problems[@]}" | sort | md5_stdin | cut -c1-12)"
  marker="$STATE_DIR/alerted-$DATE_TAG-$sig"
  if [[ -e "$marker" ]]; then
    log "同一组不一致今天已告警过($marker),不重发"
    exit 1
  fi
  local body shown
  shown="$(printf '%s\n' "${problems[@]}" | head -8 | tr '\n' ';')"
  (( ${#problems[@]} > 8 )) && shown+=" 等共${#problems[@]}处"
  body="对账基准 origin/main@${commit}: ${shown} 修复: 在交互机仓库根目录跑 bash $SUBDIR/deploy.sh"
  if notify "获客脚本部署漂移(${#problems[@]}处)" "$body"; then
    : > "$marker"
    log "已发 Bark 告警"
  else
    log "Bark 告警发送失败,不记 marker,下次重试"
  fi
  exit 1
}

main "$@"
