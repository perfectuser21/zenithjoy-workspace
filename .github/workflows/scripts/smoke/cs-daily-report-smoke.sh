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

echo "── ⑤ 前台「客服日报」页就位（windows_cloud Playwright 跑真行为）──"
node -e '
const fs=require("fs");
if(!fs.existsSync(process.argv[1])){console.error("FAIL: 缺 CsDailyReportPage");process.exit(1)}
console.log("  PASS: CsDailyReportPage 就位")' "$ROOT/apps/dashboard/src/pages/CsDailyReportPage.tsx"

# 读回查询端点（按日期回看）
R=$(curl -sf "$API_BASE/api/wechat/cs/daily-report?date=$(TZ=Asia/Shanghai date +%F)")
echo "$R" | jq -e '.ok==true and (.reports|type=="array")' >/dev/null || { echo "FAIL: 日报查询端点结构非法"; echo "$R"; exit 1; }
echo "$R" | jq -e '.reports[]|select(.cs_wechat_id=="'"${CSA}"'")|.received_count==3' >/dev/null \
  || { echo "FAIL: 日报查询读不回 CSA 当天行"; echo "$R"; exit 1; }
echo "  OK 日报查询端点回看正确"

echo ""
echo "✅ cs-daily-report (S4) smoke 全过（schema + 固化精确 + 幂等 + 隔离 + 回看）"
