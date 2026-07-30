#!/usr/bin/env bash
# account-scan-realmachine-smoke.db-ssh-host-default.test.sh — TDD Red 阶段
#
# 复现真实 bug（task 1d087bfe-cf40-4d28-a5b4-76383565510e，xian-rog 真机 run
# 30505306586 首次真正跑到 Step 2 才暴露——此前一直被 401/签名冲突/无障碍组件名
# 三层问题挡在更早的步骤，从未真正执行到这一行过）：
#
# 脚本默认 `DB_SSH_HOST="${DB_SSH_HOST:-hk-vps}"`，但 xian-rog runner 自己的
# ~/.ssh/config 里配的别名其实是 "vps-hk"（词序颠倒）。旧默认值在 xian-rog 上
# `ssh: Could not resolve hostname hk-vps` 直接失败，且被脚本 `2>/dev/null` 吞掉，
# 表现为"DB 查无匹配"而非明显的连接错误——已用真机 SSH 交叉验证：`ssh hk-vps`
# 解析失败，`ssh vps-hk` 能正常连上并查到真实数据。
#
# 本测试锁死默认值必须是 "vps-hk"，不是 "hk-vps"。
#
# 用法: bash account-scan-realmachine-smoke.db-ssh-host-default.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh DB_SSH_HOST 默认别名回归测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在 —— Generator 尚未实现，TDD Red 阶段正常现象"
  exit 1
fi

PASSED=0
FAILED=0

# 静态断言：脚本源码里默认值必须是 vps-hk，不能再是拼错词序的 hk-vps
if grep -q 'DB_SSH_HOST:-vps-hk' "$SCRIPT"; then
  echo "✅ PASS: DB_SSH_HOST 默认值是 vps-hk（xian-rog 真实 SSH 别名）"
  PASSED=$((PASSED+1))
else
  echo "❌ FAIL: DB_SSH_HOST 默认值不是 vps-hk——xian-rog 上会 ssh 解析失败(词序写反)"
  FAILED=$((FAILED+1))
fi

if grep -q 'DB_SSH_HOST:-hk-vps' "$SCRIPT"; then
  echo "❌ FAIL: 脚本里仍残留错误别名 hk-vps"
  FAILED=$((FAILED+1))
else
  echo "✅ PASS: 脚本里不再有错误别名 hk-vps"
  PASSED=$((PASSED+1))
fi

echo ""
echo "DB_SSH_HOST 默认别名回归测试: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
