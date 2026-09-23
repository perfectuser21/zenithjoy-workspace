#!/usr/bin/env bash
# brain-tasks-page-smoke.sh —— 任务总台（读 Brain task database）
#
# 0923 主理人划的范围：生产前端只负责把 task database 里的任务**显示**出来，
# 留痕（谁跑的/跑多久/烧了多少 token）不在这一页，也不做 UI。
#
# 这个 smoke 守三件在生产上真会咬人的事，每条都有 0923 当天的实证：
#
# ① **api 层必须带 status 参数**。`/api/brain/tasks` 不带过滤参数时只返回 10 个精简字段，
#    带上 `status=` 或 `task_type=` 才返回完整 70+ 字段。我当天不带参数查，得出
#    「device_job 有 0 个」——直接查库是 4 条。少了 task_type/tenant_id，页面就分不出
#    哪条是派给手机的活、算哪个客户的。
#
# ② **读不到必须说读不到，不能退化成空表**。空表和读不到长得一模一样，人会以为
#    「今天没排活」而实际是后台断了。工作机领单器当天实测就在报 BRAIN_UNAVAILABLE。
#
# ③ **这一页读的是 Brain，不是 ZenithJoy 自己的 collect-tasks**。两本账混在一页，
#    「我在看哪本」就说不清了。
set -uo pipefail

FAIL=0
fail() { echo "::error::brain-tasks-page-smoke: $1"; FAIL=1; }
ok()   { echo "  ✅ $1"; }

D_PAGE="apps/dashboard/src/pages/BrainTasksPage.tsx"
D_API="apps/dashboard/src/api/brain-tasks.api.ts"
D_NAV="apps/dashboard/src/config/navigation.config.ts"

# ── 文件在不在 ──────────────────────────────────────────────
[ -s "$D_PAGE" ] || fail "页面文件缺失: $D_PAGE"
[ -s "$D_API" ]  || fail "api 文件缺失: $D_API"
[ -s "apps/dashboard/src/pages/__tests__/BrainTasksPage.test.tsx" ] || fail "页面测试缺失"
[ -s "apps/dashboard/src/api/__tests__/brain-tasks.api.test.ts" ]   || fail "api 测试缺失"

# 只扫代码行：注释里正引用旧写法和反面教材，扫全文会被自己的注释绊倒
# （0922/0923 已复发两次，变异实测都中过）
API_CODE=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$D_API" 2>/dev/null)
PAGE_CODE=$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$D_PAGE" 2>/dev/null)

# ── ① 打的是 Brain，且必须带 status ────────────────────────
grep -qF '/api/brain/tasks' <<< "$API_CODE" \
  || fail "api 没打 /api/brain/tasks —— 这一页的全部意义就是读 task database"
# 两条一起锚，缺一不可：① 查询串里真的构造了 status ② fetch 的 URL 真的把查询串带上了。
# 只锚 ① 会被 `status: string` 这类类型声明蒙混过去（第一版就是这么假绿的，变异实测没拦住）；
# 只锚 ② 则管不住 status 有没有进去。
grep -qE 'URLSearchParams\(\{ status|set\(.status.' <<< "$API_CODE" \
  || fail "查询串里没构造 status：不带过滤时接口只回 10 个精简字段，拿不到 task_type/tenant_id"
grep -qE 'fetch\(.?/api/brain/tasks\?\$\{' <<< "$API_CODE" \
  || fail "fetch 的 URL 没带上查询串 —— status 构造了也没用，接口照样只回精简字段"
if grep -qF 'collect-tasks' <<< "$API_CODE"; then
  fail "读成了 ZenithJoy 自己的 collect-tasks —— 那是另一本账（采集任务），不是 task database"
fi
ok "读 Brain task database 且带 status（能拿到 task_type/tenant_id）"

# ── ② HTTP 错误必须抛，不许吞成空数组 ──────────────────────
grep -qE 'throw new Error' <<< "$API_CODE" \
  || fail "api 层不抛错：HTTP 失败被吞成空数组时，页面会显示成一张空表，人会以为今天没排活"
# 页面侧要有「读取失败」和「暂无任务」两种互斥的文案
grep -qF '读取失败' <<< "$PAGE_CODE" || fail "页面没有「读取失败」态：接口挂了会伪装成没任务"
grep -qF '暂无任务' <<< "$PAGE_CODE" || fail "页面没有「暂无任务」态：真没排活时说不清是没排还是读不到"
ok "读取失败与暂无任务是两种态，不会互相伪装"

# ── ③ 那几个关键列在页面上 ─────────────────────────────────
# 主理人 0923 点名要的：哪个客户、谁派的、谁在做。少一个就退回「只知道有条任务」。
for col in 'task_type' 'tenant_id' 'trigger_source' 'claimed_by'; do
  grep -qF "$col" <<< "$PAGE_CODE" || fail "页面没渲染 $col —— 主理人点名要的字段"
done
ok "类型/客户/谁派的/谁在做 四列都在"

# ── ④ 入口能点到 ───────────────────────────────────────────
grep -qF "'BrainTasksPage'" "$D_NAV" || fail "组件没注册进 navigation.config"
ROUTE_OK=1
grep -qE "path: '/task-board'" "$D_NAV" || { fail "路由 /task-board 没注册，主理人点不到这一页"; ROUTE_OK=0; }
# 同一 path 只许出现一次。0923 实证：第一版用的 /tasks，而那个 path 在「旧路由重定向」里
# 已被占（→ /media/publish），两处打架会表现成「点任务总台跳去了发布页」，生产上极难查。
N_TASKS=$(grep -cE "path: '/task-board'" "$D_NAV")
[ "$N_TASKS" = "1" ] || { fail "/task-board 注册了 $N_TASKS 次（菜单项自带路由，别在 additionalRoutes 重复）"; ROUTE_OK=0; }
# 反向：别再撞上已被占用的 /tasks
grep -qE "path: '/tasks', icon" "$D_NAV" && { fail "侧栏又用了 /tasks —— 它在旧路由重定向里已被占（→ /media/publish）"; ROUTE_OK=0; }
[ "$ROUTE_OK" = "1" ] && ok "侧栏入口 /task-board 注册恰好一次，且没撞上被占的 /tasks"

# ── ⑤ 单测真跑（前面全是静态检查，这条才验行为）────────────
if [ "${SKIP_VITEST:-0}" != "1" ]; then
  if command -v npx >/dev/null 2>&1 && [ -d apps/dashboard/node_modules ]; then
    ( cd apps/dashboard && npx vitest run \
        src/pages/__tests__/BrainTasksPage.test.tsx \
        src/api/__tests__/brain-tasks.api.test.ts >/tmp/btp-vitest.log 2>&1 )
    if [ $? -ne 0 ]; then
      fail "单测未通过: $(tail -5 /tmp/btp-vitest.log | tr '\n' ' ')"
    else
      ok "页面 + api 单测全绿"
    fi
  else
    # 依赖没装时明说跳过，不假装通过
    echo "  ⏭ 跳过单测（apps/dashboard/node_modules 不存在）"
  fi
fi

if [ "$FAIL" = "1" ]; then
  echo "brain-tasks-page-smoke: FAIL"
  exit 1
fi
echo "brain-tasks-page-smoke: PASS"
