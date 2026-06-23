#!/bin/bash
# 客服工作汇总 stats 端点 — 数据层真实 oracle（seed cs_memory_messages → curl /api/wechat/cs/stats → jq -e 断言）
#
# 这是合同 [BEHAVIOR] 的真实验证脚本（非 mock、非 echo 假绿）：每个子命令都 cleanup→seed→curl→jq -e 断言。
# 前提（evaluator 必须满足）：
#   - apps/api 已起在 $API_BASE（默认 http://localhost:5210），且 ZENITHJOY_INTERNAL_TOKEN 与服务一致
#   - $DATABASE_URL 指向已跑过本 sprint migration（含 cs_wechat_id 列 + 索引）的 zenithjoy schema 的 Postgres
#   - 口径（PRD 已确认）：received=in 条数 / reply=out 条数 / served_customers=distinct contact / work_duration_minutes=末-首 created_at 分钟
#   - 日界按北京时区 Asia/Shanghai 算（中台跑在美区，防 #832）
#
# 用法: cs-stats-verify.sh {math|isolation|null|tz|yesterday|empty-zero|stamp}
#   stamp = 接缝 #1 真验：seed 完整身份链 → POST 真实 /draft-generate → 断言 cs_memory_messages 'in' 行盖章
set -euo pipefail

API="${API_BASE:-http://localhost:5210}"
TOK="${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-abc-not-prod}"
: "${DATABASE_URL:?需要 DATABASE_URL 指向已 migrate 的 zenithjoy Postgres}"
SENTINEL='cs-e2e-'
# stamp 接缝用：固定 UUID/标识，FK 链顺序 seed，跑完按这些清理
ST_TENANT='cccccccc-cccc-cccc-cccc-cccccc000001'
ST_ACCT='cccccccc-cccc-cccc-cccc-cccccc000002'
ST_LIC='cccccccc-cccc-cccc-cccc-cccccc000003'
ST_MACHINE='cs-e2e-machine-01'
ST_AGENT='cs-e2e-agent-01'
ST_CSWX='cs-e2e-STAMP'          # 身份链解析出的客服微信号（= 盖章值）
ST_SENDER='cust-e2e-stamp'
ST_MARK='CSE2E-STAMP-MARK'      # 落库内容指纹，断言用
PSQL() { psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -t -A "$@"; }
GET() { curl -sf "$API/api/wechat/cs/stats?date=$1" -H "X-Internal-Token: $TOK"; }

cleanup() {
  PSQL -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id LIKE '${SENTINEL}%' OR contact LIKE 'cust-e2e-%' OR text LIKE '%${ST_MARK}%'" >/dev/null 2>&1 || true
  # stamp 身份链 seed 清理（逆 FK 序；未 migrate / 列缺失时静默）
  for tbl_col in "wechat_cs_account_config:wechat_id='${ST_CSWX}'" \
                 "service_agents:machine_id='${ST_MACHINE}'" \
                 "license_machines:machine_id='${ST_MACHINE}'" \
                 "tenant_sub_accounts:id='${ST_ACCT}'" \
                 "licenses:id='${ST_LIC}'" \
                 "tenants:id='${ST_TENANT}'"; do
    PSQL -c "DELETE FROM zenithjoy.${tbl_col%%:*} WHERE ${tbl_col#*:}" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT
cleanup

# 北京今天某时刻的 timestamptz（wall-clock 解释为北京墙钟）
bj_today() { echo "((now() AT TIME ZONE 'Asia/Shanghai')::date + time '$1') AT TIME ZONE 'Asia/Shanghai'"; }
bj_yest()  { echo "(((now() AT TIME ZONE 'Asia/Shanghai')::date - 1) + time '$1') AT TIME ZONE 'Asia/Shanghai'"; }

seed_today_A() {
  # 客服A 今天：2 个客户(cust-1,cust-2)，in=3 out=2，首 09:00 末 09:20 → duration=20
  PSQL >/dev/null <<SQL
INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES
 ('t1','cust-e2e-1','in','你好','${SENTINEL}A', $(bj_today '09:00')),
 ('t1','cust-e2e-1','out','您好','${SENTINEL}A', $(bj_today '09:05')),
 ('t1','cust-e2e-1','in','在吗','${SENTINEL}A', $(bj_today '09:10')),
 ('t1','cust-e2e-2','in','请问','${SENTINEL}A', $(bj_today '09:15')),
 ('t1','cust-e2e-2','out','请讲','${SENTINEL}A', $(bj_today '09:20'));
SQL
}

row_jq() { # $1=resp $2=cs  → 输出该客服那一行 json（无则 null）
  echo "$1" | jq -c --arg cs "$2" '(.stats // []) | map(select(.cs_wechat_id==$cs)) | .[0]'
}

case "${1:-}" in
  math)
    seed_today_A
    RESP=$(GET today)
    echo "$RESP" | jq -e '.ok==true and ((.stats // []) | type=="array")' >/dev/null \
      || { echo "FAIL: 响应非 {ok:true, stats:[...]}：$RESP"; exit 1; }
    A=$(row_jq "$RESP" "${SENTINEL}A")
    echo "$A" | jq -e '.received_count==3 and .reply_count==2 and .served_customers==2 and .work_duration_minutes==20' >/dev/null \
      || { echo "FAIL: 客服A 4 数不符（期望 3/2/2/20）：$A"; exit 1; }
    # 字段名锁定（PRD 锚点）+ 禁用漂移字段
    echo "$A" | jq -e 'has("received_count") and has("reply_count") and has("served_customers") and has("work_duration_minutes") and has("cs_wechat_id")' >/dev/null \
      || { echo "FAIL: 缺 PRD 锚点字段：$A"; exit 1; }
    echo "$A" | jq -e '(has("in_count")|not) and (has("out_count")|not) and (has("wechat_id")|not) and (has("duration")|not) and (has("customers")|not)' >/dev/null \
      || { echo "FAIL: 出现禁用漂移字段名：$A"; exit 1; }
    echo "PASS math: 3/2/2/20 + 字段名锁定"
    ;;

  isolation)
    seed_today_A
    PSQL >/dev/null <<SQL
INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES
 ('t1','cust-e2e-9','in','B的客户','${SENTINEL}B', $(bj_today '10:00'));
SQL
    RESP=$(GET today)
    B=$(row_jq "$RESP" "${SENTINEL}B")
    # B 只有 1 条 in，A 的数(3/2/2/20)绝不串到 B
    echo "$B" | jq -e '.received_count==1 and .reply_count==0 and .served_customers==1' >/dev/null \
      || { echo "FAIL: 客服B 被串台（期望 1/0/1）：$B"; exit 1; }
    A=$(row_jq "$RESP" "${SENTINEL}A")
    echo "$A" | jq -e '.received_count==3' >/dev/null \
      || { echo "FAIL: 客服A 数被 B 影响：$A"; exit 1; }
    echo "PASS isolation: A=3 / B=1 互不串台"
    ;;

  null)
    seed_today_A
    PSQL >/dev/null <<SQL
INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES
 ('t1','cust-e2e-x','in','无主消息1',NULL, $(bj_today '11:00')),
 ('t1','cust-e2e-x','in','无主消息2',NULL, $(bj_today '11:05'));
SQL
    RESP=$(GET today)
    # 无任何 stats 行 cs_wechat_id 为 null；A 仍是 3（NULL 行没被算进任何客服）
    echo "$RESP" | jq -e '((.stats // []) | map(.cs_wechat_id) | all(. != null))' >/dev/null \
      || { echo "FAIL: stats 出现 cs_wechat_id=null 行：$RESP"; exit 1; }
    A=$(row_jq "$RESP" "${SENTINEL}A")
    echo "$A" | jq -e '.received_count==3' >/dev/null \
      || { echo "FAIL: NULL 老数据串进客服A：$A"; exit 1; }
    echo "PASS null: NULL 身份不计入任何客服、接口不报错"
    ;;

  tz)
    # 客服TZ 仅 1 条，落在北京今天 00:30（美区当时为昨天）→ 必须归「今天」
    PSQL >/dev/null <<SQL
INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES
 ('t1','cust-e2e-tz','in','北京零点半','${SENTINEL}TZ', $(bj_today '00:30'));
SQL
    RESP=$(GET today)
    TZ=$(row_jq "$RESP" "${SENTINEL}TZ")
    echo "$TZ" | jq -e '.received_count==1' >/dev/null \
      || { echo "FAIL: 北京今天00:30 未归今天（疑用美区日界，#832 复发）：today TZ=$TZ"; exit 1; }
    # 且这条不应出现在「昨天」
    RESP_Y=$(GET yesterday)
    TZ_Y=$(row_jq "$RESP_Y" "${SENTINEL}TZ")
    echo "$TZ_Y" | jq -e '. == null' >/dev/null \
      || { echo "FAIL: 北京今天的消息错误地出现在昨天：$TZ_Y"; exit 1; }
    echo "PASS tz: 北京 00:30 归今天、不串昨天"
    ;;

  yesterday)
    seed_today_A
    PSQL >/dev/null <<SQL
INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES
 ('t1','cust-e2e-y1','in','昨天的话','${SENTINEL}Y', $(bj_yest '14:00')),
 ('t1','cust-e2e-y1','out','昨天回的','${SENTINEL}Y', $(bj_yest '14:10'));
SQL
    RESP_Y=$(GET yesterday)
    Y=$(row_jq "$RESP_Y" "${SENTINEL}Y")
    echo "$Y" | jq -e '.received_count==1 and .reply_count==1' >/dev/null \
      || { echo "FAIL: 昨天客服Y 数不符（期望 1/1）：$Y"; exit 1; }
    # 客服A（全部今天）绝不出现在昨天
    A_Y=$(row_jq "$RESP_Y" "${SENTINEL}A")
    echo "$A_Y" | jq -e '. == null' >/dev/null \
      || { echo "FAIL: 今天的客服A 串进昨天：$A_Y"; exit 1; }
    echo "PASS yesterday: 昨天=Y(1/1)、今天的A 不串昨天"
    ;;

  empty-zero)
    # 边界：某客服今天无任何消息 → 不应报错；卡片层显示 4 个 0 由前端兜底。
    # 后端语义：该客服当天无行 → stats 里要么无此 cs 行（前端补 0），要么 4 数全 0。两者都不报错。
    RESP=$(GET today)
    echo "$RESP" | jq -e '.ok==true and ((.stats // []) | type=="array")' >/dev/null \
      || { echo "FAIL: 空数据日 stats 接口异常：$RESP"; exit 1; }
    echo "PASS empty-zero: 无消息日接口不报错、返回 stats 数组"
    ;;

  stamp)
    # ── 接缝 #1 真验：in/out 落库盖 cs_wechat_id 身份章（经真实身份解析链 + 真实 /draft-generate）──
    # seed FK 链：tenants → tenant_sub_accounts → licenses → license_machines(agent_id→machine_id)
    #            → service_agents(machine_id→wechat_id) → wechat_cs_account_config(whitelist=[sender])
    # 然后 POST /draft-generate mode=review（名单内 → 直达 line352 'in' 落库，LLM 无关）。
    # generator 须把 wechat-draft:352/:408 落库改写到 cs_memory_messages 并盖 cs_wechat_id；
    # 未改写 / 未盖章 → cs_memory_messages 查不到该行 → FAIL（真红）。
    PSQL >/dev/null <<SQL
INSERT INTO zenithjoy.tenants (id,name,license_key) VALUES
 ('${ST_TENANT}','cs-e2e-tenant','cs-e2e-lickey-${ST_MARK}') ON CONFLICT (id) DO NOTHING;
INSERT INTO zenithjoy.tenant_sub_accounts (id,tenant_id,email,role) VALUES
 ('${ST_ACCT}','${ST_TENANT}','cs-e2e@example.com','service_agent') ON CONFLICT (id) DO NOTHING;
INSERT INTO zenithjoy.licenses (id,license_key,tier,max_machines,expires_at) VALUES
 ('${ST_LIC}','cs-e2e-lic-${ST_MARK}','basic',5, now() + interval '365 days') ON CONFLICT (id) DO NOTHING;
INSERT INTO zenithjoy.license_machines (license_id,machine_id,agent_id) VALUES
 ('${ST_LIC}','${ST_MACHINE}','${ST_AGENT}') ON CONFLICT (license_id,machine_id) DO NOTHING;
INSERT INTO zenithjoy.service_agents (tenant_id,account_id,machine_id,wechat_id) VALUES
 ('${ST_TENANT}','${ST_ACCT}','${ST_MACHINE}','${ST_CSWX}');
INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona,auto_agent_enabled,whitelist) VALUES
 ('${ST_CSWX}','{"name":"cs-e2e"}'::jsonb,false,'["${ST_SENDER}"]'::jsonb) ON CONFLICT (wechat_id) DO NOTHING;
SQL
    # 真实自动回复入口：名单内 + mode=review → 直达 'in' 落库（不烧 LLM、不依赖飞书）
    HTTP=$(curl -s -o /tmp/cs-stamp-resp.json -w '%{http_code}' \
      -X POST "$API/api/wechat/draft-generate" \
      -H "Content-Type: application/json" -H "X-Tenant-Id: ${ST_TENANT}" \
      -d "{\"sender\":\"${ST_SENDER}\",\"wechat_id\":\"${ST_SENDER}\",\"content\":\"你好 ${ST_MARK}\",\"agent_id\":\"${ST_AGENT}\",\"mode\":\"review\"}")
    [ "$HTTP" = "200" ] || { echo "FAIL: /draft-generate 非 200（HTTP=$HTTP）：$(cat /tmp/cs-stamp-resp.json)"; exit 1; }
    # 硬断言：cs_memory_messages 出现 in 行，cs_wechat_id 精确等于身份链解析微信号，5 分钟窗内
    HIT=$(PSQL -c "SELECT count(*) FROM zenithjoy.cs_memory_messages WHERE role='in' AND cs_wechat_id='${ST_CSWX}' AND text LIKE '%${ST_MARK}%' AND created_at > now() - interval '5 minutes'" | tr -d ' ')
    [ "$HIT" -ge 1 ] || { echo "FAIL: cs_memory_messages 无 in 行盖章 cs_wechat_id=${ST_CSWX}（落库未改写到本表/未盖章）。命中=$HIT"; exit 1; }
    # 防串台：NULL 身份不许冒充本客服（同指纹不得出现 cs_wechat_id 为别值的行）
    BAD=$(PSQL -c "SELECT count(*) FROM zenithjoy.cs_memory_messages WHERE text LIKE '%${ST_MARK}%' AND (cs_wechat_id IS NULL OR cs_wechat_id <> '${ST_CSWX}')" | tr -d ' ')
    [ "$BAD" = "0" ] || { echo "FAIL: 本轮消息盖了错的/空的 cs_wechat_id（串台风险）。坏行=$BAD"; exit 1; }
    # 'out' 行需 LLM 成功 → 信息性输出（接缝清单 #1：真目标补验 out，标 logic-done-pending）
    OUT=$(PSQL -c "SELECT count(*) FROM zenithjoy.cs_memory_messages WHERE role='out' AND cs_wechat_id='${ST_CSWX}' AND created_at > now() - interval '5 minutes'" | tr -d ' ')
    echo "PASS stamp: in 行已盖 cs_wechat_id=${ST_CSWX}（真身份链）。out 行=${OUT}（=0 多因 CI 无 LLM key，见接缝清单 #1 需真目标补验）"
    ;;

  *)
    echo "用法: $0 {math|isolation|null|tz|yesterday|empty-zero|stamp}" >&2
    exit 2
    ;;
esac
