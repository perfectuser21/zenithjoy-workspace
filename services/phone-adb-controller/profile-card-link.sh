# Sourced only by the explicitly owned existing-comment metadata command.
profile_card_point() {
  "$PYTHON_BIN" "$PHONE_CONTROLLER_DIR/profile-card-link.py" "$1" "$2" "$pc_uid" "$pc_nick" "$pc_body"
}
profile_card_tap() {
  local point x y
  point="$(profile_card_point "$1" "$2")" || die PROFILE_CARD_CONTROL_UNVERIFIED
  read x y <<< "$point"
  "$ADB" -s "$SERIAL" shell input tap "$x" "$y" || die PROFILE_CARD_TAP_FAILED
  wait_ms 900
}
profile_card_open_comments() {
  local eid="$1" point x y
  ui_evidence "${eid}-before" >/dev/null
  _is_video_detail_xml "$EVIDENCE_ROOT/${eid}-before.xml" || die PROFILE_CARD_DETAIL_UNVERIFIED
  point="$(comment_button_center_from_xml "$EVIDENCE_ROOT/${eid}-before.xml")" || die PROFILE_CARD_COMMENT_BUTTON_UNVERIFIED
  read x y <<< "$point"
  "$ADB" -s "$SERIAL" shell input tap "$x" "$y" || die PROFILE_CARD_COMMENT_OPEN_FAILED
  wait_ms 700
}
profile_card_link() {
  local pc_vid="$1" pc_uid="$2" pc_nick="$3" pc_body="$4" pc_eid="$5" pc_xy pc_x pc_y
  require_held_lock profile_card_link
  require_target_for profile_card_link
  [[ "$("$ADB" -s "$SERIAL" shell getprop ro.build.version.sdk | tr -d '\r')" == 34 ]] || die PROFILE_CARD_SDK_UNVERIFIED
  require_evidence_id "$pc_eid"
  [[ "$pc_vid" == <-> && "$pc_body" == [a-f0-9]## && ${#pc_body} == 64 && -n "$pc_uid" ]] || die PROFILE_CARD_SCOPE_INVALID
  [[ -z "$(find "$EVIDENCE_ROOT" -maxdepth 1 -name "${pc_eid}*" -print -quit)" ]] || die PROFILE_CARD_EVIDENCE_EXISTS
  profile_card_open_comments "${pc_eid}-open-comments"
  ui_evidence "${pc_eid}-select-comments" >/dev/null
  pc_xy="$(profile_card_point comment "$EVIDENCE_ROOT/${pc_eid}-select-comments.xml")" || die PROFILE_CARD_COMMENT_UNVERIFIED
  read pc_x pc_y <<< "$pc_xy"
  read_commenter_identity "$pc_x" "$pc_y" "$pc_nick" "$pc_eid" metadata-card "$pc_uid" "$pc_body" "$pc_vid"
}
profile_card_finish() {
  local pc_eid="$1" pc_uid="$2" pc_nick="$3" pc_body="$4" pc_vid="$5" pc_url pc_xy pc_x pc_y
  profile_card_point profile "$EVIDENCE_ROOT/${pc_eid}-profile.xml" >/dev/null || die PROFILE_CARD_UID_MISMATCH
  profile_card_tap more "$EVIDENCE_ROOT/${pc_eid}-profile.xml"
  ui_evidence "${pc_eid}-more" >/dev/null
  profile_card_tap share "$EVIDENCE_ROOT/${pc_eid}-more.xml"
  ui_evidence "${pc_eid}-share" >/dev/null
  profile_card_tap copy "$EVIDENCE_ROOT/${pc_eid}-share.xml"
  "$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d 'snssdk1128://search/tabs?keyword=%20' >/dev/null || die PROFILE_CARD_SCRATCH_OPEN_FAILED
  wait_ms 1000
  ui_evidence "${pc_eid}-scratch-field" >/dev/null
  profile_card_tap field "$EVIDENCE_ROOT/${pc_eid}-scratch-field.xml"
  ui_evidence "${pc_eid}-scratch-before" >/dev/null
  profile_card_point field "$EVIDENCE_ROOT/${pc_eid}-scratch-before.xml" >/dev/null || die PROFILE_CARD_SCRATCH_FIELD_UNVERIFIED
  "$ADB" -s "$SERIAL" shell input keyevent 279 || die PROFILE_CARD_PASTE_FAILED
  wait_ms 600
  ui_evidence "${pc_eid}-scratch-pasted" >/dev/null
  pc_url="$(profile_card_point link "$EVIDENCE_ROOT/${pc_eid}-scratch-pasted.xml")" || die PROFILE_CARD_URL_INVALID
  "$PYTHON_BIN" "$PHONE_CONTROLLER_DIR/profile-card-link.py" reopen "$EVIDENCE_ROOT" "$pc_uid" "$pc_nick" "$pc_body" "$pc_eid" "$ADB" "$SERIAL" "$pc_url" || die PROFILE_CARD_OPEN_FAILED
  wait_ms 1200
  ui_evidence "${pc_eid}-reopened" >/dev/null
  profile_card_point profile "$EVIDENCE_ROOT/${pc_eid}-reopened.xml" >/dev/null || die PROFILE_CARD_REOPEN_UID_MISMATCH
  "$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "snssdk1128://aweme/detail/$pc_vid" >/dev/null || die PROFILE_CARD_VIDEO_OPEN_FAILED
  wait_ms 1000
  current_video_link "${pc_eid}-verify-video" > "$EVIDENCE_ROOT/${pc_eid}-video-identity.txt" || die PROFILE_CARD_RETURN_VIDEO_UNVERIFIED
  /usr/bin/grep -qx "video_id=$pc_vid" "$EVIDENCE_ROOT/${pc_eid}-video-identity.txt" || die PROFILE_CARD_WRONG_RETURN_VIDEO
  profile_card_open_comments "${pc_eid}-return-comments"
  ui_evidence "${pc_eid}-restored-comments" >/dev/null
  local returned="$EVIDENCE_ROOT/${pc_eid}-restored-comments.xml"
  if ! profile_card_point comment "$returned" >/dev/null 2>&1; then
    local swipe x start_y end_y
    swipe="$(profile_card_point comment-scroll "$returned")" || die PROFILE_CARD_RETURN_COMMENT_UNVERIFIED
    read x start_y end_y <<< "$swipe"
    /bin/cp -p "$returned" "$EVIDENCE_ROOT/${pc_eid}-restored-comments-first.xml" || die PROFILE_CARD_RETURN_COMMENT_UNVERIFIED
    "$ADB" -s "$SERIAL" shell input swipe "$x" "$start_y" "$x" "$end_y" 500 || die PROFILE_CARD_RETURN_COMMENT_UNVERIFIED
    wait_ms 800
    ui_evidence "${pc_eid}-restored-comments" >/dev/null
    profile_card_point comment "$returned" >/dev/null || die PROFILE_CARD_RETURN_COMMENT_UNVERIFIED
  fi
  "$PYTHON_BIN" "$PHONE_CONTROLLER_DIR/profile-card-link.py" pack "$EVIDENCE_ROOT" "$pc_uid" "$pc_nick" "$pc_body" "$pc_eid" "$pc_vid" "$PROFILE" "$PHONE_CONTROLLER_DIR/douyin-phone-adb"
}
