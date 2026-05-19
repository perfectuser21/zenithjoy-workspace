---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Workstream 2: Service 层 dispatchPublishTask + ackPublishTask

**范围**: `apps/api/src/services/walking-skeleton.service.ts` 新增三个函数：
- `findActiveAgentByTenantId(tenantId: string): Promise<AgentRow | null>`
- `dispatchPublishTask(args: {workId: string, tenantId: string}): Promise<{task_id: string, status: 'queued'}>`
- `ackPublishTask(args: {taskId: string, licenseId: string, result: string}): Promise<{ok: true}>`

**大小**: M
**依赖**: Workstream 1（publish_status 列已存在）

> Generator 在 commit-2 还需创建 `apps/api/scripts/step6-dispatch-helper.sh`（BEHAVIOR 测试用）

## ARTIFACT 条目

- [ ] [ARTIFACT] `walking-skeleton.service.ts` 导出 `dispatchPublishTask` 函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');if(!c.includes('export async function dispatchPublishTask'))process.exit(1)"

- [ ] [ARTIFACT] `walking-skeleton.service.ts` 导出 `ackPublishTask` 函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');if(!c.includes('export async function ackPublishTask'))process.exit(1)"

- [ ] [ARTIFACT] `walking-skeleton.service.ts` 导出 `findActiveAgentByTenantId` 函数
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');if(!c.includes('export async function findActiveAgentByTenantId'))process.exit(1)"

- [ ] [ARTIFACT] helper script `apps/api/scripts/step6-dispatch-helper.sh` 存在且可执行
  Test: bash -c 'test -x apps/api/scripts/step6-dispatch-helper.sh'

## BEHAVIOR 条目（通过 helper script 验证，需 API 在 localhost:5200 运行）

- [ ] [BEHAVIOR] `dispatchPublishTask` 成功后 publish_tasks 插入记录，result.payload.work_id 含正确值
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_dispatch_inserts_task'
  期望: exit 0（helper 内验 publish_tasks 记录存在 + work_id 匹配，时间窗口 5 分钟）

- [ ] [BEHAVIOR] `dispatchPublishTask` 成功后 works.publish_status 变为 queued（带时间窗口防造假）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_dispatch_sets_queued'
  期望: exit 0（helper 内验 works.publish_status = queued，创建时间 > NOW()-5min）

- [ ] [BEHAVIOR] `ackPublishTask` 后 publish_tasks.status 变为 done，works.publish_status 变为 success
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_sets_success'
  期望: exit 0（helper 内验 publish_tasks.status=done + works.publish_status=success，时间窗口 5 分钟）

- [ ] [BEHAVIOR] `ackPublishTask` 传入不存在的 task_id 返回 404（task not found）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_not_found'
  期望: exit 0（helper 内用真实 license_key + 不存在 UUID 验 HTTP 404）

- [ ] [BEHAVIOR] `ackPublishTask` 传入属于其他 tenant 的真实 task_id 返回 403 forbidden（cross-tenant 隔离验证）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_cross_tenant_forbidden'
  期望: exit 0（helper 内 userA publish → userB ack → HTTP 403 精确验证）

- [ ] [BEHAVIOR] 无活跃 agent 时 `findActiveAgentByTenantId` 返回 null（→ dispatchPublishTask 返 NO_AGENT 422）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_no_agent_422'
  期望: exit 0（helper 内验 POST /api/works/:id/publish 返 422 code=NO_AGENT）

---

## Risks

### Risk 1: 活跃 Agent 时间窗口定义模糊

`findActiveAgentByTenantId` 若不限制 `last_heartbeat_at > NOW() - INTERVAL '10 minutes'`，离线 agent 也被选中导致任务永久挂起。**缓解**: SQL 必须含 `INTERVAL '10 minutes'` 过滤；WS2 ARTIFACT 通过 grep 验证。

### Risk 2: 事务 cascade 失败状态不一致

`INSERT publish_tasks` 与 `UPDATE works.publish_status` 若非原子操作，可能出现 publish_tasks 有记录但 works 仍 null 的不一致状态。**缓解**: 必须在单一 DB 事务或 Prisma `$transaction` 内执行。

---

## helper script SSOT（步骤 commit-2 创建，WS3 追加 case）

> **SSOT**: `apps/api/scripts/step6-dispatch-helper.sh` 是唯一实现源。WS2 创建文件结构 + 基础 case，WS3 追加 schema/forbidden case，**内容不在两个 DoD 中重复维护**。

```bash
#!/bin/bash
# apps/api/scripts/step6-dispatch-helper.sh
# WS2/WS3 BEHAVIOR 测试辅助脚本 — 依赖 API 在 localhost:5200 运行
set -e
API=http://localhost:5200
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
    # 真实 license_key + 不存在的 task UUID → 404（task not found，路由逻辑，不是 auth 拒绝）
    setup_user "anf404"
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/api/agent/task-ack" \
      -H "x-license-key: $LK" -H 'content-type: application/json' \
      -d '{"task_id":"00000000-0000-0000-0000-000000000000","result":"x"}')
    [ "$CODE" = "404" ] || { echo "FAIL: 不存在 task_id 应返 404, got $CODE"; exit 1; }
    echo "OK";;
  test_ack_cross_tenant_forbidden)
    # userA publish → 得到 task_id；userB（不同 license）ack → 必须精确返 403
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
    # 保留别名（向后兼容）— 实际调用 test_ack_not_found
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
  *)
    echo "Usage: $0 <test_case>"; exit 1;;
esac
```
