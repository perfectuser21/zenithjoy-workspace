#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
python3 -m unittest discover -s "$repo_root/services/wechat-cs-android/tests" -v
