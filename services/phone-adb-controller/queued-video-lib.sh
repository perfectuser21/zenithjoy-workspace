#!/bin/zsh
# 队列视频手机动作库；不注册入口、不取词、不入库、不获取/释放锁。
source "${0:A:h}/wf-limits.sh" || return 1
# 手机证据仅按逐视频+已校验MODE分名；锁与业务run仍使用原TAG。
QV_EID="$TAG-v$VID-${MODE:-identity}"
# Recovery keeps the original business TAG/lease; never overwrites a recording EID.
if [[ -n "${QUEUED_VIDEO_EVIDENCE_ATTEMPT:-}" ]]; then
  [[ "$MODE" == qualification && "$QUEUED_VIDEO_EVIDENCE_ATTEMPT" == 1 ]] || return 2
  QV_EID="$QV_EID-recovery$QUEUED_VIDEO_EVIDENCE_ATTEMPT"
fi
qv_nap(){ [[ -n "${HARVEST_KEYWORD_TESTING:-}" ]] || /bin/sleep "$1"; }
qv_log(){ print -u2 -r -- "[queue-video] $*"; }
qv_field(){ print -r -- "$1" | sed -n "s/^$2=//p" | head -1; }
qv_confirm_nickname(){
  # 只解XML字符实体；不裁空白/删emoji/变体符，不替代控制器鲜证与实际ID核验。
  node - "$QV_DIR/nickname-match-lib.js" "$1" "$2" "${3:-}" <<'JS'
const {decodeXmlEntities}=require(process.argv[2]);
const encoding=process.argv[5];
if(!['xml_decoded','xml_raw'].includes(encoding))process.exit(1);
const observed=encoding==='xml_raw'?decodeXmlEntities(process.argv[3]):process.argv[3],expected=decodeXmlEntities(process.argv[4]);
if(!observed||!expected||observed!==expected)process.exit(1);
process.stdout.write(observed);
JS
}
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
  local seconds="${QUEUED_VIDEO_RECORD_SECONDS:-25}" record_eid="$QV_EID-record" started="" stopped="" extracted audio="" db duration remote result verdict media="" media_ok=0 playback_ok=0 playback_start=unknown playback_end=unknown playback_package=unknown audio_status=unavailable
  local capture_mode="" capture_sdk="" capture_required="" capture_ok=0 astreams=""
  local error_file first_phase="" first_rc=0 first_stderr=""
  [[ "$seconds" == <-> ]] && (( seconds >= 10 && seconds <= 105 )) || return 2
  error_file="$(mktemp)" || return 5
  /bin/chmod 600 "$error_file"
  # 默认保守录制60秒视频的3倍速片段；队列暂未记录原视频时长。
  if "$C" --profile "$P" set-playback-speed 3.0 "$QV_EID-speed" </dev/null >/dev/null 2>"$error_file"; then
    # 同一批的视频各留独立工件；run锁仍使用TAG，既有录像保持不可覆盖。
    if started="$("$C" --profile "$P" record-start "$record_eid" "$seconds" </dev/null 2>"$error_file")"; then
      capture_mode="$(print -r -- "$started" | sed -n 's/.*capture_audio_mode=\([^ ]*\).*/\1/p')"
      capture_sdk="$(print -r -- "$started" | sed -n 's/.*capture_audio_sdk=\([^ ]*\).*/\1/p')"
      capture_required="$(print -r -- "$started" | sed -n 's/.*capture_audio_required=\([^ ]*\).*/\1/p')"
      [[ "$capture_mode" == playback_dup && "$capture_sdk" == <-> && "$capture_required" == true ]] && (( capture_sdk >= 33 )) && capture_ok=1
      media="$(print -r -- "$started" | sed -n 's/.*media_volume=\([^ ]*\).*/\1/p')"
      [[ "$started" == record_started* && "$media" == <-> ]] && (( media > 0 )) && media_ok=1
      playback_start="$(print -r -- "$started" | sed -n 's/.* playback_state=\([^ ]*\).*/\1/p')"
      playback_package="$(print -r -- "$started" | sed -n 's/.* playback_package=\([^ ]*\).*/\1/p')"
      qv_nap "$((seconds+2))"
      stopped="$("$C" --profile "$P" record-stop "$record_eid" </dev/null 2>"$error_file")" || { first_rc=$?;first_phase=record_stop;first_stderr="$(cat "$error_file")";print -u2 -r -- "$first_stderr";stopped=""; }
      playback_end="$(print -r -- "$stopped" | sed -n 's/.* playback_state=\([^ ]*\).*/\1/p')"
      if python3 - "$started" "$stopped" "$record_eid" <<'PYNATIVEPAIR'
import sys,re
phases=[]
for phase,raw in zip(('start','end'),sys.argv[1:3]):
 f=dict(x.split('=',1) for x in raw.split() if '=' in x);prefix=sys.argv[3]+'-playback-'+phase
 required={'playback_proof_kind':'native_audio','playback_package':'com.ss.android.ugc.aweme','native_audio_state':'started','native_audio_package_uid_verified':'true','native_audio_foreign_started':'0'}
 if any(f.get(k)!=v for k,v in required.items()):sys.exit(1)
 for k in ('uid','pid','piid'):
  if not f.get('native_audio_'+k,'').isdigit() or int(f['native_audio_'+k])<=0:sys.exit(1)
 for name,suffix in [('evidence','audio.txt'),('package_uid','package-uid.txt'),('uid_owners','uid-owners.txt')]:
  if f.get('native_audio_'+name+'_file')!=prefix+'.'+suffix or not re.fullmatch('[0-9a-f]{64}',f.get('native_audio_'+name+'_sha256','')):sys.exit(1)
 phases.append(f)
if phases[0]['native_audio_uid']!=phases[1]['native_audio_uid']:sys.exit(1)
PYNATIVEPAIR
      then playback_ok=1; fi
      if [[ "$stopped" == record_stopped* ]]; then
        if ! python3 - "$started" "$stopped" "$record_eid" <<'PYCAPTUREPAIR'
import sys,re
s,e=[dict(x.split('=',1) for x in raw.split() if '=' in x) for raw in sys.argv[1:3]]
keys=['capture_audio_mode','capture_audio_sdk','capture_audio_required','capture_audio_sdk_evidence_file','capture_audio_sdk_evidence_sha256']
assert all(s.get(k) and s.get(k)==e.get(k) for k in keys)
assert s['capture_audio_mode']=='playback_dup' and s['capture_audio_sdk'].isdigit() and int(s['capture_audio_sdk'])>=33 and s['capture_audio_required']=='true'
assert s['capture_audio_sdk_evidence_file']==sys.argv[3]+'.capture-sdk.txt' and re.fullmatch('[a-f0-9]{64}',s['capture_audio_sdk_evidence_sha256'])
PYCAPTUREPAIR
        then capture_ok=0;fi
        astreams="$(print -r -- "$stopped" | sed -n 's/.*audio_streams=\([^ ]*\).*/\1/p')"
        db="$(print -r -- "$stopped" | sed -n 's/.*mean_volume_db=\([^ ]*\).*/\1/p')"
        duration="$(print -r -- "$stopped" | sed -n 's/.*duration_seconds=\([^ ]*\).*/\1/p')"
        if [[ "$duration" != <->(.<->|) ]] || (( duration < seconds*0.8 )); then
          qv_log 'audio_rejected reason=short_or_unknown_duration'; audio_status=unknown
        elif [[ "$db" != -<->(.<->|) && "$db" != <->(.<->|) ]] || (( db <= -80 )); then
          qv_log 'audio_rejected reason=silent_or_unknown_volume'; audio_status=unknown
          print -u2 -- RECORD_CAPTURE_SILENT
        else
          audio_status=usable
          if (( media_ok && playback_ok && capture_ok )) && [[ "$astreams" == <-> ]] && (( astreams >= 1 )); then
            extracted="$("$C" --profile "$P" record-extract-audio "$record_eid" </dev/null)" || extracted=""
            audio="$(print -r -- "$extracted" | sed -n 's/^audio_extracted path=\([^ ]*\).*/\1/p')"
          fi
        fi
      fi
    else
      first_rc=$?;first_phase=record_start;first_stderr="$(cat "$error_file")";print -u2 -r -- "$first_stderr"
    fi
  else
    first_rc=$?;first_phase=set_playback_speed;first_stderr="$(cat "$error_file")";print -u2 -r -- "$first_stderr"
  fi
  /bin/rm -f "$error_file"
  # 媒体音量与内容电平分别存证；静音不是模型内容判定，也不得用旧转写伪装本轮ASR。
  [[ -n "${WFR_RUN_DIR:-}" ]] || return 5
  python3 - "$WFR_RUN_DIR" "$TAG" "$VID" "$record_eid" "$media" "$media_ok" "$audio_status" "${db:-}" "${duration:-}" "$started" "$stopped" "$playback_ok" "$playback_package" "$playback_start" "$playback_end" "$first_phase" "$first_rc" "$first_stderr" "$capture_mode" "$capture_sdk" "$capture_required" "$astreams" <<'PYRECORD' || return 5
import sys,json,os,tempfile,datetime,math
d,run,vid,eid,media,ok,status,db,duration,started,stopped,playback_ok,playback_package,playback_start,playback_end,first_phase,first_rc,first_stderr,capture_mode,capture_sdk,capture_required,astreams=sys.argv[1:]
def number(v):
 try:
  n=float(v);return n if math.isfinite(n) else None
 except ValueError:return None
os.makedirs(d,mode=0o700,exist_ok=True)
p={"version":2,"playback_proof_kind":"native_audio","native_audio":{},"run":run,"video_id":vid,"evidence_id":eid,"media_volume":int(media) if media.isdigit() else None,"media_volume_verified":ok=="1","playback_verified":playback_ok=="1","playback_package":playback_package,"playback_state":number(playback_start),"playback_end_state":number(playback_end),"audio_status":status,"mean_volume_db":number(db),"duration_seconds":number(duration),"record_started_stdout":started,"record_stopped_stdout":stopped,"playback_raw_evidence":{},"observed_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
capture_fields=dict(x.split('=',1) for x in started.split() if '=' in x)
end_fields=dict(x.split('=',1) for x in stopped.split() if '=' in x)
p['capture_audio_end']={'mode':end_fields.get('capture_audio_mode'),'sdk':int(end_fields.get('capture_audio_sdk','')) if end_fields.get('capture_audio_sdk','').isdigit() else None,'required':end_fields.get('capture_audio_required')=='true','sdk_evidence_file':end_fields.get('capture_audio_sdk_evidence_file'),'sdk_evidence_sha256':end_fields.get('capture_audio_sdk_evidence_sha256')}
p['capture_audio_sdk_evidence_file']=capture_fields.get('capture_audio_sdk_evidence_file')
p['capture_audio_sdk_evidence_sha256']=capture_fields.get('capture_audio_sdk_evidence_sha256')
p.update({'capture_audio_mode':capture_mode or None,'capture_audio_sdk':int(capture_sdk) if capture_sdk.isdigit() else None,'capture_audio_required':capture_required=='true','audio_streams':int(astreams) if astreams.isdigit() else None,'capture_audio_verified':capture_mode=='playback_dup' and capture_sdk.isdigit() and int(capture_sdk)>=33 and capture_required=='true' and astreams.isdigit() and int(astreams)>=1 and status=='usable' and p['capture_audio_end']=={'mode':capture_mode,'sdk':int(capture_sdk) if capture_sdk.isdigit() else None,'required':capture_required=='true','sdk_evidence_file':p['capture_audio_sdk_evidence_file'],'sdk_evidence_sha256':p['capture_audio_sdk_evidence_sha256']}})
p['earliest_error']={'phase':first_phase,'exit_code':int(first_rc),'stderr':first_stderr[-4000:]} if first_phase else None
for phase,raw in [('start',started),('end',stopped)]:
 fields=dict(x.split('=',1) for x in raw.split() if '=' in x)
 p['playback_raw_evidence'][phase]={k:fields.get('playback_'+k) for k in ('evidence_file','evidence_sha256','foreground_file','foreground_sha256')}
 p['native_audio'][phase]={k:fields.get('native_audio_'+k) for k in ('state','evidence_file','evidence_sha256','package_uid_file','package_uid_sha256','uid_owners_file','uid_owners_sha256')}
 p['native_audio'][phase].update({k:number(fields.get('native_audio_'+k,'')) for k in ('uid','pid','piid','foreign_started')})
 p['native_audio'][phase]['package_uid_verified']=fields.get('native_audio_package_uid_verified')=='true'
fd,tmp=tempfile.mkstemp(prefix='.recording-',dir=d)
with os.fdopen(fd,'w') as f:json.dump(p,f)
os.replace(tmp,os.path.join(d,run+'-recording-'+vid+'.json'))
PYRECORD
  if (( ! capture_ok )); then
    print -u2 -- RECORD_CAPTURE_STRATEGY_UNVERIFIED
    print -- "QUAL\t$VID\tpending\tcapture_strategy_unverified"; return 5
  fi
  if [[ "$astreams" != <-> ]] || (( astreams < 1 )); then
    print -u2 -- RECORD_AUDIO_TRACK_UNVERIFIED
    print -- "QUAL\t$VID\tpending\tcapture_audio_unverified"; return 5
  fi
  if (( ! media_ok )); then
    qv_log 'recording_pending reason=media_volume_unverified'
    print -- "QUAL\t$VID\tpending\tmedia_volume_unverified"; return 5
  fi
  if (( ! playback_ok )); then
    qv_log 'recording_pending reason=playback_unverified'
    print -- "QUAL\t$VID\tpending\tplayback_unverified"; return 5
  fi
  if [[ "$audio_status" == silent ]]; then
    print -- "QUAL\t$VID\trejected\trecording_silent"; return 0
  fi
  if [[ "$audio_status" != usable || -z "$audio" ]]; then
    print -- "QUAL\t$VID\tpending\trecording_unavailable"; return 5
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
    else qv_log 'audio_upload_failed'; print -- "QUAL\t$VID\tpending\taudio_upload_failed"; return 5; fi
  fi
  result="$(qv_remote judge --line "$LINE" --run "$TAG" --source-run "${LEADGEN_SOURCE_RUN:-}" --video-id "$VID" "${audio_args[@]}")" || result=""
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
  local nick="$1" body="$2" raw ln purpose="${3:-identity}"
  case "$purpose" in
    identity) QV_RESCANS=$(( ${QV_RESCANS:-0} + 1 ));;
    avatar) QV_AVATAR_RECOVERIES=$(( ${QV_AVATAR_RECOVERIES:-0} + 1 ));;
    *) return 1;;
  esac
  qv_log "comment_relocation kind=$purpose row=$QV_ROW evidence=$QV_EID-rescan-$QV_ROW"
  "$C" --profile "$P" back </dev/null >/dev/null || return 1
  qv_verify_video "$QV_EID-recovery-$QV_ROW" || return 1
  "$C" --profile "$P" open-comments "$QV_EID-reopen-$QV_ROW" </dev/null >/dev/null || return 1
  raw="$("$C" --profile "$P" collect-comments "$QV_EID-rescan-$QV_ROW" </dev/null)" || return 1
  for ln in "${(@f)raw}"; do
    [[ "$(print -r -- "$ln" | cut -f1)" == "$nick" && "$(print -r -- "$ln" | cut -f2)" == "$body" ]] || continue
    QV_LINE="$ln"; return 0
  done
  # 只有back/实际VID复核/评论重开/新树读取均成功，才是目标不在新屏。
  # rc1仍为取证或上下文失败，绝不可当成可安全跳过的候选。
  return 2
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
qv_collection_budget(){
  local budget="${QUEUED_VIDEO_COLLECTION_SECONDS-480}"
  [[ "$budget" == [1-9][0-9]# && ${#budget} -le 4 ]] && (( budget <= 6720 )) || return 2
  print -- "$budget"
}
qv_collect(){
  local budget
  budget="$(qv_collection_budget)" || return 2
  local opened raw line total=0 screens=0 empty=0 newlines=0 exhausted count=0 tier cap=50 covered=0 identity_started own_rc identity nick body cdate region author tap nickb64 x y onick oid atype ip profile card attempt
  local -A seen emitted unavailable_avatar
  local sampling=0
  if (( ${+LEADGEN_COMMENT_LIMIT} )); then sampling=1; cap="$LEADGEN_COMMENT_LIMIT"; fi
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
  local started="$(date +%s)"
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
      tap="$(print -r -- "$QV_LINE" | cut -f6)"; nickb64="$(print -r -- "$QV_LINE" | cut -f7)"
      x="${${tap#tap=}%% *}"; y="${tap##* }"; nickb64="${nickb64#b64=}"
      if [[ -z "$x" && -z "$y" && -n "$nickb64" ]]; then
        # 仅空头像坐标：不猜坐标；新鲜上下文成功后最多重定位一次。
        # 已明确不可操作的同昵称+全文只在再次空坐标时略过，不挡后续完整新树。
        [[ -z "${unavailable_avatar[$nick$'\t'$body]:-}" ]] || continue
        local relocate_rc=0
        qv_relocate_comment "$nick" "$body" avatar || relocate_rc=$?
        (( relocate_rc == 0 || relocate_rc == 2 )) || { qv_log "avatar_recovery_failed row=$total"; return 6; }
        tap="$(print -r -- "$QV_LINE" | cut -f6)"; nickb64="$(print -r -- "$QV_LINE" | cut -f7)"
        x="${${tap#tap=}%% *}"; y="${tap##* }"; nickb64="${nickb64#b64=}"
        if (( relocate_rc == 2 )) || [[ -z "$x" && -z "$y" && -n "$nickb64" ]]; then
          unavailable_avatar[$nick$'\t'$body]=1
          print -- "COMMENT_SKIP\t$VID\tavatar_unavailable\t$QV_EID-rescan-$QV_ROW"
          qv_log "comment_skipped row=$total reason=avatar_unavailable evidence=$QV_EID-rescan-$QV_ROW"
          # 恢复已改变屏位；不能点原raw剩余旧坐标，下一轮重新collect。
          exhausted=0; break
        fi
      fi
      for attempt in 1 2 3; do
        tap="$(print -r -- "$QV_LINE" | cut -f6)"; nickb64="$(print -r -- "$QV_LINE" | cut -f7)"
        x="${${tap#tap=}%% *}"; y="${tap##* }"; nickb64="${nickb64#b64=}"
        [[ "$x" == <-> && "$y" == <-> && -n "$nickb64" ]] || break
        identity_started="$(date +%s)"
        identity="$("$C" --profile "$P" commenter-identity "$x" "$y" "$nickb64" "$QV_EID-person$total-t$attempt" </dev/null)" || identity=""
        onick="$(qv_field "$identity" nickname)"
        onick="$(qv_confirm_nickname "$onick" "$nick" "$(qv_field "$identity" nickname_encoding)")" && break
        identity=""
        (( attempt < 3 )) && qv_relocate_comment "$nick" "$body" || break
      done
      [[ -n "$identity" ]] || { qv_log "identity_unconfirmed row=$total"; return 6; }
      local recipient_profile_eid="$QV_EID-person$total-t$attempt"
      oid="$(qv_field "$identity" douyin_id)"; atype="$(qv_field "$identity" account_type)"; ip="$(qv_field "$identity" profile_ip)"
      if [[ -z "$oid" && "$(qv_field "$identity" profile_status)" == unavailable && "$(qv_field "$identity" unavailable_reason)" == account_deregistered ]]; then
        local unavailable_proof unavailable_eid="$QV_EID-person$total-t$attempt" unavailable_root="${DOUYIN_PHONE_TMP_ROOT:-/private/tmp/openclaw-phone}/evidence/$P" unavailable_file
        unavailable_proof="$(node "$QV_DIR/queued-comment-history.js" unavailable "$unavailable_root" "$unavailable_eid" "$onick" "$(qv_field "$identity" comment_evidence)" "$(qv_field "$identity" profile_evidence)" "$(qv_field "$identity" return_evidence)" "$identity_started")" || { qv_log "unavailable_proof_invalid row=$total"; return 6; }
        unavailable_file="$WFR_RUN_DIR/$unavailable_eid-unavailable.json"
        print -r -- "$unavailable_proof" | node -e 'const fs=require("fs");fs.writeFileSync(process.argv[1],fs.readFileSync(0),{flag:"wx",mode:0o600});' "$unavailable_file" || return 6
        print -- "COMMENT_SKIP\t$VID\taccount_deregistered\t$unavailable_eid\t$unavailable_file"
        qv_log "comment_skipped row=$total reason=account_deregistered evidence=$unavailable_file"
        # 返回评论页可能重排。注销不计覆盖/配额，下一条必须重新读取当前树。
        exhausted=0; break
      fi
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
      node "$QV_DIR/queued-recipient-evidence.js" "$WFR_RUN_DIR" "$LINE" "$TAG" "${LEADGEN_SOURCE_RUN:-}" "$VID" "$VURL" "$P" "$oid" "$onick" "$body" "$identity_started" "$(qv_field "$identity" profile_evidence)" "$(qv_field "$identity" return_evidence)" "$recipient_profile_eid" "$QV_EID-after-card$total" xml_raw || return 8
      emitted[$oid$'\t'$body]=1; covered=$((covered+1))
      print -- "LEAD\t$onick\t$oid\t${atype:-personal}\t$body\t$cdate\t$region\t$TITLE\t$KWTXT\t$ip\t$profile\t$VURL"
      # 名片返回后页面重排；下一条重新collect，绝不沿用旧坐标。
      # exhausted也必须重读一轮才能确认没有尚未处理的行。
      exhausted=0; break
    done
    if (( newlines == 0 )); then empty=$((empty+1)); else empty=0; fi
    if (( sampling && covered >= cap )); then
      print -- "COLLECTION\t$VID\tsampled\t${#emitted}\t$covered\t$cap"
      return 0
    fi
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
  if (( sampling )); then
    # 只接受新鲜树明确footer，停滞不能冒充全量结束。
    if (( exhausted != 1 )); then print -- "COLLECTION\t$VID\tpartial\t${#emitted}"; return 7; fi
    print -- "COLLECTION\t$VID\tcollected\t${#emitted}\t$covered\t$cap\tfooter=1"
  else
    print -- "COLLECTION\t$VID\tcollected\t${#emitted}"
  fi
  # collected 状态只由调用方在评论事务提交后回填，禁止在手机脚本标记。
}
