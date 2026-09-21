#!/usr/bin/env bash
# Smoke: 工作目录与领单器分派的一致性（task 3abb7f8c）
#
# 守一件事：**页面上列出来的活，工作机那边必须认得**。
# 两边对不上时，主理人点了会得到 UNKNOWN_JOB_TYPE —— 页面显示排着、实际必然失败，
# 正是这条链前几轮反复栽的那类"看着有、其实跑不了"。
#
# 纯静态比对，不依赖后端与真机：CI 上跑得起来，本地也能跑。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CATALOG="${ROOT}/apps/dashboard/src/api/job-catalog.ts"
CLAIMER="${ROOT}/services/phone-adb-controller/device-job-claimer.sh"
FAIL=0
ok()  { printf '  ✓ %s\n' "$1"; }
bad() { printf '  ✗ %s\n' "$1"; FAIL=1; }

for f in "${CATALOG}" "${CLAIMER}"; do
  [ -f "${f}" ] || { echo "❌ 找不到 ${f}"; exit 1; }
done

echo "== 目录里的每件活，领单器都要能分派 =="
# 取 catalog 里的 id（剥注释，避免命中注释里写的字样）
IDS=$(grep -v "^\s*[/*]" "${CATALOG}" | grep -oE "id: '[a-z_]+'" | sed "s/id: '//; s/'//")
[ -n "${IDS}" ] || bad "catalog 里一个 job id 都没解析到"
for id in ${IDS}; do
  if grep -v "^\s*#" "${CLAIMER}" | grep -qE "^\s*${id}\)"; then
    ok "${id} 有对应的分派分支"
  else
    bad "${id} 在领单器里没有分派分支——页面能派、机器不认"
  fi
done

echo "== 领单器必须有兜底分支，不能让未知的活静默成功 =="
if grep -v "^\s*#" "${CLAIMER}" | grep -q "UNKNOWN_JOB_TYPE"; then
  ok "未知 job_type 会判失败并回执"
else
  bad "领单器没有 UNKNOWN_JOB_TYPE 兜底"
fi

echo "== 目录不得替工作机决定本地概念（profile / 脚本路径）=="
if grep -v "^\s*[/*]" "${CATALOG}" | grep -qE "profile|bin-harvest|douyin-phone-adb"; then
  bad "catalog 里出现了工作机本地概念——中台猜这些必错（单 03aa758d 的教训）"
else
  ok "catalog 只描述「有哪些活、要填什么」"
fi

echo "== 每件活都要有人话说明，不能只有一个名字 =="
SUMMARIES=$(grep -c "summary:" "${CATALOG}")
COUNT=$(echo "${IDS}" | wc -w | tr -d ' ')
if [ "${SUMMARIES}" -ge "${COUNT}" ]; then
  ok "${COUNT} 件活都写了 summary"
else
  bad "有活没写 summary（${SUMMARIES}/${COUNT}）"
fi

if [ "${FAIL}" -ne 0 ]; then
  echo "❌ job-catalog smoke 失败"
  exit 1
fi
echo "✅ job-catalog smoke 全部通过"
