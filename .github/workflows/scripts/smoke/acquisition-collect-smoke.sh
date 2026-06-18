#!/usr/bin/env bash
# Path 2 Step4 — 客户智能获客：飞书企业信息文档 + 扩词 + 中台采集闭环 smoke
#
# 真链路：建 tenant + 飞书 binding(含企业信息 docx) → expand 前置校验 + 扩 3 词 →
#   start 派单 → fake-agent report 去重落 DB + 写飞书 → status 7 态 + 计数 + 抖音号。
# 依赖 env：API_BASE / DB / FEISHU_API_BASE(自托管 fake，= API_BASE) / FAKE_LLM_BASE(= API_BASE) / SMOKE_TOKEN
# fake-feishu + fake-LLM 由 apps/api 在 NODE_ENV!=production 时自托管于根路径。
set -euo pipefail

[ -z "${API_BASE:-}" ]        && { echo "FAIL: API_BASE 未设置"; exit 99; }
[ -z "${DB:-}" ]              && { echo "FAIL: DB 未设置"; exit 99; }
[ -z "${FEISHU_API_BASE:-}" ] && { echo "FAIL: FEISHU_API_BASE 未设置"; exit 99; }
[ -z "${FAKE_LLM_BASE:-}" ]   && { echo "FAIL: FAKE_LLM_BASE 未设置"; exit 99; }
[ -z "${SMOKE_TOKEN:-}" ]     && { echo "FAIL: SMOKE_TOKEN 未设置"; exit 99; }

source "$(dirname "$0")/../../../sprints/06181904-acquisition-feishu-doc-collect/tests/seed.sh"

echo "=== Step 1: 未绑飞书 → FEISHU_NOT_BOUND ==="
seed_acq smoke-nb 1
psql "$DB" -c "DELETE FROM zenithjoy.tenant_feishu_bindings WHERE tenant_id='$TENANT_ID'" >/dev/null
C=$(curl -s -o /tmp/acq-nb.json -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/expand" \
  -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
[ "$C" = "400" ] && jq -e '.error.code=="FEISHU_NOT_BOUND"' /tmp/acq-nb.json >/dev/null \
  || { echo "FAIL Step1: 未绑飞书未返 FEISHU_NOT_BOUND (http=$C)"; cat /tmp/acq-nb.json; exit 1; }

echo "=== Step 2: 扩 3 词(ai) + 派单 ==="
seed_acq smoke-ex 1
set_enterprise_doc "$TENANT_ID" "行业:家装全屋定制 受众:30-45 岁新房业主 卖点:环保板材 钩子:免费上门量房设计"
curl -sf -X POST "${FAKE_LLM_BASE}/__test/llm-mode" -H "Content-Type: application/json" -d '{"mode":"ok"}' >/dev/null
R=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/expand" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\"}")
echo "$R" | jq -e '(.data.keywords|length==3) and (.data.keywords|all(.source=="ai")) and .data.degraded==false' >/dev/null \
  || { echo "FAIL Step2: 扩词非 3 ai 词"; echo "$R"; exit 1; }
R=$(curl -sf -X POST "$API_BASE/api/acquisition/collect/start" -H "Content-Type: application/json" -d "{\"tenant_id\":\"$TENANT_ID\",\"keywords\":[\"装修\",\"软装\",\"定制柜\"]}")
TASK=$(echo "$R" | jq -r .data.task_id)
[ -n "$TASK" ] && [ "$TASK" != "null" ] || { echo "FAIL Step2: start 未返 task_id"; echo "$R"; exit 1; }

echo "=== Step 3: report 去重落库 + status 7 态 ==="
seed_collect_task "$TENANT_ID" running
curl -sf -X POST "$API_BASE/api/acquisition/collect/report" -H "X-Smoke-Token: $SMOKE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"task_id\":\"$COLLECT_TASK_ID\",\"agent_id\":\"$AGENT_ID\",\"keyword\":\"装修\",\"video_id\":\"vS1\",\"commenters\":[{\"sec_uid\":\"MS4wSMOKE\",\"nickname\":\"业主\"}],\"terminal\":\"done\"}" \
  | jq -e '.data.inserted==1' >/dev/null || { echo "FAIL Step3: report inserted!=1"; exit 1; }
S=$(curl -sf "$API_BASE/api/acquisition/collect/$COLLECT_TASK_ID")
echo "$S" | jq -e '(["pending","running","cancelling","cancelled","done","partial","failed"]|index(.data.status))!=null and (.data.lead_count_deduped|type=="number")' >/dev/null \
  || { echo "FAIL Step3: status schema 异常"; echo "$S"; exit 1; }

echo "✅ acquisition-collect smoke PASS"
