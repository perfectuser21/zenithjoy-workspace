#!/bin/zsh
# 297d7f32：设备锁真身；由控制器加载，部署到两个执行目录。
PHONE_LOCK_HELPER="${0:A:h}/phone-lock-helper.py"
PHONE_CTL="${0:A:h}/douyin-phone-adb"

lock_pid_live() {
  local pid
  [[ -r "$LOCK_DIR/pid" ]] || return 1
  pid="$(<"$LOCK_DIR/pid")"
  [[ "$pid" == <-> ]] && (( pid > 1 )) && kill -0 "$pid" 2>/dev/null
}
lock_age() {
  local ts=""
  [[ -r "$LOCK_DIR/acquired_at" ]] && ts="$(<"$LOCK_DIR/acquired_at")"
  if [[ "$ts" == <-> ]]; then print -- "$(( $(/bin/date +%s) - ts ))"; else print -- '?'; fi
}
lock_acquire() {
  local run="$(normalize_run_id "$1")" owner='unknown'
  require_run_id "$1"
  /bin/mkdir -p "$LOCK_ROOT"
  if [[ -d "$LOCK_DIR" ]]; then
    [[ ! -f "$LOCK_DIR/standalone_review_required" ]] || die 'standalone lock requires verified cleanup; adoption and stale reclaim refused'
    [[ "${2:-compatible}" != fresh ]] || die 'fresh acquisition refused: existing lock must not be adopted or reclaimed'
    [[ -r "$LOCK_DIR/owner" ]] && owner="$(<"$LOCK_DIR/owner")"
    if same_run_lock "$owner" "$run"; then
      print -- "lock=held owner=$owner idempotent=true"
      return 0
    fi
    if lock_is_stale && ! lock_pid_live; then
      print -u2 -- "warning: reclaiming stale lock (prev owner=$owner)"
      /bin/rm -rf "$LOCK_DIR"
    else
      die "lock is held by another run: $owner age=$(lock_age)s/ttl=${LOCK_TTL_SECONDS}s"
    fi
  fi
  /bin/mkdir "$LOCK_DIR" || die 'could not acquire device lock'
  print -r -- "$run" > "$LOCK_DIR/owner"
  [[ "${2:-compatible}" != fresh ]] || print -r -- "$run" > "$LOCK_DIR/standalone_review_required"
  /bin/date +%s > "$LOCK_DIR/acquired_at"
  if [[ "${DOUYIN_LOCK_PID:-}" == <-> ]]; then print -r -- "$DOUYIN_LOCK_PID" > "$LOCK_DIR/pid"; fi
  print -- "lock=acquired owner=$run"
}
lock_release() {
  local run="$(normalize_run_id "$1")" owner
  require_run_id "$1"
  [[ -r "$LOCK_DIR/owner" ]] || { print -- 'lock=free'; return 0; }
  [[ ! -f "$LOCK_DIR/standalone_review_required" || "${2:-compatible}" == exact ]] || die 'standalone lock requires exact verified release'
  owner="$(<"$LOCK_DIR/owner")"
  if [[ "${2:-compatible}" == exact ]]; then
    "$PYTHON_BIN" "$PHONE_LOCK_HELPER" owner-check "$LOCK_DIR/owner" "$1" || die "refusing exact release: owner changed to $owner"
  else
    same_run_lock "$owner" "$run" || die "refusing to release lock owned by another run: $owner"
  fi
  /bin/rm -rf "$LOCK_DIR"
  print -- "lock=released owner=$run"
}
lock_cleanup() {
  # wrapper 同 run 前缀并非退出所有权凭证；以精确 owner+PID 复验。
  local expected="$1" expected_pid="$2"
  [[ ! -f "$LOCK_DIR/standalone_review_required" ]] || die 'standalone lock cannot use wrapper cleanup'
  [[ -r "$LOCK_DIR/owner" && -r "$LOCK_DIR/pid" ]] || return 0
  [[ "$(<"$LOCK_DIR/owner")" == "$expected" && "$(<"$LOCK_DIR/pid")" == "$expected_pid" ]] || {
    print -u2 -- 'lock cleanup skipped: ownership changed'; return 0
  }
  local rc=0
  /bin/zsh "$PHONE_CTL" --profile "$PROFILE" close-app || rc=$?
  lock_release "$expected"
  return "$rc"
}
lock_reap() {
  local owner reason
  [[ -r "$LOCK_DIR/owner" ]] || { print -- 'lock=free'; return 0; }
  owner="$(<"$LOCK_DIR/owner")"
  if [[ -f "$LOCK_DIR/standalone_review_required" ]]; then
    print -- "lock=preserved owner=$owner reason=standalone-review-required"; return 0
  fi
  if ! lock_is_stale || lock_pid_live; then
    print -- "lock=preserved owner=$owner reason=fresh-or-live-pid"; return 0
  fi
  # 整个检查/清场/释放保持 flock；并发 acquire/refresh/release 均不能改锁。
  if ! reason="$("$PYTHON_BIN" "$PHONE_LOCK_HELPER" safe-to-reap "$owner" "$SERIAL" "$PROFILE")"; then
    print -- "lock=preserved owner=$owner reason=$reason"; return 0
  fi
  if ! /bin/zsh "$PHONE_CTL" --profile "$PROFILE" close-app; then
    print -- "lock=preserved owner=$owner reason=cleanup-failed"; return 0
  fi
  /bin/rm -rf "$LOCK_DIR"
  print -- "lock=reaped owner=$owner reason=$reason"
}
with_lock() {
  [[ "$#" -ge 3 && "$2" == '--' ]] || die 'usage: douyin-phone-adb --profile PROFILE with-lock OWNER -- COMMAND [ARGS...]'
  local run="$(normalize_run_id "$1")" rc=0
  require_run_id "$1"
  shift 2
  # 同run的旧锁不能用前缀互认偷走另一个有头会话的退出清理权。
  DOUYIN_LOCK_PID="$$" /bin/zsh "$PHONE_CTL" --profile "$PROFILE" lock-acquire "$run"
  [[ -r "$LOCK_DIR/pid" && "$(<"$LOCK_DIR/pid")" == "$$" ]] || die 'with-lock requires an exclusively owned lock'
  WRAP_OWNER="$run"; WRAP_PID="$$"; WRAP_CHILD=''; WRAP_DONE=0
  wrapper_cleanup() {
    (( WRAP_DONE )) && return 0
    WRAP_DONE=1
    /bin/zsh "$PHONE_CTL" --profile "$PROFILE" lock-cleanup "$WRAP_OWNER" "$WRAP_PID" || print -u2 -- 'warning: close-app cleanup failed'
  }
  wrapper_stop() {
    # 信号可夹在fork和WRAP_CHILD赋值之间；$!补齐刚启动的孩子。
    local child="${WRAP_CHILD:-${!:-}}"
    [[ "$child" == <-> ]] || return 0
    "$PYTHON_BIN" "$PHONE_LOCK_HELPER" stop "$child" "$WRAP_PID" || true
    wait "$child" 2>/dev/null || true
  }
  TRAPEXIT() { wrapper_cleanup; }
  TRAPTERM() { wrapper_stop; wrapper_cleanup; exit 143; }
  TRAPINT() { wrapper_stop; wrapper_cleanup; exit 130; }
  "$PYTHON_BIN" "$PHONE_LOCK_HELPER" run "$@" &
  WRAP_CHILD=$!
  wait "$WRAP_CHILD" || rc=$?
  exit "$rc"
}
phone_lock_command() {
  local cmd="$1"
  if [[ "$cmd" != 'with-lock' && "$cmd" != 'lock-status' && "${DOUYIN_LOCK_GUARDED:-}" != "$SERIAL:$cmd" ]]; then
    exec "$PYTHON_BIN" "$PHONE_LOCK_HELPER" guard "$LOCK_ROOT/${SERIAL}.guard" "$SERIAL" "$cmd" "$PHONE_CTL" "$PROFILE" "${@:2}"
  fi
  if [[ "$cmd" != 'with-lock' && "$cmd" != 'lock-status' ]]; then
    "$PYTHON_BIN" "$PHONE_LOCK_HELPER" guard-check "$LOCK_ROOT/${SERIAL}.guard" || die 'guard ownership could not be verified'
  fi
  case "$cmd" in
    with-lock) shift; with_lock "$@";;
    lock-acquire) [[ "$#" == 2 ]] || die 'usage: lock-acquire OWNER'; lock_acquire "$2";;
    lock-acquire-new) [[ "$#" == 2 ]] || die 'usage: lock-acquire-new OWNER'; lock_acquire "$2" fresh;;
    lock-release) [[ "$#" == 2 ]] || die 'usage: lock-release OWNER'; lock_release "$2";;
    lock-release-exact) [[ "$#" == 2 ]] || die 'usage: lock-release-exact OWNER'; lock_release "$2" exact;;
    lock-status)
      [[ "$#" == 1 ]] || die 'usage: lock-status'
      if [[ -r "$LOCK_DIR/owner" ]]; then
        if [[ -f "$LOCK_DIR/standalone_review_required" ]] && lock_is_stale; then
          print -- "lock=stale owner=$(<"$LOCK_DIR/owner") age=$(lock_age)s stale=true reclaimable=false ttl=${LOCK_TTL_SECONDS}s reason=standalone-review-required"
        elif lock_is_stale && ! lock_pid_live; then
          print -- "lock=stale owner=$(<"$LOCK_DIR/owner") age=$(lock_age)s stale=true reclaimable=true ttl=${LOCK_TTL_SECONDS}s"
        else
          print -- "lock=held owner=$(<"$LOCK_DIR/owner") age=$(lock_age)s stale=false reclaimable=false ttl=${LOCK_TTL_SECONDS}s"
        fi
      else print -- 'lock=free'; fi;;
    lock-refresh)
      [[ "$#" == 2 ]] || die 'usage: lock-refresh OWNER'
      require_run_id "$2"
      [[ -r "$LOCK_DIR/owner" ]] || die 'lock is not held; acquire it first'
      same_run_lock "$(<"$LOCK_DIR/owner")" "$2" || die 'refusing to refresh lock owned by another run'
      /bin/date +%s > "$LOCK_DIR/acquired_at"
      print -- "lock=refreshed owner=$(<"$LOCK_DIR/owner") ttl=${LOCK_TTL_SECONDS}s";;
    lock-reap) [[ "$#" == 1 ]] || die 'usage: lock-reap'; lock_reap;;
    lock-cleanup) [[ "$#" == 3 ]] || die 'usage: lock-cleanup OWNER PID'; lock_cleanup "$2" "$3";;
  esac
}
