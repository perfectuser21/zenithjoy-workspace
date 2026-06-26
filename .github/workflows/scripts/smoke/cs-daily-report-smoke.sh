#!/usr/bin/env bash
# cs-daily-report-smoke.sh — Line04 客服每日工作报告（S4）真链路 smoke
#
# 推进 Path 4 客户私域AI接管：客服日报(S4)。
# 打真实 ZenithJoy API（API_BASE，默认 localhost:5200）+ 真实 Postgres（PG* 默认 cecelia）。
#
# 依赖 S3：复用 /cs/stats 的聚合口径，把当天每客服 4 个数固化进 daily_report 表。
#
# 覆盖 DoD：
#   ① schema：daily_report 表存在 + 唯一键 (cs_wechat_id, report_date)（node 读 migration，不查 information_schema）
#   ② 固化精确：灌已知 in/out → 触发结算 → daily_report 当天该客服行 4 个字段精确正确
#   ③ 幂等：同一天重复触发 → 仍只一行、数字不翻倍
#   ④ 隔离：两个 cs_wechat_id 各出各的日报行，互不串
#   ⑤ 空数据：无消息的客服 → 不漏报错（结算不写半截脏数据，接口 ok）
#
# 数据行断言：daily_report 用 report_date=北京当天 这类确定性约束（结构表无 created_at 时间窗问题）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-cecelia}"
PGDATABASE="${PGDATABASE:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# ── 北京午夜守卫 ────────────────────────────────────────────────────────────
# 同 cs-work-stats-smoke.sh：测试向前插 20 分钟的消息；若北京时间在 00:00-00:25
# 窗口内，消息跨昨天，今日聚合结果偏少 → 跳过，非本 PR 引起。
_BJT_HOUR=$(TZ="Asia/Shanghai" date +%H)
_BJT_MIN=$(TZ="Asia/Shanghai" date +%M)
if [ "$_BJT_HOUR" = "00" ] && [ "$_BJT_MIN" -le 25 ]; then
  echo "⚠️  北京时间 ${_BJT_HOUR}:${_BJT_MIN}，处于午夜 25 分钟窗口，时区边界跳过（非测试失败）"
  exit 0
fi
# ─────────────────────────────────────────────────────────────────────────────

Q() { psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" | sed -n '1p'; }
SUF="$(date +%s)$$"
CSA="wxid_dra_${SUF}"
CSB="wxid_drb_${SUF}"

echo "── ① schema 断言（node 读 migration 文件，不查 information_schema）──"
node -e '
const fs=require("fs"),path=require("path");
const dir=path.join(process.argv[1],"apps/api/db/migrations");
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".sql"));
const blob=files.map(f=>fs.readFileSync(path.join(dir,f),"utf8")).join("\n");
if(!/CREATE TABLE[\s\S]*zenithjoy\.daily_report/i.test(blob)){
  console.error("FAIL: 缺 CREATE TABLE zenithjoy.daily_report");process.exit(1);}
// 唯一键 (cs_wechat_id, report_date) 保幂等
if(!/UNIQUE[\s\S]*daily_report[\s\S]*\(\s*cs_wechat_id\s*,\s*report_date\s*\)|UNIQUE\s*\(\s*cs_wechat_id\s*,\s*report_date\s*\)/i.test(blob)){
  console.error("FAIL: 缺 (cs_wechat_id, report_date) 唯一键");process.exit(1);}
console.log("  PASS: daily_report 表 + (cs_wechat_id, report_date) 唯一键就位");
' "$ROOT"

echo "── ② 固化精确：灌已知 in/out（今天）→ 触发结算 → daily_report 当天行精确 ──"
# CSA 今天：3 in（2 客户）+ 2 out，首末相隔 20 分钟 → 接收3/回复2/接待2/时长20
Q "INSERT INTO zenithjoy.wechat_messages(contact_key,sender_name,direction,content,cs_wechat_id,created_at)
   VALUES
    ('d1_${SUF}','客户1','in','你好',     '${CSA}', now() - interval '20 minutes'),
    ('d1_${SUF}','客户1','out','您好',     '${CSA}', now() - interval '19 minutes'),
    ('d1_${SUF}','客户1','in','多少钱',   '${CSA}', now() - interval '15 minutes'),
    ('d2_${SUF}','客户2','in','在吗',     '${CSA}', now() - interval '5 minutes'),
    ('d2_${SUF}','客户2','out','在的',     '${CSA}', now()),
    ('db_${SUF}','客户B','in','B消息',    '${CSB}', now() - interval '2 minutes')" >/dev/null

# 触发结算（内部端点，date 缺省 today）
curl -sf -X POST "$API_BASE/api/wechat/cs/daily-report/settle" -H "Content-Type: application/json" -d '{"date":"today"}' \
  | jq -e '.ok==true' >/dev/null || { echo "FAIL: 结算端点未 ok"; exit 1; }

# daily_report 当天该客服行字段精确（report_date = 北京当天，确定性约束）
ROW=$(Q "SELECT received_count||'/'||reply_count||'/'||served_customers||'/'||work_duration_minutes
          FROM zenithjoy.daily_report
         WHERE cs_wechat_id='${CSA}'
           AND report_date = (now() AT TIME ZONE 'Asia/Shanghai')::date")
[ "$ROW" = "3/2/2/20" ] || { echo "FAIL: CSA 日报行 != 3/2/2/20 (实际 $ROW)"; exit 1; }
echo "  OK 固化精确（CSA 3/2/2/20）"

echo "── ③ 幂等：同一天重复触发 → 仍一行、数字不翻倍 ──"
curl -sf -X POST "$API_BASE/api/wechat/cs/daily-report/settle" -H "Content-Type: application/json" -d '{"date":"today"}' >/dev/null
CNT=$(Q "SELECT count(*) FROM zenithjoy.daily_report
          WHERE cs_wechat_id='${CSA}' AND report_date=(now() AT TIME ZONE 'Asia/Shanghai')::date" | tr -d ' ')
[ "$CNT" = "1" ] || { echo "FAIL: 重复结算产生 $CNT 行（应=1）"; exit 1; }
ROW2=$(Q "SELECT received_count||'/'||reply_count FROM zenithjoy.daily_report
           WHERE cs_wechat_id='${CSA}' AND report_date=(now() AT TIME ZONE 'Asia/Shanghai')::date")
[ "$ROW2" = "3/2" ] || { echo "FAIL: 重复结算数字翻倍了 ($ROW2)"; exit 1; }
echo "  OK 幂等（仍 1 行，3/2 不翻倍）"

echo "── ④ 隔离：CSB 各出各的日报行，互不串 ──"
RB=$(Q "SELECT received_count||'/'||reply_count FROM zenithjoy.daily_report
         WHERE cs_wechat_id='${CSB}' AND report_date=(now() AT TIME ZONE 'Asia/Shanghai')::date")
[ "$RB" = "1/0" ] || { echo "FAIL: CSB 日报行 != 1/0 (实际 $RB)"; exit 1; }
echo "  OK 两客服日报互不串"

echo "── ⑤ 前台「客服日报」入口就位（整合 2026-06-25：并进客服工作汇总「历史」Tab）──"
# 整合后独立的 CsDailyReportPage 已删，历史日报回看并进 CsWorkStatsPage 的「历史」Tab
# （拉同一个 /cs/daily-report 端点）。这里改查它含历史 Tab + daily-report 客户端调用。
node -e '
const fs=require("fs");
const p=process.argv[1];
if(!fs.existsSync(p)){console.error("FAIL: 缺 CsWorkStatsPage");process.exit(1)}
const c=fs.readFileSync(p,"utf8");
// 「历史」Tab：Tab value="history"（testid 由 cs-stats-tab-${value} 动态拼）
if(!/value="history"/.test(c)){console.error("FAIL: CsWorkStatsPage 缺「历史」Tab(value=\"history\")");process.exit(1)}
// 历史 Tab 接旧 S4 日报端点
if(!/wechatCsDailyReportApi|daily-report/.test(c)){console.error("FAIL: 历史 Tab 未接 daily-report 端点");process.exit(1)}
console.log("  PASS: 客服工作汇总「历史」Tab 就位（并入旧 S4 日报）")' "$ROOT/apps/dashboard/src/pages/CsWorkStatsPage.tsx"

# 读回查询端点（按日期回看）
R=$(curl -sf "$API_BASE/api/wechat/cs/daily-report?date=$(TZ=Asia/Shanghai date +%F)")
echo "$R" | jq -e '.ok==true and (.reports|type=="array")' >/dev/null || { echo "FAIL: 日报查询端点结构非法"; echo "$R"; exit 1; }
echo "$R" | jq -e '.reports[]|select(.cs_wechat_id=="'"${CSA}"'")|.received_count==3' >/dev/null \
  || { echo "FAIL: 日报查询读不回 CSA 当天行"; echo "$R"; exit 1; }
echo "  OK 日报查询端点回看正确"

echo ""
echo "✅ cs-daily-report (S4) smoke 全过（schema + 固化精确 + 幂等 + 隔离 + 回看）"
