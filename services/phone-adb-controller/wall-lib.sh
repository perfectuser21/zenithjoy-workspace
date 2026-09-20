#!/usr/bin/env bash
# wall-lib.sh — 机房手机可视化共用函数（bash 3.2 兼容；被 phone-wall-push.sh / wall-report.sh source）
# 配置文件 ~/.config/zenithjoy/wall.env: ZJ_API_BASE / ZJ_LICENSE / ZJ_INTERNAL_TOKEN
# 本库函数失败一律 return 非 0 不 exit；调用方若 set -e 须 `|| true`，绝不让可视化阻塞主流程
ZJ_WALL_ENV="${ZJ_WALL_ENV:-$HOME/.config/zenithjoy/wall.env}"
ZJ_WALL_STATE_DIR="${ZJ_WALL_STATE_DIR:-$HOME/.config/zenithjoy}"
ZJ_WALL_TMP="${ZJ_WALL_TMP:-/tmp/zj-wall}"
ZJ_WALL_LOG="${ZJ_WALL_LOG:-$HOME/phone-wall.log}"
ZJ_PROFILES_TSV="${ZJ_PROFILES_TSV:-$HOME/.config/openclaw/douyin-phone-profiles.tsv}"
ADB="${ADB:-adb}"
WALL_WIDTH="${WALL_WIDTH:-720}"   # 帧宽（px）。0920：控制塔屏幕区 360 CSS px × 2 倍屏 = 720，再低就糊
WALL_AGENTS_TSV="$ZJ_WALL_STATE_DIR/wall-agents.tsv"

wall_log() { printf '[%s] %s\n' "$(date +%m%d-%H:%M:%S)" "$*" >> "$ZJ_WALL_LOG" 2>/dev/null; }

# 读配置；缺文件或缺键 → 记日志返回 1（调用方自行 exit 0，绝不阻塞主流程）
wall_load_env() {
  [ -r "$ZJ_WALL_ENV" ] || { wall_log "缺配置 $ZJ_WALL_ENV"; return 1; }
  # shellcheck disable=SC1090
  . "$ZJ_WALL_ENV"
  [ -n "${ZJ_API_BASE:-}" ] && [ -n "${ZJ_LICENSE:-}" ] || { wall_log "wall.env 缺 ZJ_API_BASE/ZJ_LICENSE"; return 1; }
  ZJ_API_BASE="${ZJ_API_BASE%/}"
  mkdir -p "$ZJ_WALL_STATE_DIR" "$ZJ_WALL_TMP" 2>/dev/null
  return 0
}

# 取 JSON 路径值（a.b.c），空 → 空串
wall_json_get() {
  python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: d=None
for k in sys.argv[1].split("."):
    d=d.get(k) if isinstance(d,dict) else None
print("" if d is None else d)' "$1"
}

# profile → serial（~/.config/openclaw/douyin-phone-profiles.tsv 第1列 profile、第2列 serial）
wall_profile_serial() { awk -F'\t' -v p="$1" '$1==p{print $2; exit}' "$ZJ_PROFILES_TSV" 2>/dev/null; }

wall_cached_uuid() { awk -F'\t' -v s="$1" '$1==s{print $2; exit}' "$WALL_AGENTS_TSV" 2>/dev/null; }

# 原子写缓存：serial \t uuid \t phone-serial（同序列号只留一行）
# - 读-改-写必须串行：多台手机并发注册时各自读到旧文件再互相 mv 覆盖，只剩最后一行；
#   macOS 自带无 flock，用 POSIX 原子 mkdir 当锁（5s 拿不到视为陈旧锁清掉重试，只清 1 次；
#   再拿不到说明目录不存在/只读等根本建不了锁，放弃 return 1，不自旋卡住推帧主循环）
# - 临时文件用 mktemp 而不是 $$：bash 3.2 后台子进程里 $$ 仍是父进程 PID，会撞同一个 tmp
wall_cache_put() {
  local lock="$WALL_AGENTS_TSV.lock" tmp rc i=0 cleared=0
  until mkdir "$lock" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -ge 50 ]; then
      [ "$cleared" -eq 0 ] || { wall_log "cache 锁不可用 $lock"; return 1; }
      wall_log "cache 锁超时，清除陈旧锁 $lock"; rm -rf "$lock"; cleared=1; i=0
    fi
    sleep 0.1
  done
  tmp=$(mktemp "$WALL_AGENTS_TSV.XXXXXX") || { rmdir "$lock" 2>/dev/null; return 1; }
  { [ -f "$WALL_AGENTS_TSV" ] && awk -F'\t' -v s="$1" '$1!=s' "$WALL_AGENTS_TSV"
    printf '%s\t%s\tphone-%s\n' "$1" "$2" "$1"; } > "$tmp" && mv -f "$tmp" "$WALL_AGENTS_TSV"
  rc=$?
  rm -f "$tmp" 2>/dev/null
  rmdir "$lock" 2>/dev/null
  return $rc
}

# 注册兼心跳：POST /api/agent/register（服务端按 tenant+hostname 去重，故 hostname=phone-<serial> 每台唯一）
# 成功输出 uuid 并写缓存；失败返回 1
wall_register() {
  local serial="$1" body resp uuid
  body=$(python3 -c 'import json,sys; print(json.dumps({"license_key":sys.argv[1],"machine_id":sys.argv[2],"hostname":"phone-"+sys.argv[2],"agent_id":"phone-"+sys.argv[2],"version":"wall-1"}))' "$ZJ_LICENSE" "$serial")
  resp=$(curl -s -m 8 -X POST "$ZJ_API_BASE/api/agent/register" -H 'Content-Type: application/json' -d "$body") || { wall_log "register 网络失败 $serial"; return 1; }
  uuid=$(printf '%s' "$resp" | wall_json_get agent_id)
  case "$uuid" in
    ????????-????-????-????-????????????) wall_cache_put "$serial" "$uuid" || wall_log "cache 写失败 $serial"; printf '%s\n' "$uuid"; return 0 ;;
    *) wall_log "register $serial 未返回 uuid: $(printf '%s' "$resp" | head -c 200)"; return 1 ;;
  esac
}

# serial → uuid：缓存优先，否则注册
wall_uuid_for() {
  local u; u=$(wall_cached_uuid "$1")
  [ -n "$u" ] && { printf '%s\n' "$u"; return 0; }
  wall_register "$1"
}

# 缩图：in out width quality。默认 macOS sips；WALL_CONVERT_CMD 可注入（同 4 参）
# 必须按宽度重采样（--resampleWidth）：-Z 是"最长边"，竖屏 1200×2664 用 -Z 360 只会出 162×360，上墙就是一团糊（0920 实证）
wall_convert() {
  if [ -n "${WALL_CONVERT_CMD:-}" ]; then "$WALL_CONVERT_CMD" "$1" "$2" "$3" "$4"
  else sips --resampleWidth "$3" -s format jpeg -s formatOptions "$4" "$1" --out "$2" >/dev/null 2>&1; fi
}

# adb 带超时护栏（USB 半死时 adb 会无限挂起）：perl alarm 秒数后 SIGALRM 杀掉，macOS 自带 perl、bash 3.2 可用
# 包一层 {} 2>/dev/null 同时压掉调用方 shell 打印的 "Alarm clock: 14" 作业提示；adb 的 stderr 各调用点本就丢弃
wall_adb() { { perl -e 'alarm shift; exec @ARGV' "${WALL_ADB_TIMEOUT:-8}" "$ADB" "$@"; } 2>/dev/null; }

# 抓屏并压到 ≤max 字节：serial out max → 0 成功 / 1 抓屏失败 / 2 三级降质仍超限
# 阶梯 50/42/36 按 1200×2664 抓屏实测：720 宽约 88KB / 73KB / 64KB，都在服务端 120KB 上限内
# 中间 PNG 按输出名派生（o.jpg → o.png）且用完即删：推帧器每秒抓屏与报警截图若共用 cap-<serial>.png 会读到半截文件
wall_capture_jpeg() {
  local serial="$1" out="$2" max="$3" png="${2%.*}.png" q
  if ! wall_adb -s "$serial" exec-out screencap -p > "$png" || [ ! -s "$png" ]; then rm -f "$png"; return 1; fi
  for q in 50 42 36; do
    if ! wall_convert "$png" "$out" "$WALL_WIDTH" "$q"; then rm -f "$png"; return 1; fi
    if [ "$(wc -c < "$out" | tr -d ' ')" -le "$max" ]; then rm -f "$png"; return 0; fi
  done
  rm -f "$png" "$out" # 超限帧不留：文件存在 ⇔ 可发
  return 2
}

# 前台包名（mCurrentFocus=Window{... u0 <pkg>/<activity>}）；锁屏/无焦点时输出空串
wall_foreground_pkg() {
  wall_adb -s "$1" shell dumpsys window | grep -m1 mCurrentFocus | sed -n 's/.* \([a-zA-Z0-9_.]*\)\/.*/\1/p' | tr -d '\r'
}
