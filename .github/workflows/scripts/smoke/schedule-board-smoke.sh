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

# 层8d: 一屏一台机 —— 左实时画面 + 右「按部门分组、固定高度内部滚动」的任务表
#       （主理人 0920 三改：「我觉得一个 table 的形式会比较好，就直接都是那种 table。
#         每个部门从早到晚是怎么排的，以 table 的形式去分。我一直在说这一页的 table
#         你不要特别长让我去滑，页面的高度是定的就这一页，里面可以加一个上下滑杆」）
TBL="apps/dashboard/src/components/DeptTaskTable.tsx"
[ -s "${TBL}" ] || fail "部门分组任务表组件缺失"
TSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "${TBL}")
grep -qF '<table' <<< "${TSRC}" || fail "不是表格形态（主理人明确要 table）"
grep -qF 'groupByDept' <<< "${TSRC}" || fail "没有按部门分组（主理人要求按部门分）"
grep -qF 'dept-head' <<< "${TSRC}" || fail "分组没有可见的部门表头"
grep -qF 'task-row' <<< "${TSRC}" || fail "每件活没有独立一行"
grep -qF 'parallelWith' <<< "${TSRC}" || fail "没算并行（同时段的活要能看出来）"
grep -qF 'parallel-badge' <<< "${TSRC}" || fail "并行没有可见标记"
grep -qF 'explainError' <<< "${TSRC}" || fail "未接失败码翻译（行里会露机器码）"
for h in 时间 任务 状态 说明; do
  grep -qF ">${h}<" <<< "${TSRC}" || fail "任务表缺「${h}」列"
done
# 这是主理人重复强调三次的点：页面高度定死，滚动发生在表格内部
grep -qF 'overflow-y-auto' <<< "${TSRC}" || fail "表格不能自己滚，页面会被撑长"
grep -qE 'h-\[[0-9]+px\]' <<< "${TSRC}" || fail "表格没有固定高度（主理人三次强调页面高度是定的）"
grep -qF 'sticky' <<< "${TSRC}" || fail "列头没钉住，滚下去就不知道哪列是哪列"

# 工作机页必须是一屏一台：芯片切机 + 左画面 + 右任务表
grep -qF 'device-chip' <<< "${PSRC}" || fail "工作机页没有机器切换芯片（又会变成所有机往下堆）"
grep -qF '<DeptTaskTable' <<< "${PSRC}" || fail "工作机页没挂部门分组任务表"
grep -qF '<PhoneFrame' <<< "${PSRC}" || fail "工作机页左边缺实时画面"
grep -qF 'workerLiveUrl' <<< "${PSRC}" || fail "工作机页没接实时画面地址"
[ ! -e "apps/dashboard/src/components/DayCalendar.tsx" ] || fail "日历仍在，应已换成按部门分组的任务表"
[ ! -e "apps/dashboard/src/components/DeviceTaskTable.tsx" ] || fail "旧的每台一张表仍在"
[ ! -e "apps/dashboard/src/components/ScheduleGantt.tsx" ] || fail "甘特表仍在"

# 层8e: 样例排期的密度要对得上真机一天的量（主理人 0920：「我记着原来有那么多工作呢呀，
#       你现在咋一弄就变得很少了？那一天不是好多个吗？」实测金诺机当天真跑 24 件，
#       样例却只有 4 行——撑不满固定高度的表格，他要的上下滑杆根本不出现）
grep -qF 'outreachRuns' <<< "$SRC" || fail "样例没有按单展开的触达（又会压成一条「今日额度」）"
! grep -qF '今日额度' <<< "$SRC" || fail "样例里还留着把一整天压成一行的「今日额度」"
grep -qF '触达 · 单#' <<< "$SRC" || fail "触达单没按真机写法带单号与昵称"
grep -qF 'NICKNAMES' <<< "$SRC" || fail "触达单缺昵称池，单子看起来不像真的"

# 层8f: 表里必须答得出「还能往哪加」（主理人 0921：「你让我感觉不到一个点——我的空白
#       时间在哪？我这台手机还有哪些能给我安排进去的？哪些是空白点我可以再往里加的？」）
GAP="apps/dashboard/src/components/schedule-gaps.ts"
[ -s "${GAP}" ] || fail "空档计算缺失"
GSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "${GAP}")
grep -qF 'export function findGaps' <<< "${GSRC}" || fail "没有找空档的函数"
grep -qF 'usableMinutes' <<< "${GSRC}" || fail "横跨此刻的空档没扣掉已过去那半截"
grep -qF 'past' <<< "${GSRC}" || fail "没区分已过去与还能用的空档"
grep -qF 'canFit' <<< "${GSRC}" || fail "没算空档能塞几单"
grep -qF 'export function headroomText' <<< "${GSRC}" || fail "没把「还能加多少」算成一句话"
grep -qF 'limitedBy' <<< "${GSRC}" || fail "没说清是被时间卡住还是被额度卡住"
grep -qF 'gap-row' <<< "${TSRC}" || fail "表里没把空档单独成行（空白点还是看不见）"
grep -qF '还能插' <<< "${TSRC}" || fail "空档行没写还能塞几单"
grep -qF '还能加' <<< "${TSRC}" || fail "表头没回答今天还能加多少"
grep -qF '排满了' <<< "${TSRC}" || fail "排满的一天没明说没空档了"

# 层8g: 空档必须看得见 —— 表格右边一条 24 小时占用条（主理人 0921：「我觉得你这个不是
#       很明显。应该是左边是已经排的东西，右边能看出这几个地方是空的、空的、空的。
#       你现在写的这我也不知道能空多少、差多少，很烦，不明显」）
BAR="apps/dashboard/src/components/OccupancyBar.tsx"
[ -s "${BAR}" ] || fail "占用条组件缺失"
BSRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "${BAR}")
grep -qF 'export function segments' <<< "${BSRC}" || fail "没有把一天切成占用/空白两种段"
grep -qF 'heightPct' <<< "${BSRC}" || fail "段高不是按时长成比例（空多大就看不出来了）"
grep -qF 'bar-busy' <<< "${BSRC}" || fail "占用段没画出来"
grep -qF 'bar-free' <<< "${BSRC}" || fail "空白段没画出来（这正是主理人要看的）"
grep -qF 'showLabel' <<< "${BSRC}" || fail "大块空白没直接标时长"
grep -qF 'bar-now' <<< "${BSRC}" || fail "占用条缺现在线"
grep -qF '<OccupancyBar' <<< "${TSRC}" || fail "任务表右边没挂占用条"

# 层9: 生产链实际会写的失败码都要有人话，漏一个页面就露机器码
ESRC=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$ERRC")
for c in executor_lost superseded lock_busy device_offline keywords_unavailable transient_exhausted; do
  grep -qE "^[[:space:]]*${c}:" <<< "$ESRC" || fail "失败码 ${c} 没登记人话（页面会露机器码）"
done
grep -qF 'needsHuman' <<< "$ESRC" || fail "失败码缺「要不要人处理」判定"

echo "schedule-board-smoke: OK"
