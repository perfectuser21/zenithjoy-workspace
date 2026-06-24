#!/usr/bin/env bash
# cs-work-stats-smoke.sh — Line04 客服工作汇总统计（S3）真链路 smoke
#
# 推进 Path 4 客户私域AI接管：客服工作汇总(S3)。
# 打真实 ZenithJoy API（API_BASE，默认 localhost:5200）+ 真实 Postgres（PG* 默认 cecelia）。
#
# 覆盖 DoD：
#   ① schema：wechat_messages 有 cs_wechat_id（nullable）+ (cs_wechat_id, created_at) 索引
#      —— 用 node 读 migration 文件内容断言（严禁 psql 查 information_schema，门禁 db-no-time-window 会误杀）
#   ② 口径精确：灌已知 in/out → /cs/stats?date=today 断言
#      received_count / reply_count / served_customers / work_duration_minutes 精确等于预期
#   ③ 数据隔离：两个不同 cs_wechat_id → 各算各的，A 的数绝不出现在 B 卡片
#   ④ 时区：北京今天 00:30（美区当时为昨天）的消息 → 仍归「今天」
#   ⑤ 老数据兼容：cs_wechat_id 为 NULL 的消息 → 不计入任何客服统计、接口不报错
#
# 数据行断言：psql SELECT 一律带时间窗 created_at > NOW() - interval '5 minutes' 防假绿。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-cecelia}"
PGDATABASE="${PGDATABASE:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

Q() { psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" | sed -n '1p'; }
SUF="$(date +%s)$$"
# 本轮两个客服微信号（带随机后缀，互不串台 + 不污染存量）
CSA="wxid_csa_${SUF}"
CSB="wxid_csb_${SUF}"

echo "── ① schema 断言（node 读 migration 文件，不查 information_schema）──"
node -e '
const fs=require("fs"),path=require("path");
const dir=path.join(process.argv[1],"apps/api/db/migrations");
const files=fs.readdirSync(dir).filter(f=>f.endsWith(".sql"));
// 只看「给 wechat_messages 加 cs_wechat_id」那条 migration（按内容定位，避免 daily_report.cs_wechat_id
// (那是 NOT NULL，正确) 误命中 nullable 断言）。
const wmFile=files.map(f=>fs.readFileSync(path.join(dir,f),"utf8"))
  .find(s=>/ALTER TABLE\s+zenithjoy\.wechat_messages[\s\S]*cs_wechat_id/i.test(s));
if(!wmFile){
  console.error("FAIL: 缺 ALTER TABLE wechat_messages ADD cs_wechat_id");process.exit(1);}
// 该 ALTER 行不带 NOT NULL（nullable，向后兼容铁律）
const alterLine=(wmFile.match(/ADD COLUMN[\s\S]*?cs_wechat_id[^\n;]*/i)||[""])[0];
if(/NOT\s+NULL/i.test(alterLine)){
  console.error("FAIL: wechat_messages.cs_wechat_id 不应为 NOT NULL（向后兼容铁律：nullable）");process.exit(1);}
// (cs_wechat_id, created_at) 索引（在同一文件里）
if(!/INDEX[\s\S]*wechat_messages\s*\(\s*cs_wechat_id\s*,\s*created_at\s*\)/i.test(wmFile)){
  console.error("FAIL: 缺 (cs_wechat_id, created_at) 索引");process.exit(1);}
console.log("  PASS: cs_wechat_id nullable + (cs_wechat_id, created_at) 索引就位");
' "$ROOT"

echo "── ② 口径精确：灌已知 in/out（今天）→ /cs/stats?date=today ──"
# CSA 今天：3 条 in（2 个不同客户 c1/c2）+ 2 条 out。
# 首条 = now()-20min，末条 = now()（同一 INSERT 里 now() 语句级稳定 → 首末精确相隔 20 分钟 → 时长=20）。
Q "INSERT INTO zenithjoy.wechat_messages(contact_key,sender_name,direction,content,cs_wechat_id,created_at)
   VALUES
    ('c1_${SUF}','客户1','in','你好',        '${CSA}', now() - interval '20 minutes'),
    ('c1_${SUF}','客户1','out','您好在的',    '${CSA}', now() - interval '19 minutes'),
    ('c1_${SUF}','客户1','in','多少钱',      '${CSA}', now() - interval '15 minutes'),
    ('c2_${SUF}','客户2','in','在吗',        '${CSA}', now() - interval '5 minutes'),
    ('c2_${SUF}','客户2','out','在的呢',      '${CSA}', now())" >/dev/null
# 落库时间窗自检（防假绿）
SEEDED=$(Q "SELECT count(*) FROM zenithjoy.wechat_messages WHERE cs_wechat_id='${CSA}' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "${SEEDED:-0}" -ge 1 ] || { echo "FAIL: CSA 种子未落库（时间窗内）"; exit 1; }

R=$(curl -sf "$API_BASE/api/wechat/cs/stats?date=today")
echo "$R" | jq -e '.ok==true and (.stats|type=="array")' >/dev/null || { echo "FAIL: stats 响应结构非法"; echo "$R"; exit 1; }
A=$(echo "$R" | jq -c '.stats[]|select(.cs_wechat_id=="'"${CSA}"'")')
[ -n "$A" ] || { echo "FAIL: stats 缺 CSA 卡片"; echo "$R"; exit 1; }
echo "$A" | jq -e '.received_count==3' >/dev/null        || { echo "FAIL: received_count != 3"; echo "$A"; exit 1; }
echo "$A" | jq -e '.reply_count==2' >/dev/null            || { echo "FAIL: reply_count != 2"; echo "$A"; exit 1; }
echo "$A" | jq -e '.served_customers==2' >/dev/null       || { echo "FAIL: served_customers != 2"; echo "$A"; exit 1; }
echo "$A" | jq -e '.work_duration_minutes==20' >/dev/null || { echo "FAIL: work_duration_minutes != 20"; echo "$A"; exit 1; }
echo "  OK 口径精确（接收3/回复2/接待2/时长20）"

echo "── ③ 数据隔离：CSB 灌 1 in，CSA 卡片绝不含 CSB 的数 ──"
Q "INSERT INTO zenithjoy.wechat_messages(contact_key,sender_name,direction,content,cs_wechat_id,created_at)
   VALUES ('cb_${SUF}','客户B','in','B的消息','${CSB}', now() - interval '2 minutes')" >/dev/null
R=$(curl -sf "$API_BASE/api/wechat/cs/stats?date=today")
# CSA 数不变（仍 3 接收）
echo "$R" | jq -e '.stats[]|select(.cs_wechat_id=="'"${CSA}"'")|.received_count==3' >/dev/null \
  || { echo "FAIL: CSB 写入串到了 CSA"; echo "$R"; exit 1; }
# CSB 各算各的（1 接收 0 回复）
echo "$R" | jq -e '.stats[]|select(.cs_wechat_id=="'"${CSB}"'")|.received_count==1 and .reply_count==0' >/dev/null \
  || { echo "FAIL: CSB 自身统计错"; echo "$R"; exit 1; }
echo "  OK 两客服互不串台"

echo "── ④ 时区：北京今天 00:30（= UTC 昨天 16:30）的消息仍归今天 ──"
# 构造「北京当天 00:30」的 UTC 时刻：date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') 是北京今天 00:00（无时区），
# + 30min 得北京今天 00:30，再 AT TIME ZONE 'Asia/Shanghai' 转回带时区 timestamptz。
Q "INSERT INTO zenithjoy.wechat_messages(contact_key,sender_name,direction,content,cs_wechat_id,created_at)
   VALUES ('ctz_${SUF}','客户TZ','in','凌晨咨询','${CSA}',
     ((date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '30 minutes') AT TIME ZONE 'Asia/Shanghai'))" >/dev/null
R=$(curl -sf "$API_BASE/api/wechat/cs/stats?date=today")
# CSA 今天接收从 3 → 4（凌晨这条算今天）
echo "$R" | jq -e '.stats[]|select(.cs_wechat_id=="'"${CSA}"'")|.received_count==4' >/dev/null \
  || { echo "FAIL: 北京 00:30 消息未归入今天（received 应=4）"; echo "$R" | jq -c '.stats[]|select(.cs_wechat_id=="'"${CSA}"'")'; exit 1; }
echo "  OK 北京 00:30 归今天（防美区日界坑）"

echo "── ⑤ 老数据兼容：cs_wechat_id 为 NULL 不计入、接口不报错 ──"
Q "INSERT INTO zenithjoy.wechat_messages(contact_key,sender_name,direction,content,created_at)
   VALUES ('cnull_${SUF}','老客户','in','老数据', now() - interval '3 minutes')" >/dev/null
R=$(curl -sf "$API_BASE/api/wechat/cs/stats?date=today")
echo "$R" | jq -e '.ok==true' >/dev/null || { echo "FAIL: NULL 身份消息导致接口报错"; echo "$R"; exit 1; }
# 没有 cs_wechat_id 为 null / 空串的卡片
echo "$R" | jq -e '[.stats[]|select(.cs_wechat_id==null or .cs_wechat_id=="")]|length==0' >/dev/null \
  || { echo "FAIL: NULL 身份消息生成了卡片"; echo "$R"; exit 1; }
# CSA 接收仍 4（NULL 那条不串进来）
echo "$R" | jq -e '.stats[]|select(.cs_wechat_id=="'"${CSA}"'")|.received_count==4' >/dev/null \
  || { echo "FAIL: NULL 消息串进了 CSA"; echo "$R"; exit 1; }
echo "  OK NULL 身份不计入、接口正常"

echo ""
echo "✅ cs-work-stats (S3) smoke 全过（schema + 口径精确 + 隔离 + 时区 + NULL 兼容）"
