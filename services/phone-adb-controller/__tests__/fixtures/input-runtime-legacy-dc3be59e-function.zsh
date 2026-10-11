text_input() {
  local text bytes eid before_xml focus_line field typed_xml typed_value enable_out cur b64 restored=1
  [[ "$#" == 1 ]] || die "usage: douyin-phone-adb --profile PROFILE --lock-owner RUN text-input UTF8_TEXT"
  text="$1"
  require_held_lock text_input
  if [[ -z "$text" ]]; then
    print -- "text_input=empty_ok bytes=0"
    return 0
  fi
  [[ "$text" != *$'\r'* ]] || ctl_fail text_input fatal bad_text "text must not contain carriage returns"
  bytes="$(print -rn -- "$text" | /usr/bin/wc -c | tr -d ' ')"
  (( bytes <= 6000 )) || ctl_fail text_input fatal bad_text "text is longer than 6000 UTF-8 bytes"
  print -rn -- "$text" | /usr/bin/iconv -f UTF-8 -t UTF-8 >/dev/null 2>&1 || ctl_fail text_input fatal bad_text "text is not valid UTF-8"
  require_target_for text_input
  eid="text-input-$(/bin/date +%Y%m%d%H%M%S)-$$"
  before_xml="$(ui_evidence "${eid}-before")"
  focus_line="$(/usr/bin/grep -oE '<node[^>]+focused="true"[^>]*>' "$before_xml" | /usr/bin/head -1 || true)"
  [[ -n "$focus_line" && "$focus_line" == *'class="android.widget.EditText"'* ]] \
    || ctl_fail text_input retryable no_focused_input "no focused EditText on screen; tap the input field first (evidence=$before_xml)"
  field="$(print -r -- "$focus_line" | /usr/bin/sed -nE 's/.*resource-id="([^"]*)".*/\1/p')"

  # 原输入法存全局：EXIT trap 在函数返回/退出时才跑，local 那时已销毁（见 private-message-send 0916 注释）。
  _TI_ORIG_IME="$(current_ime)"
  [[ -n "$_TI_ORIG_IME" && "$_TI_ORIG_IME" != "null" ]] || ctl_fail text_input needs_human ime_unreadable "original input method could not be read"
  trap 'ti_restore_ime || true' EXIT
  trap 'ti_restore_ime || true; exit 130' INT
  trap 'ti_restore_ime || true; exit 143' TERM
  # 校验沿用 private-message-send 的 0916 判例：enable 结果当场判，区分没装 / 装了启不了。
  enable_out="$("$ADB" -s "$SERIAL" shell ime enable "$ADBKEYBOARD_IME" 2>&1 | tr -d '\r')"
  case "$enable_out" in
    *"now enabled"*|*"already enabled"*) : ;;
    *)
      if ! "$ADB" -s "$SERIAL" shell pm list packages 2>/dev/null | /usr/bin/grep -q adbkeyboard; then
        ctl_fail text_input needs_human adbkeyboard_not_installed "AdbIME 未安装(pm list 无 com.android.adbkeyboard)——该机需先装 ADBKeyboard.apk 才能输入"
      fi
      ctl_fail text_input needs_human adbkeyboard_enable_failed "AdbIME 已安装但启用失败(疑 ROM 限制): $enable_out"
      ;;
  esac
  "$ADB" -s "$SERIAL" shell ime set "$ADBKEYBOARD_IME" >/dev/null 2>&1 || true
  cur="$(current_ime)"
  [[ "$cur" == *adbkeyboard* ]] || ctl_fail text_input retryable ime_switch_failed "AdbIME 切换未生效(当前仍为 $cur)"
  b64="$(print -rn -- "$text" | /usr/bin/base64 | tr -d '\n')"
  "$ADB" -s "$SERIAL" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1 || true
  "$ADB" -s "$SERIAL" shell am broadcast -a ADB_INPUT_B64 --es msg "$b64" >/dev/null 2>&1 || true
  wait_ms 700
  typed_xml="$(ui_evidence "${eid}-typed")"
  typed_value="$(/usr/bin/xmllint --xpath 'string((//node[@focused="true"])[1]/@text)' "$typed_xml" 2>/dev/null || true)"

  # 无论成败先还原输入法并回读，再判结果；还原失败压过一切（手机会卡在 ADBKeyboard 上）。
  ti_restore_ime || restored=0
  trap - EXIT INT TERM
  (( restored )) || ctl_fail text_input needs_human ime_restore_failed "input method stuck at $(current_ime); expected $_TI_ORIG_IME"
  [[ "$typed_value" == "$text" ]] \
    || ctl_fail text_input retryable readback_mismatch "focused field readback did not exactly match the requested text (evidence=$typed_xml)"
  print -- "text_input=ok bytes=$bytes sha256=$(print -rn -- "$text" | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}') field=${field:-unknown} ime_restored=$_TI_ORIG_IME evidence=$typed_xml"
}
