#!/usr/bin/env bash
# leadgen-field-cleanup-smoke.sh —— 抖音获客线索表字段收敛 + 自有账号/视频去重 + 成功触达 冒烟
#
# 覆盖：
#   1. phone-adb-controller 纯函数库单测（own-accounts-lib/lead-fields-lib/next-outreach-lib，
#      node --test 真实断言，非 mock 空转）
#   2. 回归闸：金诺线索表写入路径不得再出现已删除的「抖音昵称/主页链接」「命中关键词」字段写入
#      （防字段收敛被后续改动悄悄打回；评论池表自己的「命中关键词」字段不受影响，本闸只认
#      冒号写入形态，不会误伤 sort-comments.js 里读评论池的 fields["命中关键词"]）
#
# 0922: 原"Path2触达状态→成功触达映射单测"(lead-writer.ts)那一步随系统①(agent-burner.ts,
# lead-writer.ts唯一消费方)退役一并移除——lead-writer.ts没有其他调用方,被删的同时它的
# 单测文件(tests/p2-sprint-b1-ws4/lead-writer.test.ts、src/services/lead-writer.test.ts)
# 也一并删了,不再有东西可跑。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# 这批单测里有一条要直接跑 douyin-phone-adb（zsh 脚本）——取完作品链接后的详情页
# 恢复守卫，见 __tests__/video-link-restore.test.mjs。它刻意设计成「缺 zsh 就报红、
# 绝不 skip」（在 CI 里永远跳过的守卫等于没有守卫），所以这里得先把 zsh 装上。
# 装在脚本里而不是逐个 workflow 里：这套单测被多个闸引用，逐个补必漏一个。
if ! command -v zsh >/dev/null 2>&1; then
  echo "  zsh 缺失，安装中（video-link-restore 守卫需要它直接跑 douyin-phone-adb）"
  sudo apt-get update -qq && sudo apt-get install -y -qq zsh
fi

echo "[1/2] phone-adb-controller 纯函数库单测（own-accounts-lib/lead-fields-lib/next-outreach-lib）"
node --test "$ROOT"/services/phone-adb-controller/__tests__/*.test.mjs

echo "[2/2] 回归闸：线索表写入路径不得残留已删除字段写入"
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
