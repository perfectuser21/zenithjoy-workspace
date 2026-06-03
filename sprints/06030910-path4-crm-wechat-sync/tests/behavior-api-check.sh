#!/bin/bash
# ZenithJoy CRM — Mode A BEHAVIOR 运行时验证脚本
# 用法: bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh <scenario>
# 前提: ZenithJoy API 运行在 localhost:3000
# Scenarios: init | contacts | match | analysis | error | risk-rpa-fail | risk-field-mapping | all
set -e

SCENARIO=${1:-all}
API_BASE="http://localhost:3000"
TENANT_ID="test-eval-crm-001"

# 快速检查服务是否在线
check_server() {
  curl -sf "${API_BASE}/health" > /dev/null 2>&1 || \
  curl -sf "${API_BASE}/api/crm/wechat-contacts?tenant_id=ping" > /dev/null 2>&1 || \
  { echo "FAIL: ZenithJoy API 未运行在 ${API_BASE}，请先启动: cd apps/api && npm run dev"; exit 1; }
}

case "$SCENARIO" in

  init)
    check_server
    RESP=$(curl -sf -X POST "${API_BASE}/api/crm/init" \
      -H "Content-Type: application/json" \
      -d "{\"platform\":\"feishu\",\"tenant_id\":\"${TENANT_ID}\",\"mode\":\"create\"}") \
      || { echo "FAIL: POST /api/crm/init 未返回 HTTP 200"; exit 1; }
    echo "$RESP" | jq -e '.success == true' > /dev/null \
      || { echo "FAIL: success != true, got: $RESP"; exit 1; }
    echo "$RESP" | jq -e '(.table_id | type) == "string"' > /dev/null \
      || { echo "FAIL: table_id 非 string, got: $RESP"; exit 1; }
    echo "$RESP" | jq -e '(.table_id | length) > 0' > /dev/null \
      || { echo "FAIL: table_id 为空字符串"; exit 1; }
    echo "$RESP" | jq -e '[keys | sort[]] == ["success","table_id"]' > /dev/null \
      || { echo "FAIL: keys 不完整 expected=[success,table_id], got: $(echo $RESP | jq 'keys | sort')"; exit 1; }
    echo "$RESP" | jq -e 'has("tableId") | not' > /dev/null \
      || { echo "FAIL: 含禁用驼峰字段 tableId"; exit 1; }
    echo "OK /api/crm/init"
    ;;

  contacts)
    check_server
    RESP=$(curl -sf "${API_BASE}/api/crm/wechat-contacts?tenant_id=${TENANT_ID}") \
      || { echo "FAIL: GET /api/crm/wechat-contacts 未返回 HTTP 200"; exit 1; }
    echo "$RESP" | jq -e '(.contacts | type) == "array"' > /dev/null \
      || { echo "FAIL: contacts 非 array, got: $RESP"; exit 1; }
    echo "$RESP" | jq -e '(.contacts | length) >= 1' > /dev/null \
      || { echo "FAIL: mock contacts 为空（期望 >= 1 条）"; exit 1; }
    echo "$RESP" | jq -e '.contacts[0] | has("wechat_id")' > /dev/null \
      || { echo "FAIL: contacts[0] 缺 wechat_id 字段"; exit 1; }
    echo "$RESP" | jq -e '.contacts[0] | has("nickname")' > /dev/null \
      || { echo "FAIL: contacts[0] 缺 nickname 字段"; exit 1; }
    echo "$RESP" | jq -e 'has("list") | not' > /dev/null \
      || { echo "FAIL: 含禁用字段 list"; exit 1; }
    echo "OK /api/crm/wechat-contacts"
    ;;

  match)
    check_server
    RESP=$(curl -sf "${API_BASE}/api/crm/match-preview?tenant_id=${TENANT_ID}") \
      || { echo "FAIL: GET /api/crm/match-preview 未返回 HTTP 200"; exit 1; }
    echo "$RESP" | jq -e '(.matched | type) == "array"' > /dev/null \
      || { echo "FAIL: matched 非 array"; exit 1; }
    echo "$RESP" | jq -e '(.pending | type) == "array"' > /dev/null \
      || { echo "FAIL: pending 非 array"; exit 1; }
    echo "$RESP" | jq -e '(.unmatched | type) == "array"' > /dev/null \
      || { echo "FAIL: unmatched 非 array"; exit 1; }
    echo "$RESP" | jq -e '[keys | sort[]] == ["matched","pending","unmatched"]' > /dev/null \
      || { echo "FAIL: keys 不完整 expected=[matched,pending,unmatched], got: $(echo $RESP | jq 'keys | sort')"; exit 1; }
    echo "$RESP" | jq -e 'has("results") | not' > /dev/null \
      || { echo "FAIL: 含禁用字段 results"; exit 1; }
    echo "OK /api/crm/match-preview"
    ;;

  analysis)
    check_server
    RESP=$(curl -sf -X POST "${API_BASE}/api/crm/daily-analysis" \
      -H "Content-Type: application/json" \
      -d "{\"tenant_id\":\"${TENANT_ID}\",\"dry_run\":true}") \
      || { echo "FAIL: POST /api/crm/daily-analysis 未返回 HTTP 200"; exit 1; }
    echo "$RESP" | jq -e '(.customers | type) == "array"' > /dev/null \
      || { echo "FAIL: customers 非 array, got: $RESP"; exit 1; }
    echo "$RESP" | jq -e '.webhook_sent == false' > /dev/null \
      || { echo "FAIL: dry_run=true 时 webhook_sent 应为 false, got: $RESP"; exit 1; }
    # suggestion 字段验证（customers 非空时，每条必须有 string suggestion）
    CUST_LEN=$(echo "$RESP" | jq '.customers | length')
    if [ "$CUST_LEN" -gt 0 ]; then
      echo "$RESP" | jq -e '(.customers[0].suggestion | type) == "string"' > /dev/null \
        || { echo "FAIL: customers[0].suggestion 非 string, got: $(echo $RESP | jq '.customers[0]')"; exit 1; }
    fi
    echo "$RESP" | jq -e 'has("webhookSent") | not' > /dev/null \
      || { echo "FAIL: 含禁用驼峰字段 webhookSent"; exit 1; }
    echo "OK /api/crm/daily-analysis"
    ;;

  error)
    check_server
    # POST /api/crm/init 缺 tenant_id → 期望 400
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${API_BASE}/api/crm/init" \
      -H "Content-Type: application/json" -d '{}')
    [ "$CODE" = "400" ] \
      || { echo "FAIL: POST /api/crm/init 缺 tenant_id 期望 400，实际返回 $CODE"; exit 1; }
    # GET /api/crm/wechat-contacts 缺 tenant_id query → 期望 400
    CODE2=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/crm/wechat-contacts")
    [ "$CODE2" = "400" ] \
      || { echo "FAIL: GET /api/crm/wechat-contacts 缺 tenant_id 期望 400，实际返回 $CODE2"; exit 1; }
    echo "OK error paths (400 verified)"
    ;;

  risk-rpa-fail)
    check_server
    # wechat_rpa 失败场景：使用 simulate_fail 参数触发降级路径
    CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      "${API_BASE}/api/crm/wechat-contacts?tenant_id=${TENANT_ID}&simulate_fail=true")
    [ "$CODE" != "500" ] \
      || { echo "FAIL: wechat_rpa 失败时不应返 500，实际返回 $CODE"; exit 1; }
    RESP=$(curl -sf "${API_BASE}/api/crm/wechat-contacts?tenant_id=${TENANT_ID}&simulate_fail=true") 2>/dev/null \
      || RESP=$(curl -s "${API_BASE}/api/crm/wechat-contacts?tenant_id=${TENANT_ID}&simulate_fail=true")
    echo "$RESP" | jq -e '.warning == "rpa_unavailable"' > /dev/null \
      || { echo "FAIL: 缺 warning=rpa_unavailable 降级字段, got: $RESP"; exit 1; }
    echo "OK Risk 1: wechat_rpa 失败降级"
    ;;

  risk-field-mapping)
    check_server
    # mode=connect 有表接入 → 响应含 field_mapping
    RESP=$(curl -sf -X POST "${API_BASE}/api/crm/init" \
      -H "Content-Type: application/json" \
      -d "{\"platform\":\"feishu\",\"tenant_id\":\"${TENANT_ID}\",\"mode\":\"connect\"}") \
      || { echo "FAIL: POST /api/crm/init mode=connect 未返回 HTTP 200"; exit 1; }
    echo "$RESP" | jq -e 'has("field_mapping")' > /dev/null \
      || { echo "FAIL: mode=connect 响应缺 field_mapping 字段, got: $RESP"; exit 1; }
    echo "OK Risk 2: mode=connect field_mapping 存在"
    ;;

  all)
    echo "=== CRM API BEHAVIOR 全量验证 ==="
    bash "$0" init
    bash "$0" contacts
    bash "$0" match
    bash "$0" analysis
    bash "$0" error
    bash "$0" risk-rpa-fail
    bash "$0" risk-field-mapping
    echo "=== ✅ 所有 BEHAVIOR 验证通过 ==="
    ;;

  *)
    echo "用法: $0 <init|contacts|match|analysis|error|risk-rpa-fail|risk-field-mapping|all>"
    exit 1
    ;;
esac
