---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — 前台放弃安卓获客任务（不可逆取消）

**范围**: 本人租户单设备 `running` 获客任务的不可逆放弃；心跳取消指令；Android 安全退出回执；三段可见状态；5 分钟同设备冷却。
**不含**: 暂停/恢复、批量放弃、已采数据回滚。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 迁移为 `acquisition_collect_tasks` 增加 `cancel_requested_at/cancel_sent_at/cancelled_at/cancel_command_id`，并以真 Postgres migration test 锁定可重复执行
  Test: node -e "const c=require('fs').readFileSync('apps/api/db/migrations/20260731_acquisition_cancel_lifecycle.sql','utf8');for(const s of ['cancel_requested_at','cancel_sent_at','cancelled_at','cancel_command_id'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] API route、heartbeat 入队与冷却规则有实现及相邻 integration tests
  Test: node -e "const fs=require('fs');const r=fs.readFileSync('apps/api/src/routes/acquisition.ts','utf8');const t=fs.readFileSync('apps/api/tests/integration/acquisition-cancel.integration.test.ts','utf8');for(const s of ['DEVICE_CANCEL_COOLDOWN','cancel_requested_at','acquisition_cancel'])if(!r.includes(s)||!t.includes(s))process.exit(1)"

- [ ] [ARTIFACT] Dashboard 有真实后端 Playwright spec，spec 内禁止 `page.route()`
  Test: node -e "const fs=require('fs');const p='apps/dashboard/e2e/acquisition-cancel.spec.ts';const c=fs.readFileSync(p,'utf8');if(c.includes('page.route(')||!c.includes('放弃'))process.exit(1)"

- [ ] [ARTIFACT] Android 有取消协调器与真实状态机安全退出测试
  Test: node -e "const fs=require('fs');const a=fs.readFileSync('services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/AcquisitionCancellationCoordinator.kt','utf8');const t=fs.readFileSync('services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/collect/AcquisitionCancellationCoordinatorTest.kt','utf8');for(const s of ['reportCancel','safeExit'])if(!a.includes(s)||!t.includes(s))process.exit(1)"

- [ ] [ARTIFACT] windows_cloud E2E 脚本以 ci/staging 双模式分别验证真本地后端与已部署 staging，且 Android workflow 增加 `scenario=cancel` 与 evidence artifact
  Test: node -e "const fs=require('fs');const ps=fs.readFileSync('sprints/07310943-kernel-0e82adad/e2e-verify.ps1','utf8');const wf=fs.readFileSync('.github/workflows/e2e-line02-android-collect.yml','utf8');for(const s of ['Scenario','Test-NetConnection','apps\\\\api','staging'])if(!ps.includes(s))process.exit(1);if(!wf.includes('scenario')||!wf.includes('android-cancel-evidence'))process.exit(1)"

- [ ] [ARTIFACT] `golden-path-2-smoke.sh` 收编 running→cancelling→cancelled、跨租户与冷却拒绝
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-smoke.sh','utf8');for(const s of ['cancelling','cancelled','DEVICE_CANCEL_COOLDOWN'])if(!c.includes(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 本人租户放弃 running 任务后进入取消中
  动作: 以租户 A 登录态调用 POST /api/acquisition/collect/cancel，body 只传 task_id
  预期观察: API 返回 status=cancelling 与 cancel_phase=requested，DB 记录取消意图
  等待预算: 0s
  留证: integration reporter 输出与对应 DB 行
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "本人租户取消 running 任务返回 cancelling"'

- [ ] [BEHAVIOR] [L2] B-02: 重复点击放弃保持幂等
  动作: 对同一 running/cancelling 任务连续提交两次取消
  预期观察: 只存在一条 acquisition_cancel 指令，cancel_requested_at 不延长
  等待预算: 0s
  留证: publish_tasks 计数与前后时间戳查询输出
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "重复取消幂等且不生成第二条指令"'

- [ ] [BEHAVIOR] [L2] B-03: 下一次真实 shape 心跳下发唯一取消指令 [接缝×2]
  动作: Android 以 production HttpHeartbeatLoop 字段调用 POST /api/agent/heartbeat
  预期观察: within 30s queued_tasks 出现唯一 acquisition_cancel，payload.collect_task_id 匹配
  等待预算: 30s
  留证: 两次 heartbeat 响应 JSON 与 cancel_sent_at DB 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "下一次生产形状 heartbeat 只下发一条|Agent 离线期间保留取消意图"'

- [ ] [BEHAVIOR] [L3] B-04: Android 真机抢占当前采集并安全退出后回执 [接缝×2]
  动作: 在 xian-rog 真机运行采集后，从服务端下发取消指令，连续执行两轮
  预期观察: 当前采集停止、切换账号面板关闭、后续列表读取数为 0、report_status=cancelled
  等待预算: 180s
  留证: 两个 GitHub run URL 与各自 android-cancel-evidence/result.json
  Test: manual:bash -c 'GH_REPO="${GH_REPO:-perfectuser21/zenithjoy-workspace}" GITHUB_REF_NAME="${GITHUB_REF_NAME:?}" bash .github/workflows/scripts/smoke/dispatch-line02-android-cancel.sh --repeat 2 --evidence-dir "sprints/07310943-kernel-0e82adad/evidence"'

- [ ] [BEHAVIOR] [L2] B-05: 无 Agent 回执时永不显示已取消
  动作: 把 cancel_sent_at 回填为 121 秒前但不发送 reportCancel，再查询任务
  预期观察: status 仍为 cancelling，cancel_phase=sent，不存在 cancelled_at
  等待预算: 0s
  留证: API JSON 与 DB 定点查询输出
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "取消指令发出 121 秒无回执仍保持 cancelling sent"'

- [ ] [BEHAVIOR] [L2] B-06: 绑定 Agent 回执后才落 cancelled 并启动冷却
  动作: 以生产 AgentConfig.agentId 对应的 agents.agent_id 文本 slug 作为 x-agent-id，发送 production reportCancel body
  预期观察: API 返回 cancelled，DB 同事务写不早于本次请求开始时刻的 cancelled_at 与 ended_at
  等待预算: 5s
  留证: report response 与 cancelled_at/ended_at 本次请求时间窗查询结果
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "只有绑定 Android Agent 回执后才落 cancelled"'

- [ ] [BEHAVIOR] [L2] B-07: 同设备冷却 5 分钟且显示剩余时间
  动作: cancelled 后立即在同 agent_id 发新任务，再把 cancelled_at 调整到 301 秒前重试
  预期观察: 首次 409 DEVICE_CANCEL_COOLDOWN 且 remaining_seconds 在 1..300，期满后 pending
  等待预算: 5s
  留证: 两次 start 响应与 cancelled_at DB 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "冷却期内同设备新任务返回 DEVICE_CANCEL_COOLDOWN"'

- [ ] [BEHAVIOR] [L2] B-08: 跨租户取消返回冻结 PRD 指定的 403 且不泄露任务或设备
  动作: 租户 B 对租户 A 的 task_id 发取消请求
  预期观察: 返回 403 FORBIDDEN，响应不含 tenant A 或 agent id，DB 不变
  等待预算: 0s
  留证: integration response 与 DB 定点状态
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "跨租户取消返回 403 FORBIDDEN"'

- [ ] [BEHAVIOR] [L2] B-08A: 已结束任务不可放弃且终态不变
  动作: 本人租户对 done 任务调用取消端点
  预期观察: 返回 409 TASK_NOT_CANCELLABLE，status 仍为 done 且 cancel_requested_at 为空
  等待预算: 0s
  留证: integration response 与 DB 定点查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "已结束任务返回 409 TASK_NOT_CANCELLABLE"'

- [ ] [BEHAVIOR] [L2] B-08B: 重复 cancelled 回执不延长冷却
  动作: 对已确认 cancelled 的任务重复发送同一 production reportCancel body
  预期观察: 仍返回 cancelled，cancelled_at 与第一次回执时间完全相同
  等待预算: 0s
  留证: 两次回执响应与前后 cancelled_at 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "重复 cancelled 回执幂等且不延长五分钟冷却起点"'

- [ ] [BEHAVIOR] [L2] B-09: 未登录取消被鉴权层拒绝
  动作: 不带 session、X-Feishu-User-Id 或 tenant body 调取消端点
  预期观察: 返回 401 UNAUTHORIZED，任务状态与命令表都不改变
  等待预算: 0s
  留证: HTTP response body 与 DB 定点查询
  Test: manual:bash -c ': "${API_BASE:?}" "${TASK_ID:?}" "${DATABASE_URL:?}"; BEFORE=$(psql "$DATABASE_URL" -tAc "SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='"'"'$TASK_ID'"'"'"); CODE=$(curl -s -o /tmp/cancel-unauth.json -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/cancel" -H "Content-Type: application/json" -d "{\"task_id\":\"$TASK_ID\"}"); test "$CODE" = 401; jq -e ".error.code==\"UNAUTHORIZED\"" /tmp/cancel-unauth.json; AFTER=$(psql "$DATABASE_URL" -tAc "SELECT status FROM zenithjoy.acquisition_collect_tasks WHERE id='"'"'$TASK_ID'"'"'"); test "$BEFORE" = "$AFTER"'

- [ ] [BEHAVIOR] [L2] B-10: Dashboard 在 staging 显示 requested/sent/confirmed 与冷却提示 [接缝×2]
  动作: 在 Windows 浏览器以真实租户 session 点击放弃并等待 Agent 回执
  预期观察: 依次出现“取消中”“取消指令已发送，等待设备响应”“已取消”和剩余等待时间
  等待预算: 240s
  留证: ${SPRINT_DIR}/screenshots/staging-cancel-requested.png、staging-cancel-sent.png、staging-cancel-confirmed.png、staging-cancel-cooldown.png
  Test: manual:bash -c 'test "${RUNNER_OS:-}" = "Windows" && pwsh -NoProfile -File "sprints/07310943-kernel-0e82adad/e2e-verify.ps1" -Scenario staging -BaseUrl "${STAGING_DASHBOARD_URL:?}" -ApiUrl "${STAGING_API_URL:?}" -ScreenshotDir "sprints/07310943-kernel-0e82adad/screenshots"'

## Invariant 铁律映射

- [ ] [BEHAVIOR] [L2] INV-1: 租户查询与写入严格限定当前租户
  动作: 并发执行租户 A 本人取消与租户 B 跨租户取消
  预期观察: A 成功、B 返回不泄露数据的 403，DB 只有 A 的任务行变化
  等待预算: 5s
  留证: integration reporter 与两个 tenant_id 的 DB 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "本人租户取消|跨租户取消"'

- [ ] [BEHAVIOR] [L2] INV-2: 每个新增或修改端点都有鉴权
  动作: 无认证调用 cancel，再用无效 license 调 heartbeat
  预期观察: cancel 返回 401，heartbeat 返回 401 INVALID_LICENSE，均不写业务状态
  等待预算: 0s
  留证: 两个 HTTP response JSON 与任务状态定点查询
  Test: manual:bash -c ': "${API_BASE:?}" "${TASK_ID:?}"; C1=$(curl -s -o /tmp/inv2a.json -w "%{http_code}" -X POST "$API_BASE/api/acquisition/collect/cancel" -H "Content-Type: application/json" -d "{\"task_id\":\"$TASK_ID\"}"); C2=$(curl -s -o /tmp/inv2b.json -w "%{http_code}" -X POST "$API_BASE/api/agent/heartbeat" -H "Content-Type: application/json" -d "{\"license\":\"invalid\",\"hostname\":\"x\",\"os_type\":\"android\"}"); test "$C1" = 401; test "$C2" = 401; jq -e ".error.code==\"UNAUTHORIZED\"" /tmp/inv2a.json; jq -e ".code==\"INVALID_LICENSE\"" /tmp/inv2b.json'

- [ ] [BEHAVIOR] [L2] INV-3: E2E 默认种两个租户并断言互不串
  动作: 在真 Postgres 创建租户 A/B，并以 B 取消 A 的任务
  预期观察: 租户 B 得不到租户 A 的任务或设备数据，A 的任务保持原状态
  等待预算: 10s
  留证: vitest reporter 与两个 tenant_id 的 DB 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "跨租户取消返回 403 FORBIDDEN"'

- [ ] [BEHAVIOR] [L3] INV-4: 真环境接缝必须真机验证 [接缝×2]
  动作: 查询两次 Android cancel workflow 证据
  预期观察: 两次均 success 且 safe_exit=true，任何不一致判 FLAKY
  等待预算: 180s
  留证: evidence/android-1/result.json 与 evidence/android-2/result.json
  Test: manual:bash -c 'for N in 1 2; do F="sprints/07310943-kernel-0e82adad/evidence/android-$N/result.json"; jq -e ".safe_exit==true and .report_status==\"cancelled\"" "$F"; done; diff -u <(jq -S "del(.timestamps,.run_id)" sprints/07310943-kernel-0e82adad/evidence/android-1/result.json) <(jq -S "del(.timestamps,.run_id)" sprints/07310943-kernel-0e82adad/evidence/android-2/result.json)'

- [ ] [BEHAVIOR] [L3] INV-5: 环境值从真机发现而非写死
  动作: Android workflow 运行时发现 adb、device serial 与窗口状态
  预期观察: 两轮 evidence 均记录非空 discovered_device_serial，成功 oracle 不依赖固定坐标
  等待预算: 60s
  留证: Android result.json 的 environment 字段
  Test: manual:bash -c 'for F in sprints/07310943-kernel-0e82adad/evidence/android-{1,2}/result.json; do jq -e ".environment.discovered_device_serial|type==\"string\" and length>0" "$F"; done'

- [ ] [BEHAVIOR] [L2] INV-6: 凭据不硬编码、不进 git、不进日志
  动作: 查询当前提交的 L1 Secrets Scan job
  预期观察: gitleaks job conclusion=success
  等待预算: 120s
  留证: GitHub job URL 与 conclusion
  Test: manual:bash -c ': "${GH_REPO:?}" "${GITHUB_RUN_ID:?}"; gh api "repos/$GH_REPO/actions/runs/$GITHUB_RUN_ID/jobs" | jq -e "[.jobs[] | select(.name|test(\"Secrets Scan\")) | select(.conclusion==\"success\")] | length==1"'

- [ ] [BEHAVIOR] [L2] INV-7: 错误响应与日志不泄露租户、设备与业务内容
  动作: 用租户 B 取消租户 A 任务并捕获 API 响应及本轮结构化日志
  预期观察: 响应和日志均不含 tenant A、agent id、关键词或聊天内容
  等待预算: 5s
  留证: redaction integration reporter 与扫描结果
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "跨租户取消返回 403 FORBIDDEN"'

- [ ] [BEHAVIOR] [L2] INV-8: 新增取消状态后全状态枚举仍可真实读写
  动作: 在真 Postgres 逐一写入 acquisition_collect_tasks 的既有状态与 cancelling/cancelled
  预期观察: 所有合法状态均可写入并原样读回，非法状态被 CHECK 约束拒绝
  等待预算: 10s
  留证: integration reporter 的状态矩阵与非法状态约束错误
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "新增取消状态后全状态枚举仍可真实读写"'

- [ ] [BEHAVIOR] [L2] INV-9: 指令与终态只按语义字段判成功
  动作: 先取 heartbeat 响应，再以绑定 Agent 发送 cancelled 回执
  预期观察: heartbeat 必须含匹配 task_id 的 acquisition_cancel；回执必须含 data.status=cancelled，通用 success/ok 单独出现不算通过
  等待预算: 30s
  留证: heartbeat queued_tasks JSON、report response 与 DB 终态
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "下一次生产形状 heartbeat 只下发一条|只有绑定 Android Agent 回执后才落 cancelled"'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] 用户完整走完不可逆取消 Golden Path，Windows UI/API 与 Android 真机两层均通过
  Screenshots:
    - `staging-cancel-requested.png`：按钮已置灰，显示“取消中”
    - `staging-cancel-sent.png`：显示“取消指令已发送，等待设备响应”
    - `staging-cancel-confirmed.png`：只有真机回执后显示“已取消”
    - `staging-cancel-cooldown.png`：同设备新任务被拒并显示剩余时间
  Test: manual:bash -c 'bash /tmp/e2e-selfcheck.sh'

## 未覆盖真实链路

- Android cancel 场景尚未出现在当前 xian-rog workflow，Generator 补齐并真跑两次前为 `logic-done-pending`。
- 当前 Windows 获客 spec 使用 `page.route()`；不得作为本合同的 Mode B 证据。
- 无第三方 API mock 豁免；GitHub Actions 仅用于派发真实目标环境。
