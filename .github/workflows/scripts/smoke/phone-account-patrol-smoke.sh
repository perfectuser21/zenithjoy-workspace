#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
python3 -m unittest discover -s "$root/scripts/phone-account-patrol" -p 'test_runner.py'
python3 -m compileall -q "$root/scripts/phone-account-patrol"
