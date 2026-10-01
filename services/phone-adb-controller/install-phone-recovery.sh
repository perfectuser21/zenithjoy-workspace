#!/bin/bash
# 开机运行于登录用户：复用其ADB密钥、手机锁及SSH身份，不启动root ADB。
set -euo pipefail
user_name="$(id -un)"
script_path="$HOME/bin-harvest/phone-recovery.mjs"
label="com.zenithjoy.phonerecovery"
plist="/Library/LaunchDaemons/$label.plist"
[[ -s "$script_path" ]] || { echo 'PHONE_RECOVERY install missing script'; exit 1; }
[[ "${1:-}" == 'xian-m4' ]] || { echo 'PHONE_RECOVERY install invalid host'; exit 1; }
[[ "$user_name" =~ ^[a-zA-Z0-9_-]+$ && "$HOME" =~ ^/[a-zA-Z0-9_/-]+$ ]] || exit 1
stage="$(mktemp)"
trap 'rm -f "$stage"' EXIT
cat > "$stage" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>UserName</key><string>$user_name</string>
<key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>$script_path</string></array>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string><key>PHONE_RECOVERY_HOST</key><string>xian-m4</string><key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/>
<key>StartInterval</key><integer>300</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$HOME/phone-recovery.log</string>
<key>StandardErrorPath</key><string>$HOME/phone-recovery.err</string>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$stage"
if [[ -f "$plist" ]] && cmp -s "$stage" "$plist"; then
  sudo -n launchctl print "system/$label" >/dev/null
  echo 'PHONE_RECOVERY installed unchanged'
else
  sudo -n install -o root -g wheel -m 644 "$stage" "$plist"
  if sudo -n launchctl print "system/$label" >/dev/null 2>&1; then sudo -n launchctl bootout "system/$label"; fi
  sudo -n launchctl bootstrap system "$plist"
  sudo -n launchctl print "system/$label" >/dev/null
  echo 'PHONE_RECOVERY installed'
fi
