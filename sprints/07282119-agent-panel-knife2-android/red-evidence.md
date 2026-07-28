
 RUN  v4.1.9 /Users/administrator/worktrees/zenithjoy/session-121f4c1e

stderr | sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts
[better-auth] BETTER_AUTH_SECRET 未设置，使用 dev 默认（生产必改）

 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > task_started 写入 panel_events，tenant_id 为服务端反查值 11ms
   → expected 404 to be 200 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > step 事件 progress 字段正确写入 3ms
   → expected 404 to be 200 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > failed 事件 detail 携带 error_code，severity=error 1ms
   → expected 404 to be 200 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > 缺 agent_id → 400 MISSING_AGENT_ID，不写库 1ms
   → expected 404 to be 400 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > line 不是 line02 → 400 INVALID_LINE 1ms
   → expected 404 to be 400 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > agent_id 不存在 → 404 AGENT_NOT_FOUND，不信任客户端 tenant 1ms
   → expected { code: 'NOT_FOUND', …(1) } to be 'AGENT_NOT_FOUND' // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > 缺 X-Tenant-Id → 400 1ms
   → expected 404 to be 400 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > activeTasks 里 title/progress 字段确实透传（Reviewer round1 问题3） 2ms
   → expected 404 to be 200 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > 3分钟无新事件（时间窗口回填）→ state=stuck 1ms
   → expected 404 to be 200 // Object.is equality
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > stuck 任务收到新事件后自动脱离 stuck（PRD 边界情况：无需人工干预） 1ms
   → Cannot read properties of undefined (reading 'find')
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > done 事件后任务从 activeTasks 消失，出现在 recentCompleted 1ms
   → Cannot read properties of undefined (reading 'find')
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > 跨租户互不可见（Invariant 租户隔离） 1ms
   → Cannot read properties of undefined (reading 'find')
 × sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > GET /api/agent/burner/panel-active-tasks [BEHAVIOR] > 同型号两台设备并发扫描不合并显示（Invariant 多设备类型UI区分） 2ms
   → Cannot read properties of undefined (reading 'find')

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/07282119-agent-panel-knife2-android/tests/panel-line02-bridge.test.ts [ sprints/07282119-agent-panel-knife2-android/tests/panel-line02-bridge.test.ts ]
Error: Cannot find module '../../../services/agent/src/shared/panel-line02-bridge' imported from /Users/administrator/worktrees/zenithjoy/session-121f4c1e/sprints/07282119-agent-panel-knife2-android/tests/panel-line02-bridge.test.ts
 ❯ sprints/07282119-agent-panel-knife2-android/tests/panel-line02-bridge.test.ts:24:5
     22|   beforeEach(() => {
     23|     bus = new PanelEventBus();
     24|     fetchMock = vi.fn();
       |     ^
     25|     vi.stubGlobal('fetch', fetchMock);
     26|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
Serialized Error: { code: 'ERR_MODULE_NOT_FOUND' }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/14]⎯


⎯⎯⎯⎯⎯⎯ Failed Tests 13 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > task_started 写入 panel_events，tenant_id 为服务端反查值
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404

 ❯ sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts:69:22
     67|       [taskId],
     68|     );
     69|     expect(row.rows).toHaveLength(1);
       |                      ^
     70|     expect(row.rows[0].tenant_id).toBe(tenantId);
     71|     expect(row.rows[0].event).toBe('task_started');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/14]⎯

 FAIL  sprints/07282119-agent-panel-knife2-android/tests/panel-event-line02.integration.test.ts > POST /api/agent/burner/panel-event [BEHAVIOR] > step 事件 progress 字段正确写入
AssertionError: expected 404 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 404


---
（截断，完整 13/13 failed 见 CI 日志；红证据摘要：13 failed / 13 total，
panel-event-line02.integration.test.ts 因端点不存在 → 404/undefined，
panel-line02-bridge.test.ts 因 services/agent/src/shared/panel-line02-bridge.ts 不存在 → import error）
