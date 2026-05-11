---
sprint: Agent 系统 hardening Sprint H-1
title: backend 系统化（License enforce + status enum + WS UUID routing）
lead_acceptance_status: PASS
acceptance_mode: 0-touch (mac inline curl + psql + ws mock)
date: 2026-05-11
worker_machine: mac (本 sprint pure backend，按 PRD 设计无需 ssh rog — 留 H-2)
total_user_intervention_count: 0
total_steps: 8/8 PASS
---

# Agent 系统 hardening H-1 — 0-touch Lead 自验真 PASS

## 总体结论

8/8 step PASS，3 个 CRITICAL bug 全验证生效，user_intervention_count = 0，达到 PRD SLA。

PR #283 (commit `315fc3e`) merge 后立即 redeploy 真生产（apps/api tsc clean → migration 真跑 → launchctl restart pid 62708 → /health 200），mac controller 跑 `scripts/lead-acceptance/agent-hardening-h1-self-test.cjs` 8 step 一气过。

## 真证据（mac inline 8 step）

| Step | 类别 | 真验证内容 | 真结果 |
|---|---|---|---|
| 1 | signup | curl POST /api/auth/sign-up/email | user_id `eukyjOYWwc2mj4O34Y1zx28GckuV1B52` PASS |
| 2 | license | psql 拿 free tier license | `ZJ-F-63Cxxxxxx` device_limit=1 PASS |
| 3 | first agent | curl POST /api/agent/register | HTTP 200 success=true device_count=1 PASS |
| 4 | **CRITICAL Bug 6** | second agent same license | **HTTP 403 LICENSE_DEVICE_LIMIT_EXCEEDED current_count=1** PASS |
| 5 | DB state | license_machines active count | =1 PASS |
| 6 | **CRITICAL Bug 2** | INSERT publish_tasks status='queued' | **真 INSERT 返 task_id `e710a774-3804-4889-8cdb-c21c5d2a748d`** PASS |
| 7 | constraint | chk_publish_tasks_status 9 enum 完整 | 9/9 含 pending/queued/dispatched/in_progress/completed/failed/running/success/done PASS |
| 8 | **CRITICAL Bug 7** | WS mock client 验 routing key | **WS message agent_id 用 UUID `2e0e27d2-657e-4ea1-a192-3158f21ed19d` (非 string agent_id)** PASS |

## 3 CRITICAL Bug 修复证据

### Bug 6: License 装机数 1 真 enforce
- 旧 backend：log 写"装机数上限=1"但实际允许 N 个 register
- 新 backend (`apps/api/src/services/license.service.ts` 93 行 + `routes/agent.ts` 21 行 +)：register 前 count active machines, ≥ tier_limit → 403 LICENSE_DEVICE_LIMIT_EXCEEDED
- 证据：Step 4 真 HTTP 403 + body 含 `error: "LICENSE_DEVICE_LIMIT_EXCEEDED"` + `current_count: 1`

### Bug 2: publish_tasks status enum 真完整
- 旧：B-1 generator 用 'queued' 撞老 chk_publish_tasks_status (只含 pending/running/success/failed/done) → mac SQL DROP 留 dirty state
- 新 migration `apps/api/db/migrations/20260511_102431_publish_tasks_status_enum_full.sql` (63 行)：DROP 老 + ADD 9 superset (canonical 6: pending/queued/dispatched/in_progress/completed/failed; deprecated 3: running/success/done H-3 sweep)
- 证据：Step 7 `pg_get_constraintdef` 真返 9 个 + Step 6 真 INSERT status='queued' 返 UUID

### Bug 7: WS task routing 用 UUID 而非 string agent_id
- 旧：WS connection 用 string agent_id (Agent 自报) 作 routing key — multi-agent 同 tenant 撞名歧义
- 新 (`apps/api/src/services/agent-ws.ts` 55 行 + `services/task-dispatch.ts` 6 行)：WS connection map 用 agents.id (UUID) 作 key + dispatcher 派 task 时 agent_id 字段填 UUID
- 证据：Step 8 mock WS client 收 backend 派的 message，message.agent_id = UUID `2e0e27d2-657e-4ea1-a192-3158f21ed19d` (`/^[0-9a-f-]{36}$/` 通过)

## H-1 真交付物（已 merge main commit `315fc3e`）

| 类别 | 文件 |
|---|---|
| Backend services | `apps/api/src/services/license.service.ts` (93 行 新), `apps/api/src/services/agent-db.ts` (41 行 +), `apps/api/src/services/agent-registry.ts` (13 行 +), `apps/api/src/services/agent-ws.ts` (55 行 +), `apps/api/src/services/task-dispatch.ts` (6 行 +) |
| Backend routes | `apps/api/src/routes/agent.ts` (21 行 +) |
| Schemas | `apps/api/src/schemas/agent-protocol.ts` (3 行 +) |
| Migration | `apps/api/db/migrations/20260511_102431_publish_tasks_status_enum_full.sql` (63 行 新, **真生产 DB 已跑**) |
| Tests | 3 ws contract SSOT (license-register-dual-schema / publish-tasks-status-enum / ws-routing-uuid) + apps/api/tests/h1/* + apps/api/tests/routes/agent.test.ts (21 行 +) + task-dispatch.test.ts (23 行 +) |
| CI smoke | `.github/workflows/scripts/smoke/agent-hardening-h1-smoke.sh` (97 行 新, fake-agent stub PASS) |
| Lead 自验 | `scripts/lead-acceptance/agent-hardening-h1-self-test.cjs` (298 行 新 + 本 PR 3 fix: Origin header / tenant_id / psql RETURNING trim) |
| Helpers | `apps/api/scripts/h1-ws[123]-helper.sh` (314 行 总) |
| Sprint dir | `sprints/agent-hardening-h1-backend-system/` 全（contract draft + DoD ws[123] + sprint-prd + task-plan） |

## 时间线

- 2026-05-10 ~ 04:30 接受 B-1 partial + 开 hardening sprint
- 2026-05-11 02:34 PR #283 第 1 次 push (subagent generator 完成 contract GAN + 3 ws GREEN)
- 2026-05-11 02:39 修 PR #283 4 CI fail (PR title [CONFIG] + test-registry.yaml 加 3 SSOT)
- 2026-05-11 02:40 CI 35/35 PASS + merge `315fc3e`
- 2026-05-11 02:41 backend redeploy (build apps/api + migration + launchctl restart + health 200)
- 2026-05-11 02:42 ~ 02:44 lead 自验 3 轮 (修脚本 Origin header + tenant_id + psql RETURNING) → 8/8 PASS

## 2 个本 PR 的 self-test 脚本 fix（本 PR 含）

H-1 generator 写的 self-test 脚本有 3 个跑时 bug，本 PR 修：

1. **Step 1 missing Origin header**: better-auth 强制要 Origin → fix 加 `'Origin': API_BASE`
2. **Step 6 INSERT agents 漏 tenant_id**: agents.tenant_id NOT NULL 约束 → fix 借 step 1 注册 user 自动 createdtenant 满足
3. **psql -tA RETURNING 输出含 'INSERT 0 1' 状态行**: → fix `split('\n')[0].trim()` 取 first 行 + 加 `-q` flag

这些是脚本 bug 不是产品 bug — 修脚本后真验 H-1 backend 8/8 PASS。

## 衔接 H-2 sprint

H-1 完成 → 开 H-2 sprint：
- Bug 4: install pack auto-deploy (GitHub Actions 加 SSH rsync nginx + manifest update)
- Bug 5: Agent health server port collision (.env override + auto-detect)
- Bug 8: install pack chrome port 默认 19223 + auto-detect
- Bug 3: mock-agent endpoint secret-token 鉴权（生产可调）
- Lead 自验 dispatcher v1 thin (1 机 rog + Playwright launchPersistentContext cookie 持久化 + 飞书消息推送 mid-run)

H-2 完成 → 重跑 Path 2 Sprint B-1 lead 自验 0-touch → B-1 status PASS (升级 `path-2/lead-acceptance-sprint-b1.md`) → 进 B-2/B-3。
