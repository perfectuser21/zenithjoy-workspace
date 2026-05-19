#!/bin/bash
# apps/api/scripts/step6-dispatch-helper.sh
# WS2/WS3 BEHAVIOR 测试辅助脚本 — 依赖 API 在 localhost:5200 运行
set -e
API="${ZENITHJOY_API_BASE:-http://localhost:5200}"
DB="${DB:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
CASE=${1:-}

# 等待 API 就绪（最多 30s）
wait_api() {
  for i in $(seq 1 30); do
    curl -fs "$API/health" > /dev/null 2>&1 && return 0
    sleep 1
  done
  echo "ERROR: API not ready at $API"; exit 1
}
wait_api

# 通用：注册用户 + 拿 license_key + cookie
setup_user() {
  local tag=$1
  local cookies="/tmp/s6-helper-${tag}.cookies"
  local email="s6-helper-${tag}-$(date +%s)@test.dev"
  curl -fsS -c "$cookies" -X POST "$API/api/auth/sign-up/email" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Pass1234!\",\"name\":\"helper\"}" > /dev/null
  LK=$(curl -fsS -b "$cookies" "$API/api/account/me" | jq -r '.license.license_key')
  COOKIES="$cookies"
}

case "$CASE" in
  # ===== WS2 test cases =====
  test_dispatch_inserts_task)
    setup_user "dit"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"helper work","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.publish_tasks WHERE id='$TASK_ID' AND created_at > NOW() - INTERVAL '5 minutes'" | tr -d ' ')
    [ "$COUNT" -ge 1 ] || { echo "FAIL: publish_tasks 无记录 task_id=$TASK_ID"; exit 1; }
    echo "OK";;
  test_dispatch_inserts_task_with_work_id)
    setup_user "diwid"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"work_id verify","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    STORED_WORK_ID=$(psql "$DB" -t -c \
      "SELECT result->'payload'->>'work_id' FROM zenithjoy.publish_tasks WHERE id='$TASK_ID' AND created_at > NOW() - INTERVAL '5 minutes'" | tr -d ' ')
    [ "$STORED_WORK_ID" = "$WORK_ID" ] || { echo "FAIL: publish_tasks.result.payload.work_id=$STORED_WORK_ID 不等于 WORK_ID=$WORK_ID"; exit 1; }
    echo "OK";;
  test_dispatch_sets_queued)
    setup_user "dsq"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"helper work 2","content_type":"video","body":"b"}' | jq -r '.id')
    curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" -H 'content-type: application/json' > /dev/null
    STATUS=$(psql "$DB" -t -c "SELECT publish_status FROM zenithjoy.works WHERE id='$WORK_ID'" | tr -d ' ')
    [ "$STATUS" = "queued" ] || { echo "FAIL: works.publish_status=$STATUS, 期望 queued"; exit 1; }
    echo "OK";;
  test_ack_sets_success)
    setup_user "ass"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"ack test work","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    curl -f -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d "{\"task_id\":\"$TASK_ID\",\"result\":\"dryrun ok\"}" > /dev/null
    TASK_STATUS=$(psql "$DB" -t -c "SELECT status FROM zenithjoy.publish_tasks WHERE id='$TASK_ID'" | tr -d ' ')
    WORK_STATUS=$(psql "$DB" -t -c "SELECT publish_status FROM zenithjoy.works WHERE id='$WORK_ID'" | tr -d ' ')
    [ "$TASK_STATUS" = "done" ] || { echo "FAIL: publish_tasks.status=$TASK_STATUS, 期望 done"; exit 1; }
    [ "$WORK_STATUS" = "success" ] || { echo "FAIL: works.publish_status=$WORK_STATUS, 期望 success"; exit 1; }
    echo "OK";;
  test_ack_not_found)
    setup_user "anf404"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"task_id":"00000000-0000-0000-0000-000000000000","result":"x"}')
    [ "$CODE" = "404" ] || { echo "FAIL: 不存在 task_id 应返 404, got $CODE"; exit 1; }
    echo "OK";;
  test_ack_cross_tenant_forbidden)
    setup_user "ctA"
    LK_A="$LK"; COOKIES_A="$COOKIES"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK_A" -H 'content-type: application/json' \
      -d '{"hostname":"ct-agent-a"}' > /dev/null
    WORK_A=$(curl -fsS -b "$COOKIES_A" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"ct work","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_A=$(curl -f -b "$COOKIES_A" -X POST "$API/api/works/$WORK_A/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    setup_user "ctB"
    LK_B="$LK"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK_B" -H 'content-type: application/json' \
      -d '{"hostname":"ct-agent-b"}' > /dev/null
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK_B" -H 'content-type: application/json' \
      -d "{\"task_id\":\"$TASK_A\",\"result\":\"x\"}")
    [ "$CODE" = "403" ] || { echo "FAIL: cross-tenant ack 应精确返 403, got $CODE"; exit 1; }
    echo "OK";;
  test_ack_forbidden)
    setup_user "afb"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"task_id":"00000000-0000-0000-0000-000000000000","result":"x"}')
    [ "$CODE" = "404" ] || { echo "FAIL: 不存在 task_id 应返 404, got $CODE"; exit 1; }
    echo "OK";;
  test_no_agent_422)
    setup_user "na422"
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"no agent work","content_type":"video","body":"b"}' | jq -r '.id')
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES" \
      -X POST "$API/api/works/$WORK_ID/publish" -H 'content-type: application/json')
    [ "$CODE" = "422" ] || { echo "FAIL: 无 agent 应返 422, got $CODE"; exit 1; }
    echo "OK";;

  # ===== WS3 test cases =====
  test_publish_schema_fields)
    setup_user "psf"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"schema test","content_type":"video","body":"b"}' | jq -r '.id')
    RESP=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" -H 'content-type: application/json')
    echo "$RESP" | jq -e '.status == "queued"' || { echo "FAIL: status 不是 queued"; exit 1; }
    echo "$RESP" | jq -e '.task_id | test("^[0-9a-f-]{36}$")' || { echo "FAIL: task_id 不是 uuid"; exit 1; }
    echo "OK";;
  test_publish_schema_keys)
    setup_user "psk"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"keys test","content_type":"video","body":"b"}' | jq -r '.id')
    RESP=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" -H 'content-type: application/json')
    echo "$RESP" | jq -e 'keys == ["status","task_id"]' || { echo "FAIL: keys 不匹配 PRD schema"; exit 1; }
    echo "OK";;
  test_publish_no_forbidden_fields)
    setup_user "pnf"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"forbidden test","content_type":"video","body":"b"}' | jq -r '.id')
    RESP=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" -H 'content-type: application/json')
    for f in id data result message payload; do
      echo "$RESP" | jq -e "has(\"$f\") | not" || { echo "FAIL: 禁用字段 $f 漏网"; exit 1; }
    done
    echo "OK";;
  test_ack_schema_ok_true)
    setup_user "aot"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"ack ok test","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    ACK=$(curl -f -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d "{\"task_id\":\"$TASK_ID\",\"result\":\"dryrun ok\"}")
    echo "$ACK" | jq -e '.ok == true' || { echo "FAIL: ok 不是 true"; exit 1; }
    echo "OK";;
  test_ack_schema_keys)
    setup_user "ask"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"ack keys test","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    ACK=$(curl -f -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d "{\"task_id\":\"$TASK_ID\",\"result\":\"dryrun ok\"}")
    echo "$ACK" | jq -e 'keys == ["ok"]' || { echo "FAIL: task-ack keys 不匹配"; exit 1; }
    echo "OK";;
  test_ack_no_forbidden_fields)
    setup_user "anf"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"helper-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"ack forbidden test","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    ACK=$(curl -f -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d "{\"task_id\":\"$TASK_ID\",\"result\":\"dryrun ok\"}")
    for f in success status done; do
      echo "$ACK" | jq -e "has(\"$f\") | not" || { echo "FAIL: 禁用字段 $f 漏网"; exit 1; }
    done
    echo "OK";;
  test_publish_404_not_found)
    setup_user "p404"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES" \
      -X POST "$API/api/works/00000000-0000-0000-0000-000000000000/publish" \
      -H 'content-type: application/json')
    [ "$CODE" = "404" ] || { echo "FAIL: 不存在 work 应返 404, got $CODE"; exit 1; }
    echo "OK";;
  test_get_work_publish_status_null)
    setup_user "gnull"
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"null publish test","content_type":"video","body":"b"}' | jq -r '.id')
    RESP=$(curl -f -b "$COOKIES" "$API/api/works/$WORK_ID")
    echo "$RESP" | jq -e '.publish_status == null' \
      || { echo "FAIL: 未发布 work publish_status 应为 null"; exit 1; }
    echo "OK";;
  test_heartbeat_returns_queued_task)
    setup_user "hbqt"
    curl -fsS -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"hb-queued-agent"}' > /dev/null
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"hb queued test","content_type":"video","body":"b"}' | jq -r '.id')
    TASK_ID=$(curl -f -b "$COOKIES" -X POST "$API/api/works/$WORK_ID/publish" \
      -H 'content-type: application/json' | jq -r '.task_id')
    [ -n "$TASK_ID" ] || { echo "FAIL: publish 未返回 task_id"; exit 1; }
    HB_RESP=$(curl -f -X POST "$API/api/agent/heartbeat" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"hostname":"hb-queued-agent"}')
    echo "$HB_RESP" | jq -e --arg t "$TASK_ID" '[.queued_tasks[].task_id] | contains([$t])' \
      || { echo "FAIL: heartbeat queued_tasks 未含 task_id=$TASK_ID, resp=$(echo $HB_RESP | jq -c .)"; exit 1; }
    echo "OK";;

  *)
    echo "Usage: $0 <test_case>"; exit 1;;
esac
