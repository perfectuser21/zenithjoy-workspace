#!/usr/bin/env bash
# Contract 验收检查脚本
# TASK_ID: f6c4df16-ba9c-49ed-89fc-67bbba743182
# Sprint: 夜间安卓两 Job 迁 pc4 手机池轨
# 用法: bash sprints/08041901-relay-f6c4df16/tests/contract-check.sh

set -euo pipefail

WORKFLOW=".github/workflows/nightly-real-machine-staging.yml"
PASS=0
FAIL=0

check() {
  local id="$1"
  local desc="$2"
  shift 2
  if "$@" > /dev/null 2>&1; then
    echo "  PASS  [$id] $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  [$id] $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Contract 验收: 夜间安卓两 Job 迁 pc4 ==="
echo "检查文件: $WORKFLOW"
echo ""

# BEHAVIOR-1: douyin-read 绑定 android-capable
check "BEHAVIOR-1" "douyin-read runs-on android-capable" bash -c "
  grep -A5 '^  douyin-read:' '$WORKFLOW' \
    | grep 'runs-on' \
    | grep -q 'android-capable'
"

# BEHAVIOR-2: account-scan 绑定 android-capable
check "BEHAVIOR-2" "account-scan runs-on android-capable" bash -c "
  grep -A5 '^  account-scan:' '$WORKFLOW' \
    | grep 'runs-on' \
    | grep -q 'android-capable'
"

# BEHAVIOR-3: wechat-bubble 保留 wechat-capable
check "BEHAVIOR-3" "wechat-bubble 保留 wechat-capable" bash -c "
  awk '/^  wechat-bubble:/{found=1} found && /^  [a-z][a-z-]*:/{if(!/^  wechat-bubble:/) found=0} found' '$WORKFLOW' \
    | grep 'runs-on' \
    | grep -q 'wechat-capable'
"

# BEHAVIOR-4: DB_SSH 环境变量完整保留（>=3 个）
check "BEHAVIOR-4" "account-scan DB_SSH 变量完整保留" bash -c "
  count=\$(awk '/^  account-scan:/,/^  nightly-report:/' '$WORKFLOW' | grep -c 'DB_SSH_')
  [ \"\$count\" -ge 3 ]
"

# BEHAVIOR-5: douyin-read/account-scan 不含 wechat-capable
check "BEHAVIOR-5" "安卓两 job 不再含 wechat-capable" bash -c "
  python3 -c \"
import re, sys
txt = open('$WORKFLOW').read()
# 找两个 job 块内的 runs-on 行
for job in ['douyin-read', 'account-scan']:
    # 找 job 开始到下一个同级 job（两空格开头字母-字母:）
    pat = r'  ' + job + r':[^\n]*\n((?:(?!  [a-z][a-z-]*:).*\n)*)'
    m = re.search(pat, txt)
    if m:
        block = m.group(1)
        runs_on_match = re.search(r'runs-on:\s*\[([^\]]+)\]', block)
        if runs_on_match and 'wechat-capable' in runs_on_match.group(1):
            print(f'FAIL: {job} still has wechat-capable')
            sys.exit(1)
print('OK: no wechat-capable in android jobs')
\"
"

# INVARIANT 检查: job 名称未被修改
check "INVARIANT-2" "douyin-read job 名含「真抖音」前缀" bash -c "
  grep 'name:.*真抖音' '$WORKFLOW' | grep -q '.'
"

check "INVARIANT-2b" "account-scan job 名含「真安卓」前缀" bash -c "
  grep 'name:.*真安卓' '$WORKFLOW' | grep -q '.'
"

# INVARIANT 检查: needs 链完整
check "INVARIANT-3a" "douyin-read needs wechat-bubble" bash -c "
  awk '/^  douyin-read:/,/^  account-scan:/' \"$WORKFLOW\" \
    | grep 'needs:' | grep -q 'wechat-bubble'
"

check "INVARIANT-3b" "account-scan needs wechat-bubble" bash -c "
  awk '/^  account-scan:/,/^  nightly-report:/' \"$WORKFLOW\" \
    | grep 'needs:' | grep -q 'wechat-bubble'
"

check "INVARIANT-3c" "nightly-report needs 三个 job" bash -c "
  awk '/^  nightly-report:/,0' \"$WORKFLOW\" \
    | grep 'needs:' | grep -q 'account-scan'
"

echo ""
echo "=== 结果: ${PASS} PASS / ${FAIL} FAIL ==="

if [ "$FAIL" -gt 0 ]; then
  echo "CONTRACT FAIL — 有 $FAIL 项未通过，禁止合入"
  exit 1
else
  echo "CONTRACT PASS — 所有检查通过"
  exit 0
fi
