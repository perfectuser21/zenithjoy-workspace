#!/bin/zsh
# 队列视频手机动作库；不注册入口、不取词、不入库、不获取/释放锁。
source "${0:A:h}/wf-limits.sh" || return 1
# 手机证据仅按逐视频+已校验MODE分名；锁与业务run仍使用原TAG。
QV_EID="$TAG-v$VID-${MODE:-identity}"
qv_nap(){ [[ -n "${HARVEST_KEYWORD_TESTING:-}" ]] || /bin/sleep "$1"; }
qv_log(){ print -u2 -r -- "[queue-video] $*"; }
qv_field(){ print -r -- "$1" | sed -n "s/^$2=//p" | head -1; }
qv_quote(){ local q=\' s="$1"; s="${s//$q/$q\\$q$q}"; print -rn -- "'$s'"; }
qv_remote(){
  local sub="$1" args="" a; shift
  # 注入独立测试执行器也保持执行时限，不改变生产命令路径。
  if [[ -n "${QUEUED_VIDEO_QUALIFY_CMD:-}" ]]; then
    wf_run_bounded "${QUEUED_VIDEO_REMOTE_SECONDS:-180}" "$QUEUED_VIDEO_QUALIFY_CMD" "$sub" "$@"
    return $?
  fi
  for a in "$@"; do args="$args $(qv_quote "$a")"; done
  wf_run_bounded "${QUEUED_VIDEO_REMOTE_SECONDS:-180}" ssh -o ConnectTimeout=15 -o BatchMode=yes \
    -o ServerAliveInterval=5 -o ServerAliveCountMax=2 mmv \
    "set -a; source ~/.credentials/zenithjoy-db.env; set +a; cd ~/.openclaw/leadgen-scripts && node qualify-video.js $(qv_quote "$sub")$args" </dev/null
}
qv_own(){
  node - "$QV_DIR/own-accounts-lib.js" "$QV_OWN_CONF" "$1" "${2:-}" <<'JS'
const {loadOwnAccounts,isOwnAccount}=require(process.argv[2]);
try {process.exit(isOwnAccount(process.argv[4],process.argv[5],loadOwnAccounts(process.argv[3]))?0:1);}
catch {process.exit(2);}
JS
}
qv_verify_video(){
  local out actual kind verified=0 cmd_rc=0
  out="$("$C" --profile "$P" current-video-link "$1" </dev/null)" || cmd_rc=$?
  actual="$(qv_field "$out" video_id)"
  kind="$(qv_field "$out" content_type)"
  (( cmd_rc == 0 )) && [[ "$actual" == "$VID" && "$kind" == video ]] && verified=1
  if [[ -n "${WFR_RUN_DIR:-}" ]]; then
    # 仅将实际控制器读回写成工件；失败也覆盖旧成功，防重试读到陈旧绿色。
    print -r -- "$out" | python3 -c 'import json,sys,os,tempfile,datetime
directory,tag,vid,verified,eid=sys.argv[1:]
raw=sys.stdin.read();fields=dict(s.split("=",1) for s in raw.splitlines() if "=" in s)
os.makedirs(directory,mode=0o700,exist_ok=True)
payload={"verified":verified=="1","expected_video_id":vid,"observed_video_id":fields.get("video_id"),"content_type":fields.get("content_type"),"excluded_non_video":fields.get("excluded_non_video")=="true","evidence_id":eid,"controller_stdout":raw,"observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
fd,tmp=tempfile.mkstemp(prefix=".identity-",dir=directory)
with os.fdopen(fd,"w") as f:json.dump(payload,f,ensure_ascii=False)
os.replace(tmp,os.path.join(directory,tag+"-identity-"+vid+".json"))' "$WFR_RUN_DIR" "$TAG" "$VID" "$verified" "$1" || return 1
  fi
  (( verified )) || { qv_log "video_identity_mismatch expected=$VID observed=${actual:-unknown} type=${kind:-unknown}"; return 1; }
}
qv_open(){
  # 仅续期已由新流程持有的锁；控制器验证实际run所有权，禁止自行争抢。
  local held
  held="$("$C" --profile "$P" lock-refresh "$TAG" </dev/null)" || return 3
  [[ "$held" == lock=refreshed* ]] || { qv_log 'lock_refresh_unconfirmed'; return 3; }
  DOUYIN_DETAIL_PLAYBACK=continuous_identity "$C" --profile "$P" open-video "$VID" "$QV_EID-open" </dev/null >/dev/null || return 4
  DOUYIN_DETAIL_PLAYBACK=continuous_identity qv_verify_video "$QV_EID-identity" || return 4
}
qv_qualify(){
  local seconds="${QUEUED_VIDEO_RECORD_SECONDS:-25}" record_eid="$QV_EID-record" started stopped extracted audio="" db duration remote result verdict
  [[ "$seconds" == <-> ]] && (( seconds >= 10 && seconds <= 105 )) || return 2
  # 默认保守录制60秒视频的3倍速片段；队列暂未记录原视频时长。
  if "$C" --profile "$P" set-playback-speed 3.0 "$QV_EID-speed" </dev/null >/dev/null; then
    # 同一批的视频各留独立工件；run锁仍使用TAG，既有录像保持不可覆盖。
    if "$C" --profile "$P" record-start "$record_eid" "$seconds" </dev/null >/dev/null; then
      qv_nap "$((seconds+2))"
      stopped="$("$C" --profile "$P" record-stop "$record_eid" </dev/null)" || stopped=""
      if [[ "$stopped" == record_stopped* ]]; then
        extracted="$("$C" --profile "$P" record-extract-audio "$record_eid" </dev/null)" || extracted=""
        audio="$(print -r -- "$extracted" | sed -n 's/^audio_extracted path=\([^ ]*\).*/\1/p')"
        db="$(print -r -- "$stopped" | sed -n 's/.*mean_volume_db=\([^ ]*\).*/\1/p')"
        duration="$(print -r -- "$stopped" | sed -n 's/.*duration_seconds=\([^ ]*\).*/\1/p')"
        if [[ "$duration" != <->(.<->|) ]] || (( duration < seconds*0.8 )); then
          qv_log 'audio_rejected reason=short_or_unknown_duration'; audio=""
        elif [[ "$db" != -<->(.<->|) && "$db" != <->(.<->|) ]] || (( db <= -80 )); then
          qv_log 'audio_rejected reason=silent_or_unknown_volume'; audio=""
        fi
      fi
    fi
  fi
  local -a audio_args=()
  if [[ -n "$audio" ]]; then
    print -r -- "AUDIO\t$VID\t$audio"
    remote="/tmp/qv-$TAG-$VID.wav"
    local -a transport=()
    if [[ -n "${LEADGEN_MMV_HOSTNAME:-}" && -n "${LEADGEN_MMV_HOSTKEY_ALIAS:-}" ]]; then
      transport=(-o "HostName=$LEADGEN_MMV_HOSTNAME" -o "HostKeyAlias=$LEADGEN_MMV_HOSTKEY_ALIAS")
    fi
    if wf_run_bounded "${QUEUED_VIDEO_REMOTE_SECONDS:-180}" scp "${transport[@]}" -o ConnectTimeout=15 -o BatchMode=yes \
      -o ServerAliveInterval=5 -o ServerAliveCountMax=2 "$audio" "mmv:$remote" </dev/null >/dev/null; then
      audio_args=(--audio "$remote")
    else qv_log 'audio_upload_failed'; fi
  fi
  result="$(qv_remote judge --line "$LINE" --video-id "$VID" "${audio_args[@]}")" || result=""
  verdict="$(print -r -- "$result" | python3 -c 'import json,sys
try:
 rows=[s for s in sys.stdin.read().splitlines() if s.startswith("QUAL_RESULT ")]
 print(json.loads(rows[-1].split(" ",1)[1]).get("verdict","pending"))
except Exception: print("pending")')"
  [[ "$verdict" == matched || "$verdict" == rejected ]] || verdict=pending
  print -- "QUAL\t$VID\t$verdict\tjudged"
  [[ "$verdict" != pending ]] || { qv_log 'qualification_pending reason=model_or_remote_failure'; return 5; }
}
# 失败恢复后，不沿用此前屏幕坐标：重新核验视频，并读取当前屏找到同条评论。
qv_relocate_comment(){
  local nick="$1" body="$2" raw ln
  QV_RESCANS=$(( ${QV_RESCANS:-0} + 1 ))
  "$C" --profile "$P" back </dev/null >/dev/null || return 1
  qv_verify_video "$QV_EID-recovery-$QV_ROW" || return 1
  "$C" --profile "$P" open-comments "$QV_EID-reopen-$QV_ROW" </dev/null >/dev/null || return 1
  raw="$("$C" --profile "$P" collect-comments "$QV_EID-rescan-$QV_ROW" </dev/null)" || return 1
  for ln in "${(@f)raw}"; do
    [[ "$(print -r -- "$ln" | cut -f1)" == "$nick" && "$(print -r -- "$ln" | cut -f2)" == "$body" ]] || continue
    QV_LINE="$ln"; return 0
  done
  return 1
}
qv_history_prepare(){
  typeset -gA QV_HISTORY_ROWS QV_HISTORY_USED
  QV_HISTORY_HASH=""; QV_HISTORY_STATUS=disabled
  [[ -n "${QUEUED_COMMENT_HISTORY_FILE:-}" ]] || return 0
  local rows line key id
  rows="$(node "$QV_DIR/queued-comment-history.js" load "$QUEUED_COMMENT_HISTORY_FILE" "$WFR_RUN_DIR" "$LINE" "$TAG" "${LEADGEN_SOURCE_RUN:-}" "$VID" "$VURL")" || return 8
  for line in "${(@f)rows}"; do
    if [[ "$line" == META$'\t'* ]]; then QV_HISTORY_STATUS="$(print -r -- "$line" | cut -f2)"; QV_HISTORY_HASH="$(print -r -- "$line" | cut -f3)"
    elif [[ "$line" == ROW$'\t'* ]]; then id="$(print -r -- "$line" | cut -f2)"; key="$(print -r -- "$line" | cut -f3)"; QV_HISTORY_ROWS[$key]="$id"
    else return 8; fi
  done
}
qv_collect(){
  local opened raw line total=0 screens=0 empty=0 newlines=0 exhausted count=0 tier cap=50 covered=0 identity_started own_rc identity nick body cdate region author tap nickb64 x y onick oid atype ip profile card attempt
  local -A seen emitted
  opened="$("$C" --profile "$P" open-comments "$QV_EID-comments" </dev/null)" || {
    # 无评论是控制器明确识别的正常结果，失败不能伪装成采完。
    if [[ "$opened" == *reason=no_comments_on_this_video* ]]; then
      print -- "COLLECTION\t$VID\tno_comments\t0"; return 0
    fi
    return 6
  }
  if [[ "$opened" == *reason=no_comments_on_this_video* ]]; then
    print -- "COLLECTION\t$VID\tno_comments\t0"; return 0
  fi
  [[ "$opened" == *comments_opened=1* ]] || return 6
  count="$(qv_field "$opened" comment_count)"
  tier="$(python3 -c 'import sys
try:
 s=sys.argv[1]; n=float(s[:-1])*10000 if s.endswith("万") else float(s)
 print("large" if n>100 else "medium")
except Exception: print("medium")' "$count")"
  # 记录阶段预算并每屏续锁；不在手机动作半途中强杀。
  local started="$(date +%s)" budget="${QUEUED_VIDEO_COLLECTION_SECONDS:-480}"
  [[ "$budget" == <-> ]] && (( budget > 0 )) || return 2
  while (( screens < 100 )); do
    if wf_deadline_reached || wf_stop_requested || (( $(date +%s) - started >= budget )); then
      # 只在完整评论动作的边界保存已核验行；仍返回非成功，不标整视频采完。
      print -- "COLLECTION\t$VID\tpartial\t${#emitted}"
      return 7
    fi
    "$C" --profile "$P" lock-refresh "$TAG" </dev/null >/dev/null || return 3
    screens=$((screens+1)); newlines=0
    raw="$("$C" --profile "$P" collect-comments "$QV_EID-screen$screens" </dev/null)" || return 6
    exhausted=0; [[ "$raw" == *exhausted=1* ]] && exhausted=1
    for line in "${(@f)raw}"; do
      [[ "$line" == *$'\t'tap=* ]] || continue
      [[ -z "${seen[$line]:-}" ]] || continue
      # Capturing the current tree or skipping an owned identity may cross the budget.
      # Check again before starting the next complete comment action.
      if wf_deadline_reached || wf_stop_requested || (( $(date +%s) - started >= budget )); then
        print -- "COLLECTION\t$VID\tpartial\t${#emitted}"
        return 7
      fi
      seen[$line]=1; newlines=$((newlines+1)); total=$((total+1)); QV_ROW="$total"
      nick="$(print -r -- "$line" | cut -f1)"; body="$(print -r -- "$line" | cut -f2)"
      cdate="$(print -r -- "$line" | cut -f3)"; region="$(print -r -- "$line" | cut -f4)"
      author="$(print -r -- "$line" | cut -f5)"
      qv_own "$nick" ''; own_rc=$?
      (( own_rc != 2 )) || return 8
      (( own_rc != 0 )) || { [[ "$author" == author ]] && return 8; continue; }
      [[ "$author" != author ]] || continue
      QV_LINE="$line"; identity=""
      for attempt in 1 2 3; do
        tap="$(print -r -- "$QV_LINE" | cut -f6)"; nickb64="$(print -r -- "$QV_LINE" | cut -f7)"
        x="${${tap#tap=}%% *}"; y="${tap##* }"; nickb64="${nickb64#b64=}"
        [[ "$x" == <-> && "$y" == <-> && -n "$nickb64" ]] || break
        identity_started="$(date +%s)"
        identity="$("$C" --profile "$P" commenter-identity "$x" "$y" "$nickb64" "$QV_EID-person$total-t$attempt" </dev/null)" || identity=""
        onick="$(qv_field "$identity" nickname)"
        [[ "$onick" == "$nick" ]] && break
        identity=""
        (( attempt < 3 )) && qv_relocate_comment "$nick" "$body" || break
      done
      [[ -n "$identity" ]] || { qv_log "identity_unconfirmed row=$total"; return 6; }
      oid="$(qv_field "$identity" douyin_id)"; atype="$(qv_field "$identity" account_type)"; ip="$(qv_field "$identity" profile_ip)"
      [[ -n "$oid" ]] || { qv_log "douyin_id_missing row=$total"; return 6; }
      qv_own "$onick" "$oid"; own_rc=$?
      (( own_rc != 2 )) || return 8
      (( own_rc != 0 )) || continue
      [[ -z "${emitted[$oid$'\t'$body]:-}" ]] || continue
      if [[ "$QV_HISTORY_STATUS" == verified ]]; then
        local hkey hid
        hkey="$(node "$QV_DIR/queued-comment-history.js" key "$oid" "$body")" || return 8
        hid="${QV_HISTORY_ROWS[$hkey]:-}"
        if [[ -n "$hid" ]]; then
          if [[ -z "${QV_HISTORY_USED[$hkey]:-}" ]]; then
            node "$QV_DIR/queued-comment-history.js" proof "$QUEUED_COMMENT_HISTORY_FILE" "$WFR_RUN_DIR" "$LINE" "$TAG" "${LEADGEN_SOURCE_RUN:-}" "$VID" "$VURL" "$P" "$QV_EID-person$total-t$attempt" "$hid" "$oid" "$body" "$(qv_field "$identity" profile_evidence)" "$(qv_field "$identity" return_evidence)" "$identity_started" || return 8
            QV_HISTORY_USED[$hkey]=1; covered=$((covered+1))
            print -- "HISTORY\t$VID\t$hid\t$hkey\t$QV_EID-person$total-t$attempt\t$QV_HISTORY_HASH"
          fi
          # 身份页返回可能重排评论，历史命中也必须独立重读新树。
          exhausted=0; break
        fi
      fi
      "$C" --profile "$P" tap-evidence "$x" "$y" "$QV_EID-card$total" </dev/null >/dev/null || return 6
      qv_nap 3; profile=""
      for attempt in 1 2 3; do
        card="$("$C" --profile "$P" commenter-card-link "$QV_EID-card$total-t$attempt" </dev/null)" || card=""
        profile="$(qv_field "$card" profile_url)"; [[ -n "$profile" ]] && break
        (( attempt < 3 )) && qv_nap 2
      done
      [[ -n "$profile" ]] || qv_log "profile_url_missing row=$total fallback=douyin_id"
      # 名片动作可能改变返回栈，不能仅凭“评论面板重新打开”认作原视频。
      # 名片复制的暂存页与评论面板都没有可取链的分享按钮；先重开目标，
      # 再用真实新取链核验实际ID，禁止拿open-video回显的期望ID代替验证。
      DOUYIN_DETAIL_PLAYBACK=continuous_identity "$C" --profile "$P" open-video "$VID" "$QV_EID-after-card$total-open" </dev/null >/dev/null || return 4
      DOUYIN_DETAIL_PLAYBACK=continuous_identity qv_verify_video "$QV_EID-after-card$total" || return 4
      "$C" --profile "$P" open-comments "$QV_EID-after-card$total-comments" </dev/null >/dev/null || return 6
      emitted[$oid$'\t'$body]=1; covered=$((covered+1))
      print -- "LEAD\t$onick\t$oid\t${atype:-personal}\t$body\t$cdate\t$region\t$TITLE\t$KWTXT\t$ip\t$profile\t$VURL"
      # 名片返回后页面重排；下一条重新collect，绝不沿用旧坐标。
      # exhausted也必须重读一轮才能确认没有尚未处理的行。
      exhausted=0; break
    done
    if (( newlines == 0 )); then empty=$((empty+1)); else empty=0; fi
    (( exhausted == 0 && empty < 2 )) || break
    [[ "$tier" != large ]] || (( covered < cap )) || break
    # 本屏出现尚未处理的评论时保持现场重读；本屏没有新行才翻屏。
    if (( newlines == 0 )); then
      "$C" --profile "$P" swipe 600 2000 600 900 400 </dev/null >/dev/null || return 6
      qv_nap 1.5
    fi
  done
  if (( screens >= 100 )); then
    print -- "COLLECTION\t$VID\tpartial\t${#emitted}"
    return 7
  fi
  print -- "COLLECTION\t$VID\tcollected\t${#emitted}"
  # collected 状态只由调用方在评论事务提交后回填，禁止在手机脚本标记。
}
