#!/usr/bin/env bash
# leadgen-field-cleanup-smoke.sh —— 抖音获客线索表字段收敛 + 自有账号/视频去重 + 成功触达 冒烟
#
# 覆盖：
#   1. phone-adb-controller 纯函数库单测（own-accounts-lib/lead-fields-lib/next-outreach-lib，
#      node --test 真实断言，非 mock 空转）
#   2. Path 2 触达状态 → 成功触达 映射单测（vitest，limited/failed 禁止假"是"）
#   3. 回归闸：金诺线索表写入路径不得再出现已删除的「抖音昵称/主页链接」「命中关键词」字段写入
#      （防字段收敛被后续改动悄悄打回；评论池表自己的「命中关键词」字段不受影响，本闸只认
#      冒号写入形态，不会误伤 sort-comments.js 里读评论池的 fields["命中关键词"]）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

echo "[1/3] phone-adb-controller 纯函数库单测（own-accounts-lib/lead-fields-lib/next-outreach-lib）"
node --test "$ROOT"/services/phone-adb-controller/__tests__/*.test.mjs

echo "[2/3] Path2 触达状态→成功触达 映射单测"
( cd "$ROOT/apps/api" && npx vitest run tests/p2-sprint-b1-ws4/lead-writer.test.ts src/services/lead-writer.test.ts )

echo "[3/3] 回归闸：线索表写入路径不得残留已删除字段写入"
if grep -n '"抖音昵称/主页链接":\|"命中关键词":' \
    "$ROOT"/services/phone-adb-controller/push-leads.js \
    "$ROOT"/services/phone-adb-controller/sort-comments.js \
    "$ROOT"/services/phone-adb-controller/next-outreach.js \
    "$ROOT"/services/phone-adb-controller/next-outreach-lib.js \
    "$ROOT"/services/phone-adb-controller/update-profile-links.js; then
  echo "::error::线索表写入路径残留已删除字段写入(抖音昵称/主页链接 或 命中关键词)"
  exit 1
fi

echo "PASS leadgen-field-cleanup-smoke"
