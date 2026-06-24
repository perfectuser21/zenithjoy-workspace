#!/usr/bin/env bash
# cs-work-stats-smoke.sh — Line04 客服工作汇总：schema + /cs/stats 口径/duration/mode/keys/隔离/NULL/error
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API="${API_BASE:-http://localhost:5200}"
SD="$ROOT/sprints/06232241-line04-cs-work-stats/fixtures"

echo "── ① schema：migration 含 cs_wechat_id 列 + 索引（node 读文件，不查 information_schema）──"
MIG=$(ls "$ROOT"/apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql | head -1)
node -e 'const fs=require("fs");const r=fs.readFileSync(process.argv[1],"utf8");
if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r))throw new Error("缺列 cs_wechat_id");
if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r))throw new Error("缺索引");
console.log("  PASS: cs_wechat_id 列 + (cs_wechat_id, created_at) 索引就位")' "$MIG"

echo "── ② 路由 + 落库盖章就位（真实 INSERT 路径 tenant-memory.ts）──"
node -e 'const fs=require("fs");if(!/cs\/stats/.test(fs.readFileSync(process.argv[1],"utf8")))throw new Error("缺 GET /cs/stats");console.log("  PASS: /cs/stats 路由就位")' "$ROOT/apps/api/src/routes/wechat.ts"
node -e 'const fs=require("fs");if(!/INSERT INTO zenithjoy\.cs_memory_messages[\s\S]{0,400}cs_wechat_id/.test(fs.readFileSync(process.argv[1],"utf8")))throw new Error("INSERT 未盖 cs_wechat_id");console.log("  PASS: cs_memory_messages INSERT 盖 cs_wechat_id")' "$ROOT/apps/api/src/services/wechat/tenant-memory.ts"

echo "── ③ 口径 + duration + mode + keys + 禁用字段（seed-stats.sql 唯一来源）──"
RUN="smoke-cs-$$-$RANDOM"
psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/seed-stats.sql" >/dev/null
RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today")
psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/cleanup.sql" >/dev/null
echo "$RESP" | jq -e '.ok==true and .timezone=="Asia/Shanghai" and .date=="today"' >/dev/null || { echo "  FAIL: 信封不符"; exit 1; }
CARD=$(echo "$RESP" | jq -c --arg w "$RUN" '.agents[]|select(.cs_wechat_id==$w)')
echo "$CARD" | jq -e '.received_count==5 and .reply_count==3 and .served_customers==2 and .work_duration_minutes==30' >/dev/null \
  || { echo "  FAIL: 口径错 $CARD"; exit 1; }
echo "$CARD" | jq -e 'keys==["cs_name","cs_wechat_id","mode","online","received_count","reply_count","served_customers","work_duration_minutes"]' >/dev/null \
  || { echo "  FAIL: keys 完整性 $CARD"; exit 1; }
echo "$CARD" | jq -e '[to_entries[].key]|map(select(.=="in_count" or .=="out_count" or .=="messages_received" or .=="reply" or .=="replies" or .=="customer_count" or .=="duration" or .=="duration_minutes" or .=="minutes" or .=="wxid"))|length==0' >/dev/null \
  || { echo "  FAIL: 禁用字段漏网 $CARD"; exit 1; }
echo "$CARD" | jq -e '.mode=="live"' >/dev/null || { echo "  FAIL: live 卡 mode!=live"; exit 1; }
echo "$RESP" | jq -e --arg w "$RUN-dry" '.agents[]|select(.cs_wechat_id==$w)|.mode=="dryrun"' >/dev/null || { echo "  FAIL: dry 卡 mode!=dryrun"; exit 1; }
echo "  PASS: received=5 reply=3 served=2 duration=30 mode=live/dryrun keys 完整 禁用字段全无"

echo "── ④ 北京时区日界 + 隔离 + NULL + error path ──"
TZ="smoke-tz-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  SELECT 't-smk','cY','in','y'||g,'$TZ', ((now() AT TIME ZONE 'Asia/Shanghai')::date - 1 + time '10:00') AT TIME ZONE 'Asia/Shanghai' FROM generate_series(1,2) g;"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  VALUES ('t-smk','cT','in','mid','$TZ', ((now() AT TIME ZONE 'Asia/Shanghai')::date + time '00:30') AT TIME ZONE 'Asia/Shanghai');"
ISO="smoke-iso-$$-$RANDOM"
psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at)
  SELECT 't-smk','ca','in','x'||g,'$ISO',now() FROM generate_series(1,4) g
  UNION ALL SELECT 't-smk','cn','in','old',NULL,now();"
Y=$(curl -sf "$API/api/wechat/cs/stats?date=yesterday"); T=$(curl -sf "$API/api/wechat/cs/stats?date=today")
echo "$Y" | jq -e --arg w "$TZ" '.agents[]|select(.cs_wechat_id==$w)|.received_count==2' >/dev/null || { echo "  FAIL: 昨天!=2"; exit 1; }
echo "$T" | jq -e --arg w "$TZ" '.agents[]|select(.cs_wechat_id==$w)|.received_count==1' >/dev/null || { echo "  FAIL: 北京00:30 未归今天"; exit 1; }
echo "$T" | jq -e --arg w "$ISO" '.agents[]|select(.cs_wechat_id==$w)|.received_count==4' >/dev/null || { echo "  FAIL: 隔离 A!=4"; exit 1; }
echo "$T" | jq -e '[.agents[]|select(.cs_wechat_id==null)]|length==0' >/dev/null || { echo "  FAIL: NULL 串成卡片"; exit 1; }
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/wechat/cs/stats?date=garbage")
[ "$CODE" = "400" ] || { echo "  FAIL: 非法 date 未返 400 (=$CODE)"; exit 1; }
echo "  PASS: 北京时区日界 + 隔离不串台 + NULL 不计入 + 非法 date 返 400"

psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id='t-smk';"
echo "✅ cs-work-stats smoke 全过"
