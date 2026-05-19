---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 路由层 POST works/:id/publish + POST agent/task-ack

**范围**:
- `apps/api/src/routes/works.ts`: 加 `POST /:id/publish`（tenantContext + tenantBypass 鉴权）
- `apps/api/src/routes/walking-skeleton.ts`: 加 `POST /task-ack`（licenseAuth 鉴权）

**大小**: M
**依赖**: Workstream 2（dispatchPublishTask + ackPublishTask 已导出）

## ARTIFACT 条目

- [ ] [ARTIFACT] `works.ts` 含 `/publish` 路由注册（POST）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/works.ts','utf8');if(!c.includes('/publish'))process.exit(1)"

- [ ] [ARTIFACT] `works.ts` 导入 `dispatchPublishTask` 并使用
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/works.ts','utf8');if(!c.includes('dispatchPublishTask'))process.exit(1)"

- [ ] [ARTIFACT] `walking-skeleton.ts` 含 `task-ack` 路由注册
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/walking-skeleton.ts','utf8');if(!c.includes('task-ack'))process.exit(1)"

- [ ] [ARTIFACT] `walking-skeleton.ts` 导入 `ackPublishTask` 并使用
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/walking-skeleton.ts','utf8');if(!c.includes('ackPublishTask'))process.exit(1)"

## BEHAVIOR 条目（通过 helper + 直接 curl 验证 response schema）

- [ ] [BEHAVIOR] `POST /api/works/:id/publish` 返回 `status:"queued"` + `task_id:<uuid>` — PRD response 字段值验证
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_publish_schema_fields'
  期望: exit 0（helper 内验 .status=="queued" && .task_id 是 uuid）

- [ ] [BEHAVIOR] `POST /api/works/:id/publish` response keys 精确等于 `["status","task_id"]` — PRD schema 完整性
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_publish_schema_keys'
  期望: exit 0（helper 内 `jq -e 'keys == ["status","task_id"]'` exit 0）

- [ ] [BEHAVIOR] `POST /api/works/:id/publish` response 不含禁用字段 id/data/result/message/payload
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_publish_no_forbidden_fields'
  期望: exit 0（helper 内验 `has("id")|not` + `has("data")|not` + `has("result")|not`）

- [ ] [BEHAVIOR] `POST /api/agent/task-ack` 返回 `ok:true` — PRD response 字段值验证
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_schema_ok_true'
  期望: exit 0（helper 内验 .ok==true）

- [ ] [BEHAVIOR] `POST /api/agent/task-ack` response keys 精确等于 `["ok"]` — PRD schema 完整性
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_schema_keys'
  期望: exit 0（helper 内 `jq -e 'keys == ["ok"]'` exit 0）

- [ ] [BEHAVIOR] `POST /api/agent/task-ack` response 不含禁用字段 success/status/done
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_no_forbidden_fields'
  期望: exit 0（helper 内验 `has("success")|not` + `has("status")|not` + `has("done")|not`）

- [ ] [BEHAVIOR] `POST /api/works/:id/publish` 对不存在 work 返回 HTTP 404 + error 字段
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_publish_404_not_found'
  期望: exit 0（helper 内用有效 session cookie 访问不存在 work UUID，验 HTTP 404）

- [ ] [BEHAVIOR] `POST /api/agent/task-ack` 传不存在 task_id 返回 404（用真实 license_key，验 error 字段）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_not_found'
  期望: exit 0（helper 内用真实 license_key + 不存在 UUID，验 HTTP 404）

- [ ] [BEHAVIOR] `GET /api/works/:id` 对未发布 work 返回 `publish_status: null`（PRD Migration 要求）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_get_work_publish_status_null'
  期望: exit 0（helper 内新建 work 后立即 GET，验 .publish_status == null）

- [ ] [BEHAVIOR] `POST /api/agent/task-ack` 跨 tenant 访问返回精确 403（cross-tenant 隔离）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_cross_tenant_forbidden'
  期望: exit 0（helper 内 userA publish → userB ack → HTTP 403，见 WS2 SSOT）

---

## Risks

### Risk 1: 活跃 Agent 时间窗口定义模糊

见 WS2 DoD Risks 章节（SSOT）。路由层依赖 service 层正确过滤，WS3 BEHAVIOR 不再重复验证。

### Risk 2: 事务 cascade 失败状态不一致

见 WS2 DoD Risks 章节（SSOT）。WS3 BEHAVIOR `test_dispatch_sets_queued` 间接验证。

---

## WS3 helper script 补充 test cases（generator commit-2 追加到 step6-dispatch-helper.sh）

> **注意**: `test_ack_not_found` + `test_ack_cross_tenant_forbidden` 已在 WS2 helper script SSOT 中定义，WS3 DoD 仅引用，不重复维护代码。

```bash
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
    # 使用真实 session cookie（独立执行安全，不依赖 /tmp/s6r1.cookies）
    setup_user "p404"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$COOKIES" \
      -X POST "$API/api/works/00000000-0000-0000-0000-000000000000/publish" \
      -H 'content-type: application/json')
    [ "$CODE" = "404" ] || { echo "FAIL: 不存在 work 应返 404, got $CODE"; exit 1; }
    echo "OK";;
  test_get_work_publish_status_null)
    # GET /api/works/:id 对未发布 work 验 publish_status == null（PRD Migration oracle）
    setup_user "gnull"
    WORK_ID=$(curl -fsS -b "$COOKIES" -X POST "$API/api/works" \
      -H 'content-type: application/json' \
      -d '{"title":"null publish test","content_type":"video","body":"b"}' | jq -r '.id')
    RESP=$(curl -f -b "$COOKIES" "$API/api/works/$WORK_ID")
    echo "$RESP" | jq -e '.publish_status == null' \
      || { echo "FAIL: 未发布 work publish_status 应为 null"; exit 1; }
    echo "OK";;
```
