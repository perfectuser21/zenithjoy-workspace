#!/usr/bin/env bash
# machine-management-smoke.sh — Line02 机器管理 API curl+psql 链路 smoke
#
# 验 agent-machines.ts 四端点真链路（打真实 ZenithJoy API :5200 + 真 Postgres）：
#   GET  /api/agent/machines            列机器 + 号数聚合 + 7 字段 schema
#   PUT  /api/agent/machines/:id         改名 + 标主副，DB 持久化 + 列表反映
#   POST /api/agent/machines/:id/add-douyin  派 qr-bind 单 → burner 回写 → 新号出现在详情
# 与 sprints/06260400-machine-management/contract-dod.md 的 mode-A BEHAVIOR 同源。
#
# 环境：API_BASE（默认 http://localhost:5200）+ PGHOST/PGUSER/PGDATABASE/PGPASSWORD（默认 cecelia）。
set -euo pipefail

A="${API_BASE:-http://localhost:5200}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"
Q() { psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}" -tAc "$1" | tr -d ' ' | sed -n '1p'; }

echo "━━━ Line02 机器管理 smoke ━━━"
LK="mk-smoke-$(date +%s)$$"
TID=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('MSMOKE','$LK','matrix') RETURNING id")
AID=$(Q "INSERT INTO zenithjoy.agents(tenant_id,agent_id,hostname,status,version) VALUES('$TID','ag-smoke-$(date +%s)$$','pc-smoke','online','1.0.70') RETURNING id")

# 1) 列表：7 字段 schema + 机器在列
R=$(curl -sf "$A/api/agent/machines?tenant_id=$TID")
echo "$R" | jq -e '.success==true and (.data.machines|type=="array")' >/dev/null
echo "$R" | jq -e "[.data.machines[]|select(.id==\"$AID\")][0]|has(\"nickname\") and has(\"hostname\") and has(\"status\") and has(\"version\") and has(\"machine_role\") and has(\"douyin_account_count\")" >/dev/null

# 2) 改名 + 标主机器 → DB 持久化
curl -sf -X PUT "$A/api/agent/machines/$AID" -H "Content-Type: application/json" -d '{"nickname":"主力机A","machine_role":"main"}' \
  | jq -e '.success==true and .data.nickname=="主力机A" and .data.machine_role=="main"' >/dev/null
[ "$(Q "SELECT nickname FROM zenithjoy.agents WHERE id='$AID' AND machine_role='main'")" = "主力机A" ] || { echo "FAIL: PUT 未持久化"; exit 1; }

# 3) 加号：派单 → fake-agent 回写 → 新号出现在详情
LBL="xh-smoke-$(date +%s)$$"
TASK=$(curl -sf -X POST "$A/api/agent/machines/$AID/add-douyin" -H "Content-Type: application/json" -d "{\"account_label\":\"$LBL\"}" | jq -r '.data.task_id')
echo "$TASK" | grep -Eq '^[0-9a-f-]{36}$' || { echo "FAIL: task_id 非 uuid=$TASK"; exit 1; }
curl -sf -X POST "$A/api/agent/burner/qr-bind-result" -H "Content-Type: application/json" -d "{\"task_id\":\"$TASK\",\"agent_id\":\"$AID\",\"qr_login\":\"success\",\"account_nickname\":\"smoke号\"}" | jq -e '.success==true' >/dev/null
curl -sf "$A/api/agent/machines/$AID?tenant_id=$TID" | jq -e "[.data.sessions[]|select(.account_label==\"$LBL\")][0]|.status==\"active\" and .valid==true" >/dev/null || { echo "FAIL: 新号未出现在详情"; exit 1; }

echo "✅ machine-management smoke PASS"
