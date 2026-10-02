#!/bin/zsh
# 单视频物理边界。业务判定/采集函数与旧harvest循环共用；不发现、不编排其它活动。
set -uo pipefail
ACTION="$1"; PROFILE="$2"; LINE_HINT="$3"; VIDEO_ID="$4"; TITLE_B64="$5"
DURATION="$6"; RUN_TAG="$7"; KEYWORD_ENC="$8"; BUDGET="$9"; EXPECTED_SERIAL="${10}"; LOCK_HOLDER="${11}"
RETURN_TO_RESULTS="${12:-false}"; RETURN_ATTEMPTED=0; RETURN_CONFIRMED=0; RETURN_RESCANS=unknown
# 直接调用shell也必须先拒绝非法flag；不能先source远端/手机活动。
[[ "$RETURN_TO_RESULTS" == true || "$RETURN_TO_RESULTS" == false ]] || { print -- $'ACTIVITY_STATUS\tfatal\tinvalid_input'; exit 1; }
# 仅使用execFile显式参数，清除继承环境里的网关值。
QUAL_GATEWAY_HOST="${13:-}"; QUAL_GATEWAY_CWD="${14:-}"; QUAL_GATEWAY_NODE="${15:-}"; QUAL_GATEWAY_ENV_FILE="${16:-}"
if [[ -n "$QUAL_GATEWAY_HOST$QUAL_GATEWAY_CWD$QUAL_GATEWAY_NODE$QUAL_GATEWAY_ENV_FILE" ]]; then
  [[ "$QUAL_GATEWAY_HOST" =~ '^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,127}$' && "$QUAL_GATEWAY_CWD" == /* && ! "$QUAL_GATEWAY_CWD" =~ '[[:cntrl:]]' && "/$QUAL_GATEWAY_CWD/" != *'/../'* ]] || { print -- $'ACTIVITY_STATUS\tfatal\tinvalid_gateway'; exit 1; }
  [[ -z "$QUAL_GATEWAY_NODE" || ( "$QUAL_GATEWAY_NODE" =~ '^/[A-Za-z0-9_./-]+$' && "/$QUAL_GATEWAY_NODE/" != *'/../'* ) ]] || { print -- $'ACTIVITY_STATUS\tfatal\tinvalid_gateway'; exit 1; }
  [[ -z "$QUAL_GATEWAY_ENV_FILE" || ( "$QUAL_GATEWAY_ENV_FILE" =~ '^/[A-Za-z0-9_./-]+/\.credentials/[A-Za-z0-9_.-]+\.env$' && "/$QUAL_GATEWAY_ENV_FILE/" != *'/../'* ) ]] || { print -- $'ACTIVITY_STATUS\tfatal\tinvalid_gateway'; exit 1; }
fi
export HARVEST_KEYWORD_LIB=1 VIDEO_ACTIVITY_MODE=1
source "${0:A:h}/harvest-keyword.sh" "$PROFILE" "$KEYWORD_ENC" 1 "$RUN_TAG" unlimited "$LINE_HINT"
VID="$VIDEO_ID"; TITLE="$(print -rn -- "$TITLE_B64" | base64 -d)"; DUR="$DURATION"; i=1
ACTIVITY_T0=$(date +%s); ACTIVITY_REASON=""; OWNED_LOCK=0; RELEASE_CONFIRMED=1
activity_should_stop() {
  if wf_deadline_reached; then ACTIVITY_REASON=deadline; return 0; fi
  if wf_stop_requested || [[ -n "${VIDEO_ACTIVITY_STOP_FILE:-}" && -e "$VIDEO_ACTIVITY_STOP_FILE" ]]; then ACTIVITY_REASON=commander_stop; return 0; fi
  if (( BUDGET > 0 && $(date +%s) - ACTIVITY_T0 >= BUDGET )); then ACTIVITY_REASON=budget_exceeded; return 0; fi
  return 1
}
activity_cleanup() {
  (( OWNED_LOCK )) || return 0
  local out n
  RELEASE_CONFIRMED=0
  for n in 1 2 3; do
    out="$($C --profile "$P" lock-release "$LOCK_HOLDER" 2>&1)"
    if print -r -- "$out" | grep -qE '^lock=(released|free)'; then RELEASE_CONFIRMED=1; break; fi
    (( n < 3 )) && nap 2
  done
  (( RELEASE_CONFIRMED )) || print -- $'ACTIVITY_CLEANUP\tfailed'
}
trap 'activity_cleanup' EXIT
return_evidence() {
  [[ "$ACTION" == collection && "$RETURN_TO_RESULTS" == true ]] || return 0
  print -- "ACTIVITY_RETURN\t$RETURN_ATTEMPTED\t$RETURN_CONFIRMED\t$RETURN_RESCANS\t${1:-}"
}
trap 'ACTIVITY_REASON=interrupted; return_evidence interrupted; print -- "ACTIVITY_STATUS\tpending\tinterrupted"; exit 1' TERM INT
finish_activity() {
  return_evidence "${2:-}"
  print -- "ACTIVITY_STATUS\t$1\t${2:-}"
  exit 0
}
activity_should_stop && finish_activity pending "$ACTIVITY_REASON"
# matched是调用输入与持久化判定共同满足的前置条件，不再次调用模型。
if [[ "$ACTION" == collection ]]; then
  QD="$(qual_remote discover --line "$LINE" --video-id "$VID" --title-b64 "$TITLE_B64" --keyword-b64 "$(b64 "$KWTXT")" --batch "$HBATCH")"
  [[ "$(qual_field "$QD" status)" == matched ]] || finish_activity pending qualification_not_confirmed
fi
PF="$($C --profile "$P" preflight 2>/dev/null)"
SERIAL_READ="$(print -r -- "$PF" | sed -n 's/^serial=//p')"
[[ -n "$SERIAL_READ" ]] || finish_activity pending device_unavailable
[[ "$SERIAL_READ" == "$EXPECTED_SERIAL" ]] || finish_activity fatal device_mismatch
LS="$($C --profile "$P" lock-status 2>/dev/null)"
if [[ "$LS" == 'lock=free' ]]; then
  LA="$($C --profile "$P" lock-acquire "$LOCK_HOLDER" 2>/dev/null)"; lrc=$?
  (( lrc == 0 )) && print -r -- "$LA" | grep -qE '^lock=(acquired|held)' || finish_activity pending lock_unavailable
  # lock-acquire有幂等held回执：竞态中借来的锁同样不能由本活动释放。
  [[ "$LA" == lock=acquired* ]] && OWNED_LOCK=1
else
  HELD_BY="$(print -r -- "$LS" | sed -n 's/^lock=held owner=\([^ ]*\).*/\1/p')"
  [[ "$HELD_BY" == "$LOCK_HOLDER" ]] || finish_activity pending lock_unavailable
  LR="$($C --profile "$P" lock-refresh "$LOCK_HOLDER" 2>/dev/null)"
  print -r -- "$LR" | grep -q '^lock=refreshed' || finish_activity pending lock_unavailable
fi
activity_should_stop && finish_activity pending "$ACTIVITY_REASON"
OPENED="$($C --profile "$P" open-video "$VID" "$TAG-v1-open" 2>/dev/null)"
print -r -- "$OPENED" | grep -q '^video_opened=1' || finish_activity pending video_unavailable
activity_should_stop && finish_activity pending "$ACTIVITY_REASON"
VLINK="$($C --profile "$P" current-video-link "$TAG-v1-binding" 2>/dev/null)"
LINK_RC=$?
OBSERVED="$(print -r -- "$VLINK" | sed -n 's/^video_id=//p')"
BINDING_ID=""
if [[ "$OBSERVED" == <-> && ${#OBSERVED} -ge 16 && ${#OBSERVED} -le 24 ]]; then
  BINDING_ID="$OBSERVED"
fi
# 只记录受校验的ID与返回码；原始stderr/分享文案不进入结构化回执。
print -- "ACTIVITY_BINDING\t$VID\t$BINDING_ID\t$LINK_RC"
(( LINK_RC == 0 )) && [[ -n "$BINDING_ID" ]] || finish_activity pending video_identity_unavailable
[[ "$OBSERVED" == "$VID" ]] || finish_activity pending video_mismatch
VURL="$(print -r -- "$VLINK" | sed -n 's/^short_url=//p')"
[[ -n "$VURL" ]] || finish_activity pending video_unavailable
if [[ "$ACTION" == qualification ]]; then
  qualify_current_video; rc=$?
  activity_should_stop && finish_activity pending "$ACTIVITY_REASON"
  (( rc == 0 )) && [[ "$QV" == matched || "$QV" == rejected ]] && finish_activity completed
  finish_activity pending "${ACTIVITY_REASON:-qualification_pending}"
else
  collect_current_video; rc=$?
  if (( rc == 0 )); then
    if [[ "$RETURN_TO_RESULTS" == true ]]; then
      # 单视频direct ID链只读取controller真实恢复标志，不复用旧卡片坐标重扫循环。
      activity_should_stop && finish_activity pending "$ACTIVITY_REASON"
      RETURN_ATTEMPTED=1
      RETURN_OUT="$($C --profile "$P" back-to-results 4 "$KWTXT" "$TAG-v1-return" </dev/null)"; return_rc=$?
      RETURN_RESULT="$(print -r -- "$RETURN_OUT" | grep -E '^back_to_results=1([[:space:]]|$)' | tail -1)"
      if (( return_rc != 0 )) || [[ -z "$RETURN_RESULT" ]]; then
        finish_activity pending return_to_results_unconfirmed
      fi
      RETURN_CONFIRMED=1; RETURN_RESCANS=0
      print -r -- "$RETURN_RESULT" | grep -qE '(^|[[:space:]])recovered_via=research([[:space:]]|$)' && RETURN_RESCANS=1
    fi
    finish_activity completed
  fi
  if (( rc == 124 )); then finish_activity pending "${ACTIVITY_REASON:-budget_exceeded}"; fi
  if (( rc == 2 )); then finish_activity pending video_mismatch; fi
  finish_activity pending collection_unconfirmed
fi
