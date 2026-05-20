contract_branch: cp-05192357-ws-52b9609e-ws2
workstream_index: 2
sprint_dir: sprints/step6-dispatch-chain

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

- [ ] [ARTIFACT] `walking-skeleton.service.ts` 的 `findActiveAgentByTenantId` 含 `last_heartbeat_at` + `INTERVAL` 时间窗口过滤（防止离线 agent 被选中）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/walking-skeleton.service.ts','utf8');if(!c.match(/last_heartbeat_at.*INTERVAL/))process.exit(1);console.log('OK')"

## BEHAVIOR 条目（通过 helper script 验证，需 API 在 localhost:5200 运行）

- [ ] [BEHAVIOR] `dispatchPublishTask` 成功后 publish_tasks 插入记录（带时间窗口防造假）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_dispatch_inserts_task'

- [ ] [BEHAVIOR] `dispatchPublishTask` 插入的 publish_tasks.result 含 `payload.work_id` 且值等于 work 实际 id
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_dispatch_inserts_task_with_work_id'

- [ ] [BEHAVIOR] `dispatchPublishTask` 成功后 works.publish_status 变为 queued
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_dispatch_sets_queued'

- [ ] [BEHAVIOR] `ackPublishTask` 后 publish_tasks.status 变为 done，works.publish_status 变为 success
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_sets_success'

- [ ] [BEHAVIOR] `ackPublishTask` 传入不存在的 task_id 返回 404
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_not_found'

- [ ] [BEHAVIOR] `ackPublishTask` 传入属于其他 tenant 的真实 task_id 返回 403 forbidden
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_ack_cross_tenant_forbidden'

- [ ] [BEHAVIOR] 无活跃 agent 时 `findActiveAgentByTenantId` 返回 null（→ dispatchPublishTask 返 NO_AGENT 422）
  Test: manual:bash -c 'apps/api/scripts/step6-dispatch-helper.sh test_no_agent_422'
