#!/usr/bin/env bash
set -euo pipefail

: "${ANDROID_REMOTE_HOST:?}"

ssh_args=(-o BatchMode=yes)
if [ -n "${ANDROID_SSH_CONTROL_PATH:-}" ]; then
  ssh_args+=(
    -o ControlMaster=auto
    -o "ControlPath=$ANDROID_SSH_CONTROL_PATH"
    -o ControlPersist=600
  )
fi

# Send argv as a NUL-delimited stream so URIs and shell metacharacters never
# get re-parsed by the remote login shell.
remote_command='/usr/bin/ruby -e '\''argv = STDIN.read.split("\0"); exec(*argv)'\'''
{
  printf '/opt/homebrew/bin/adb\0'
  printf '%s\0' "$@"
} | ssh "${ssh_args[@]}" "$ANDROID_REMOTE_HOST" "$remote_command"
