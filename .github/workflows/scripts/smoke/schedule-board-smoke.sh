#!/usr/bin/env bash
# schedule-board-smoke.sh — 排程看板契约守卫（Brain task f9ab4ab5）
#
# 页面数据当前是 mock，后端接入（docs/handoffs/202609201700-f9ab4ab5-backend.md）时
# 必须照 schedule.api.ts 的类型填。本守卫锁住三件事，防止接入时把契约改瘦：
#   ① 契约字段齐全  ② 切真实数据的开关只有一处  ③ 页面挂在导航上且 mock 有显式标注
# 纯静态断言，CI ubuntu 无需服务端。
set -euo pipefail
API="apps/dashboard/src/api/schedule.api.ts"
PAGE="apps/dashboard/src/pages/WorkersPage.tsx"
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

# 层4: 工作机页必须显式标注样例数据，否则主理人会把 mock 当真数据看
PSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$PAGE")
grep -qF '样例数据' <<< "$PSRC" || fail "工作机页缺『样例数据』提示文案"

# 层5: 排程必须内嵌在工作机页（主理人 0920：不要再弄个新页面），且能翻天
grep -qF 'fetchSchedule' <<< "$PSRC" || fail "工作机页未接排程数据"
grep -qF 'setOffset' <<< "$PSRC" || fail "工作机页缺前后翻天"

# 层6: 独立排程页必须已删除（内容合并进工作机页，留着会两处维护）
[ ! -e "apps/dashboard/src/pages/SchedulePage.tsx" ] || fail "独立排程页仍在，应已并入工作机页"
! grep -qF "'/dashboard/schedule'" "$NAV" || fail "导航仍有 /dashboard/schedule 残留"

# ── 手机详情页的今日安排与失败码人话化（Brain task 3bbdb025）──
# 主理人：「安排了50个任务、执行了25个，下面还有哪些我看不到，只能看到已完成和失败的」
#         「触达失败了没跟我说为啥」
PLAN="apps/dashboard/src/components/WorkerDayPlan.tsx"
ERRC="apps/dashboard/src/api/error-codes.ts"
LIVE="apps/dashboard/src/pages/WorkerLivePage.tsx"
for f in "$PLAN" "$ERRC" "$LIVE"; do [ -s "$f" ] || fail "${f} 缺失或为空"; done

# 层7: 详情页必须挂今日安排（此前只有 current/steps/history，没有待办队列）
LSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$LIVE")
grep -qF '<WorkerDayPlan' <<< "$LSRC" || fail "详情页未挂 WorkerDayPlan（待办队列会再次消失）"
grep -qF 'explainError' <<< "$LSRC" || fail "详情页未接失败码翻译（会重新甩 executor_lost 这种机器码）"
grep -qF 'h.error_code' <<< "$LSRC" || fail "详情页丢了机器码灰字，排查时无从下手"

# 层8: 今日安排四件套缺一不可
PSRC2=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$PLAN")
for t in 共排 已完成 待跑 要处理 接下来要跑的; do
  grep -qF "$t" <<< "$PSRC2" || fail "今日安排缺「${t}」"
done
# queued/blocked 两处都要：tally 算「待跑 N」，groupPending 列「接下来要跑的」，删任一处功能就残
[ "$(grep -c "status === 'queued'" <<< "$PSRC2")" -ge 2 ] || fail "queued 取值不足两处（今日盘点与待办清单各需一处）"
[ "$(grep -c "status === 'blocked'" <<< "$PSRC2")" -ge 2 ] || fail "blocked 取值不足两处（被挡住的既算要处理也算积压）"

# 层8c: 一屏一台机 —— 左实时画面 + 右纵向 24 小时日历（主理人 0920 二改：
#       「左边一个手机，右边是固定的窗口高度，页面不能随任务变多越来越长；
#         要的是类似 Calendar 的从上到下时间分割，一个页面看一个机器」）
CAL="apps/dashboard/src/components/DayCalendar.tsx"
[ -s "${CAL}" ] || fail "日历组件缺失"
CSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "${CAL}")
grep -qF 'HOUR_PX' <<< "${CSRC}" || fail "日历没有按小时换算的刻度尺（块的位置就没法按时刻算）"
grep -qF 'hour-tick' <<< "${CSRC}" || fail "日历缺整点刻度（看不出几点干啥）"
grep -qF 'cal-block' <<< "${CSRC}" || fail "日历没有把活画成块"
grep -qF 'now-line' <<< "${CSRC}" || fail "日历缺「现在」这条线"
grep -qF 'overflow-y-auto' <<< "${CSRC}" || fail "日历不能自己滚，页面会被撑长"
grep -qE 'h-\[[0-9]+px\]' <<< "${CSRC}" || fail "日历没有固定高度（主理人明确要求固定窗口高度）"
grep -qF 'endsNextDay' <<< "${CSRC}" || fail "跨天的活没做截断处理"
grep -qF 'explainError' <<< "${CSRC}" || fail "日历未接失败码翻译（块里会露机器码）"
# 分列并排 = 同一时段能看出同时在跑几件，这是「并行要排出来」的落点
grep -qF 'cols' <<< "${CSRC}" || fail "日历没算并排列数（同时段的活会叠在一起）"

# 工作机页必须是一屏一台：芯片切机 + 左画面 + 右日历
grep -qF 'device-chip' <<< "${PSRC}" || fail "工作机页没有机器切换芯片（又会变成所有机往下堆）"
grep -qF '<DayCalendar' <<< "${PSRC}" || fail "工作机页没挂日历"
grep -qF '<PhoneFrame' <<< "${PSRC}" || fail "工作机页左边缺实时画面"
grep -qF 'workerLiveUrl' <<< "${PSRC}" || fail "工作机页没接实时画面地址"
[ ! -e "apps/dashboard/src/components/DeviceTaskTable.tsx" ] || fail "每台一张表仍在，应已换成一屏一台的日历"
[ ! -e "apps/dashboard/src/components/ScheduleGantt.tsx" ] || fail "甘特表仍在，应已换成日历"

# 层9: 生产链实际会写的失败码都要有人话，漏一个页面就露机器码
ESRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$ERRC")
for c in executor_lost superseded lock_busy device_offline keywords_unavailable transient_exhausted; do
  grep -qE "^[[:space:]]*${c}:" <<< "$ESRC" || fail "失败码 ${c} 没登记人话（页面会露机器码）"
done
grep -qF 'needsHuman' <<< "$ESRC" || fail "失败码缺「要不要人处理」判定"

echo "schedule-board-smoke: OK"
