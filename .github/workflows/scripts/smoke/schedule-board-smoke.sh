#!/usr/bin/env bash
# schedule-board-smoke.sh — 排程看板契约守卫（Brain task f9ab4ab5）
#
# 页面数据当前是 mock，后端接入（docs/handoffs/202609201700-f9ab4ab5-backend.md）时
# 必须照 schedule.api.ts 的类型填。本守卫锁住三件事，防止接入时把契约改瘦：
#   ① 契约字段齐全  ② 切真实数据的开关只有一处  ③ 页面挂在导航上且 mock 有显式标注
# 纯静态断言，CI ubuntu 无需服务端。
set -euo pipefail
API="apps/dashboard/src/api/schedule.api.ts"
PAGE="apps/dashboard/src/pages/SchedulePage.tsx"
NAV="apps/dashboard/src/config/navigation.config.ts"
fail() { echo "::error::schedule-board-smoke: $1"; exit 1; }

# 层0: 文件存在
for f in "$API" "$PAGE" "$NAV"; do [ -s "$f" ] || fail "$f 缺失或为空"; done

# 去注释文本（注释里写着字段名不算数——0920 phone-wall 踩过这个坑）
SRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$API")

# 层1: 契约字段齐全。后端照这份填，删任一字段页面就少一块信息
for f in 'as_of' 'mock' 'devices'; do
  grep -qE "^[[:space:]]*${f}[?]?:" <<< "$SRC" || fail "SchedulePayload 缺字段 ${f}"
done
for f in 'agent_id' 'name' 'serial' 'online' 'depts' 'quotas' 'slots'; do
  grep -qE "^[[:space:]]*${f}[?]?:" <<< "$SRC" || fail "ScheduleDevice 缺字段 ${f}（看板要靠它显示设备与分组）"
done
for f in 'id' 'title' 'dept' 'planned_at' 'est_minutes' 'status' 'source'; do
  grep -qE "^[[:space:]]*${f}[?]?:" <<< "$SRC" || fail "ScheduleSlot 缺字段 ${f}（缺了就排不出时间线）"
done
for f in 'used' 'cap' 'unit'; do
  grep -qE "^[[:space:]]*${f}[?]?:" <<< "$SRC" || fail "DeptQuota 缺字段 ${f}（缺了就答不了『今天还能加多少量』）"
done

# 层2: 部门取值与 Notion「OPC 经营对象」的「所属部门」对齐，不许各造一套
for d in 智能获客 新媒体部 私域客服 视频剪辑; do
  grep -qF "'$d'" <<< "$SRC" || fail "Dept 少了「${d}」（须与 Notion OPC 经营对象的所属部门对齐）"
done

# 层3: 切真实数据的开关只有一处：fetchSchedule。散落多处 mock 会导致接入后半真半假
grep -qE 'export async function fetchSchedule' <<< "$SRC" || fail "fetchSchedule 不见了（后端接入的唯一开关）"
[ "$(grep -c 'mock: true' <<< "$SRC")" -le 1 ] || fail "mock: true 出现多处，接入后会半真半假"
grep -qE 'mock[?]?: boolean' <<< "$SRC" || fail "SchedulePayload 缺 mock 标记位"

# 层4: 页面必须显式标注样例数据，否则主理人会把 mock 当真数据看
PSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$PAGE")
grep -qF 'data.mock' <<< "$PSRC" || fail "页面未按 mock 标记挂提示，样例数据会被当成真数据"
grep -qF '样例数据' <<< "$PSRC" || fail "页面缺『样例数据』提示文案"

# 层5: 跨部门设备在每个分组下只显示本部门的活，否则积压与额度会被重复计算
grep -qF 's.dept === dept' <<< "$PSRC" || fail "DeviceCard 未按部门过滤 slots（跨部门设备会重复计数）"
grep -qF 'q.dept === dept' <<< "$PSRC" || fail "DeviceCard 未按部门过滤 quotas（额度会被重复计算）"

# 层6: 挂进导航，否则做了也点不到
grep -qF "'/dashboard/schedule'" "$NAV" || fail "导航未注册 /dashboard/schedule"
grep -qF "'SchedulePage'" "$NAV" || fail "导航未注册 SchedulePage 组件"

echo "schedule-board-smoke: OK"
