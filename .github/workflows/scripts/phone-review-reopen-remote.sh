#!/usr/bin/env bash
# Runs on MMV under the established Tailnet/SSH route. All M4 writes are a
# separately approved controlled phase; no deployment release is promoted.
set -euo pipefail

SHA=${1:?candidate SHA}
PHASE=${2:?phase}
SAFETY_TX=${3:?safety transaction}
RELEASE_ID=${4-}
RUN_ID=${5:?workflow run}
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$SAFETY_TX" =~ ^phone-safety-[a-f0-9]{24}$ ]]
[[ "$RUN_ID" =~ ^[1-9][0-9]{0,15}$ ]]
[[ "$PHASE" == prepare || "$PHASE" == finalize ]]
if [[ "$PHASE" == finalize ]]; then
  [[ "$RELEASE_ID" =~ ^[a-f0-9-]{36}$ ]]
else
  [[ -z "$RELEASE_ID" ]]
fi

REPO="$HOME/perfect21/zenithjoy-workspace"
case "$(git -C "$REPO" remote get-url origin)" in
  https://github.com/perfectuser21/zenithjoy-workspace.git|https://github.com/perfectuser21/zenithjoy-workspace|git@github.com:perfectuser21/zenithjoy-workspace.git) ;;
  *) echo 'untrusted source repository' >&2; exit 1 ;;
esac
git -C "$REPO" fetch --force origin refs/heads/main:refs/remotes/origin/main
[[ "$(git -C "$REPO" rev-parse refs/remotes/origin/main)" == "$SHA" ]]

TOOL_DIR="/Users/jinnuoshengyuan/.config/zenithjoy/phone-reopen-tools/${SHA}-${RUN_ID}"
REMOTE="xian-m4"
# Git archive contains exactly the fixed main tree. New private tool directory
# per dispatch prevents reuse of a prior or foreign unpacked helper.
git -C "$REPO" archive "$SHA" services/phone-adb-controller | \
  ssh -o BatchMode=yes -o ConnectTimeout=20 "$REMOTE" \
  "set -euo pipefail; test \"\$(id -un)\" = jinnuoshengyuan; umask 077; test ! -L /Users/jinnuoshengyuan/.config; mkdir -p /Users/jinnuoshengyuan/.config/zenithjoy; test ! -L /Users/jinnuoshengyuan/.config/zenithjoy; mkdir -p /Users/jinnuoshengyuan/.config/zenithjoy/phone-reopen-tools; test ! -L /Users/jinnuoshengyuan/.config/zenithjoy/phone-reopen-tools; mkdir -m 700 '$TOOL_DIR'; tar -xf - -C '$TOOL_DIR'"

TOOL="$TOOL_DIR/services/phone-adb-controller/maintenance-reopen-host.py"
if [[ "$PHASE" == prepare ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=20 "$REMOTE" \
    "python3 '$TOOL' prepare '$SAFETY_TX' '$SHA' </dev/null"
else
  ssh -o BatchMode=yes -o ConnectTimeout=20 "$REMOTE" \
    "python3 '$TOOL' finalize '$SAFETY_TX' '$SHA' '$RELEASE_ID' </dev/null"
fi
