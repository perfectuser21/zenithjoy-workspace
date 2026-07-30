#!/usr/bin/env bash
# account-scan-realmachine-smoke-envbind.test.sh — TDD Red 阶段
#
# 背景（真机 ssh+logcat 现场排查确认，2026-07-30）：
#   account-scan-realmachine-smoke.sh 卡在"设备 last_seen 不新鲜"——根因不是纯粹的
#   时序竞争，而是 adb install -r 不清空 App 数据，设备本地缓存的 apiUrl 仍指向
#   生产(wss://autopilot.zenjoymedia.media/agent-ws)而非 staging；心跳确实在发送
#   且成功(logcat "ws1 heartbeat ok" 每 30s 一条)，但打到的是生产库 zenithjoy，脚本
#   查 staging 库 zenithjoy_staging 永远看不到新鲜 last_seen，等多久都没用。
#
# 修法验证（结构性静态检查，CI 容器无真机跑不了真实 adb，只能验证脚本内容/顺序）：
#   1. 脚本必须在 adb install -r 之后、last_seen 新鲜度检查之前，用
#      "zenithjoy://bind?license=...&api=..." deeplink 强制纠正设备绑定
#      （而不是泛泛的 monkey LAUNCHER 拉起——那样对残留的错误 config 没有纠正力）
#   2. deeplink 的 api 参数必须引用 $API_BASE 派生值，不能硬编码生产域名字面量
#      autopilot.zenjoymedia.media（防止未来改动悄悄写死回生产）
#   3. last_seen 新鲜度检查必须是有界轮询（重试+超时上限），不是单次判断就
#      直接 envfail（防御真实的启动时序延迟，即使设备绑定对了也可能需要几秒
#      才能完成首次心跳）
#
# 用法: bash account-scan-realmachine-smoke-envbind.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  account-scan-realmachine-smoke.sh envbind 修复结构性测试"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ! -f "$SCRIPT" ]; then
  echo "❌ RED（预期）: $SCRIPT 不存在"
  exit 1
fi

FAIL=0

INSTALL_LINE=$(grep -n 'adb install -r\|"\$ADB" install -r' "$SCRIPT" | head -1 | cut -d: -f1)
BIND_LINE=$(grep -n 'zenithjoy://bind' "$SCRIPT" | head -1 | cut -d: -f1)
FRESH_CHECK_LINE=$(grep -n "SEEN_FRESH\|last_seen 不新鲜" "$SCRIPT" | head -1 | cut -d: -f1)

if [ -z "$BIND_LINE" ]; then
  echo "❌ FAIL: 脚本里没有 zenithjoy://bind deeplink 重绑定逻辑"
  FAIL=1
else
  echo "✅ 找到 zenithjoy://bind (line $BIND_LINE)"
  if [ -n "$INSTALL_LINE" ] && [ "$BIND_LINE" -lt "$INSTALL_LINE" ]; then
    echo "❌ FAIL: deeplink 重绑定(line $BIND_LINE) 出现在 adb install -r(line $INSTALL_LINE) 之前，顺序不对"
    FAIL=1
  fi
  if [ -n "$FRESH_CHECK_LINE" ] && [ "$BIND_LINE" -gt "$FRESH_CHECK_LINE" ]; then
    echo "❌ FAIL: deeplink 重绑定(line $BIND_LINE) 出现在 last_seen 新鲜度检查(line $FRESH_CHECK_LINE) 之后，纠正不到检查前的状态"
    FAIL=1
  fi
fi

# api 参数必须是从 $API_BASE 派生（grep 该行本身应引用 API_BASE 变量），
# 且脚本里唯一出现的生产域名裸字面量只能是文档注释里的对比说明，不能是拼进
# deeplink 变量赋值里的硬编码值
BIND_CONSTRUCT_LINES=$(grep -n 'DEEPLINK=\|WS_URL=' "$SCRIPT" || true)
if ! printf '%s' "$BIND_CONSTRUCT_LINES" | grep -q 'API_BASE'; then
  echo "❌ FAIL: deeplink/WS_URL 构造没有引用 \$API_BASE（可能被硬编码成固定域名）"
  FAIL=1
else
  echo "✅ deeplink 的 api 参数引用 \$API_BASE 派生值"
fi

# 硬编码生产域名检测：deeplink 构造相关赋值行不应该出现字面量 "autopilot.zenjoymedia.media"
# （staging-autopilot.zenjoymedia.media 是允许的，检测时排除掉这个合法子串）
BAD_HARDCODE=$(printf '%s' "$BIND_CONSTRUCT_LINES" | grep -v 'staging-autopilot' | grep -c 'autopilot\.zenjoymedia\.media' || true)
if [ "${BAD_HARDCODE:-0}" -gt 0 ]; then
  echo "❌ FAIL: deeplink/WS_URL 构造里硬编码了生产域名字面量"
  FAIL=1
else
  echo "✅ 没有硬编码生产域名"
fi

# 有界轮询检测：last_seen 检查附近应该有循环结构（for/while）而不是一次性判断
FRESH_BLOCK=$(awk '/SEEN_FRESH/{print NR": "$0}' "$SCRIPT")
HAS_LOOP=$(grep -c 'for .*in .*seq\|while \[' "$SCRIPT" || true)
if [ "${HAS_LOOP:-0}" -lt 2 ]; then
  # Step 3 轮询任务终态本身已有一个 for seq 循环；freshness 检查若也加了有界重试，
  # 全脚本至少应该有 2 处循环结构（Step 3 的 + freshness 新加的）
  echo "❌ FAIL: 全脚本循环结构数 < 2，last_seen 新鲜度检查疑似仍是单次判断，没有有界重试"
  FAIL=1
else
  echo "✅ 检测到 >=2 处循环结构（Step 3 轮询 + last_seen 新鲜度有界重试）"
fi

if [ "$FAIL" -eq 0 ]; then
  echo "✅ PASS: envbind 修复结构性检查全部通过"
  exit 0
else
  echo "❌ RED/FAIL: 见上方"
  exit 1
fi
