contract_branch: cp-harness-propose-r3-52b9609e
workstream_index: 3
sprint_dir: sprints/step6-dispatch-chain

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 3: 路由层 POST works/:id/publish + POST agent/task-ack

**范围**:
- `apps/api/src/routes/works.ts`: 加 `POST /:id/publish`（tenantContext + tenantBypass 鉴权）
- `apps/api/src/routes/walking-skeleton.ts`: 加 `POST /task-ack`（licenseAuth 鉴权）**+ 修改 `POST /api/agent/heartbeat` 使 response 的 `queued_tasks` 数组包含当前 agent 有 pending 的 publish_tasks**

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

- [ ] [ARTIFACT] `walking-skeleton.ts` heartbeat 路由含 `queued_tasks` 字段（响应中返回 pending 任务队列）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/walking-skeleton.ts','utf8');if(!c.includes('queued_tasks'))process.exit(1)"

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

- [ ] [BEHAVIOR] `POST /api/agent/heartbeat` 在 publish 后返回的 `queued_tasks` 数组含该 task_id（heartbeat 修改验证）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_heartbeat_returns_queued_task'
  期望: exit 0（helper 内：注册+心跳+创建 work+publish 得 task_id → 再次心跳 → jq 验 queued_tasks[].task_id 含该值）
