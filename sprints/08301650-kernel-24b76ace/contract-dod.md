---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 工作机控制塔可视化·第一刀（worker 活动协议 + 总览 + 实时详情）

**范围**: `apps/api` worker 活动协议 8 端点 + 租约 sweeper + 截图落盘；`apps/dashboard` `/dashboard/workers` 总览页 + 实时详情页 + 侧栏入口；新表 `zenithjoy.worker_tasks`/`worker_task_steps`；假执行器 E2E + smoke 进 CI。不动 `publish_tasks`。
**大小**: L

> 执行前提：以下 [BEHAVIOR] 由 evaluator 在 E2E harness（`## E2E 验收` 脚本已起 api + 真库 + `E2E_FAKE_EXECUTORS=1` seed stub agents）内执行，环境变量 `BASE_URL/DATABASE_URL/TENANT_A/TENANT_B/AGENT_WIN/AGENT_AND` 已导出。

## ARTIFACT 条目

- [ ] [ARTIFACT] worker 路由文件存在且挂载 `/api/workers`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8');if(!c.includes('/api/workers'))process.exit(1)"
- [ ] [ARTIFACT] 新表迁移存在（worker_tasks + worker_task_steps + zenithjoy schema）
  Test: bash -c 'ls apps/api/db/migrations/*worker_task*.sql >/dev/null 2>&1 && grep -ql "zenithjoy.worker_tasks" apps/api/db/migrations/*worker_task*.sql && grep -ql "zenithjoy.worker_task_steps" apps/api/db/migrations/*worker_task*.sql'
- [ ] [ARTIFACT] 租约 sweeper 服务存在（60s 扫 running 且 lease_until<now）
  Test: bash -c 'grep -rql "executor_lost" apps/api/src'
- [ ] [ARTIFACT] smoke 脚本进 CI（worker-activity-smoke.sh + 对应 workflow 引用）
  Test: bash -c 'test -f .github/workflows/scripts/smoke/worker-activity-smoke.sh && grep -rql "worker-activity-smoke.sh" .github/workflows/*.yml'
- [ ] [ARTIFACT] 侧栏"工作机"入口 + 总览页 + 详情页组件存在
  Test: bash -c 'grep -ql "/dashboard/workers" apps/dashboard/src/config/navigation.config.ts && ls apps/dashboard/src/pages/*Worker*.tsx >/dev/null 2>&1'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 登录后总览列出 win32 + android 卡片
  动作: GET /api/workers（本租户）
  预期观察: 返回卡片数组含 ≥1 台 kind=win32 与 ≥1 台 kind=android（E2E_FAKE_EXECUTORS seed 的 stub agents），带在线状态
  等待预算: 0s
  留证: 命令输出 JSON
  Test: manual:bash -c 'curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq -e "[.workers[].kind]|(index(\"win32\") and index(\"android\"))"'

- [ ] [BEHAVIOR] [L2] B-02: 开始任务 + 3 步 done → 卡片显示"正在执行 第 3/5 步"、详情 3 条 ✅ 带缩略截图
  动作: POST tasks（steps 长度 5）→ 连发 3 条 steps(status=done, 带 screenshot)
  预期观察: 总览卡片 current_step=3 steps_total=5；activity current.steps 有 3 条 done 且 screenshot_ref 非空
  等待预算: 2s
  留证: 命令输出（current + steps）
  Test: manual:bash -c 'set -e; T=$(curl -sf "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"发布视频到抖音\",\"steps\":[\"a\",\"b\",\"c\",\"d\",\"e\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); for i in 0 1 2; do curl -sf "$BASE_URL/api/workers/tasks/$T/steps" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"step_index\":$i,\"status\":\"done\",\"screenshot_jpeg_b64\":\"$(printf s$i|base64)\",\"executor_id\":\"e2e-fake-executor\"}" >/dev/null; done; curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq -e ".workers[]|select(.agent_id==\"$AGENT_WIN\")|.current.current_step==3 and .current.steps_total==5"'

- [ ] [BEHAVIOR] [L2] B-03: 推帧 ×5 → GET live 10s 内输出 ≥2 帧 [接缝×2]
  动作: POST frame ×5（不同内容）→ GET live（MJPEG）
  预期观察: live 10 秒内输出 ≥2 个 --frame 边界（相邻帧内容不同，非重复旧帧）
  等待预算: 10s
  留证: 帧计数输出
  Test: manual:bash -c 'for i in 1 2 3 4 5; do curl -sf "$BASE_URL/api/workers/$AGENT_WIN/frame" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"frame_jpeg_b64\":\"$(head -c 96 /dev/urandom|base64|tr -d "\n")\"}" >/dev/null; sleep 0.2; done; N=$(timeout 10 curl -s "$BASE_URL/api/workers/$AGENT_WIN/live" -H "X-Tenant-Id: $TENANT_A" | head -c 8000 | grep -c -- "--frame" || true); [ "${N:-0}" -ge 2 ] || { echo "FAIL frames=$N"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: 停推 15s → 详情页画面标记 stale（画面不可用）
  动作: 停止推帧，等待 15 秒后 GET activity
  预期观察: activity.live.stale==true（最新帧超 15s）
  等待预算: 18s
  留证: activity.live 输出
  Test: manual:bash -c 'DEADLINE=$((SECONDS+18)); sleep 16; until curl -sf "$BASE_URL/api/workers/$AGENT_WIN/activity" -H "X-Tenant-Id: $TENANT_A" | jq -e ".live.stale==true" >/dev/null; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: 15s 后未标 stale"; exit 1; }; sleep 1; done; echo "OK: 画面不可用"'

- [ ] [BEHAVIOR] [L2] B-05: steps failed 缺三件套 → 400（invariant 93ed0761）
  动作: 开任务后 POST steps status=failed，故意不带 foreground_pkg/diag_line/screenshot
  预期观察: HTTP 400（不得判成功）
  等待预算: 0s
  留证: HTTP 状态码
  Test: manual:bash -c 'T=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"私信\",\"steps\":[\"x\",\"y\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/workers/tasks/$T/steps" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"step_index\":0,\"status\":\"failed\",\"executor_id\":\"e2e-fake-executor\"}"); [ "$C" = "400" ] || { echo "FAIL code=$C"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: steps failed 带三件套 → 历史现场落库（前台包名+诊断行+截图）
  动作: 开任务后 POST steps status=failed，带 foreground_pkg=com.tencent.mm + diag_line + screenshot
  预期观察: 200；activity 中该失败步骤含 foreground_pkg、diag_line、screenshot_ref 非空
  等待预算: 0s
  留证: activity 失败步骤 JSON
  Test: manual:bash -c 'set -e; T=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"私信2\",\"steps\":[\"x\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); curl -sf "$BASE_URL/api/workers/tasks/$T/steps" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"step_index\":0,\"status\":\"failed\",\"foreground_pkg\":\"com.tencent.mm\",\"diag_line\":\"foreground stolen after tap\",\"screenshot_jpeg_b64\":\"$(printf f|base64)\",\"executor_id\":\"e2e-fake-executor\"}" >/dev/null; curl -sf "$BASE_URL/api/workers/$AGENT_AND/activity" -H "X-Tenant-Id: $TENANT_A" | jq -e "[.current.steps[]?,((.history[]?.steps)//[])[]]|map(select(.status==\"failed\"))|any(.foreground_pkg==\"com.tencent.mm\" and (.diag_line|test(\"stolen\")) and .screenshot_ref!=null)"'

- [ ] [BEHAVIOR] [L2] B-07: 跨租户访问 worker activity/live → 404（不泄露存在性）
  动作: 另一租户会话 GET 该 worker 的 activity 与 live
  预期观察: 两者均 HTTP 404
  等待预算: 0s
  留证: 两个状态码
  Test: manual:bash -c 'A=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/workers/$AGENT_WIN/activity" -H "X-Tenant-Id: $TENANT_B"); L=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/workers/$AGENT_WIN/live" -H "X-Tenant-Id: $TENANT_B"); [ "$A" = "404" ] && [ "$L" = "404" ] || { echo "FAIL activity=$A live=$L"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-08: 同 worker 第二个 running 任务 → 409
  动作: 对已有 running 任务的 agent 再 POST tasks
  预期观察: HTTP 409（不得双 running）
  等待预算: 0s
  留证: 状态码
  Test: manual:bash -c 'curl -sf "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"占位\",\"steps\":[\"a\"],\"executor_id\":\"e2e-fake-executor\"}" >/dev/null 2>&1 || true; C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"重复\",\"steps\":[\"b\"],\"executor_id\":\"e2e-fake-executor\"}"); [ "$C" = "409" ] || { echo "FAIL code=$C"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-09: 租约过期 → sweeper 标 failed/executor_lost，不新增任务 [接缝×2]
  动作: 用短租约开任务（E2E_LEASE_SECONDS=2），等待 sweeper（≤60s+）扫过
  预期观察: within 90s 该任务 status=failed 且 error_code=executor_lost；worker_tasks 不因此新增任务行
  等待预算: 90s
  留证: activity.history 该任务终态输出
  Test: manual:bash -c 'T=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -H "X-E2E-Lease-Seconds: 2" -d "{\"title\":\"会失联\",\"steps\":[\"a\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); DEADLINE=$((SECONDS+90)); until curl -sf "$BASE_URL/api/workers/$AGENT_AND/activity" -H "X-Tenant-Id: $TENANT_A" | jq -e "[.current?,(.history[]?)]|map(select(.task_id==\"$T\"))|any(.status==\"failed\" and .error_code==\"executor_lost\")" >/dev/null; do [ $SECONDS -lt $DEADLINE ] || { echo "FAIL: 90s 内未标 executor_lost"; exit 1; }; sleep 3; done; echo "OK: executor_lost"'

- [ ] [BEHAVIOR] [L2] B-10: complete → 卡片回空闲、今日完成 +1、历史 +1
  动作: 开任务 → complete(outcome=completed)，比对完成前后 today_completed 与 history 条数
  预期观察: current 变 null；today_completed 增 1；history 长度 +1
  等待预算: 2s
  留证: 前后计数输出
  Test: manual:bash -c 'set -e; B=$(curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq ".workers[]|select(.agent_id==\"$AGENT_WIN\")|.today_completed"); T=$(curl -sf "$BASE_URL/api/workers/$AGENT_WIN/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"收尾\",\"steps\":[\"a\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); curl -sf "$BASE_URL/api/workers/tasks/$T/complete" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"outcome\":\"completed\"}" >/dev/null; A=$(curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq ".workers[]|select(.agent_id==\"$AGENT_WIN\")|.today_completed"); CUR=$(curl -sf "$BASE_URL/api/workers" -H "X-Tenant-Id: $TENANT_A" | jq ".workers[]|select(.agent_id==\"$AGENT_WIN\")|.current"); [ "$A" -eq "$((B+1))" ] && [ "$CUR" = "null" ] || { echo "FAIL before=$B after=$A current=$CUR"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-1: 失败现场三件套不变量（任一 RPA 结果上报缺现场即拒）
  动作: 复用 B-05（缺三件套）与 B-06（带三件套）两路
  预期观察: 缺一 → 400 拒写；齐全 → 落库可查（invariant 93ed0761，不得凭空判成功）
  等待预算: 0s
  留证: B-05/B-06 输出
  Test: manual:bash -c 'T=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"inv\",\"steps\":[\"x\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/workers/tasks/$T/steps" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"step_index\":0,\"status\":\"failed\",\"foreground_pkg\":\"com.tencent.mm\",\"executor_id\":\"e2e-fake-executor\"}"); [ "$C" = "400" ] || { echo "FAIL: 仅缺诊断行/截图仍放行 code=$C"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] INV-2: 租户隔离不变量（截图取回跨租户 404）
  动作: 另一租户 GET /api/workers/steps/screenshots/:ref（用本租户真实 ref）
  预期观察: HTTP 404（不泄露截图存在性）
  等待预算: 0s
  留证: 状态码
  Test: manual:bash -c 'set -e; T=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/tasks" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"title\":\"shot\",\"steps\":[\"x\"],\"executor_id\":\"e2e-fake-executor\"}" | jq -er .task_id); curl -sf "$BASE_URL/api/workers/tasks/$T/steps" -H "X-Tenant-Id: $TENANT_A" -H "Content-Type: application/json" -d "{\"step_index\":0,\"status\":\"done\",\"screenshot_jpeg_b64\":\"$(printf p|base64)\",\"executor_id\":\"e2e-fake-executor\"}" >/dev/null; REF=$(curl -sf "$BASE_URL/api/workers/$AGENT_AND/activity" -H "X-Tenant-Id: $TENANT_A" | jq -er "[.current.steps[]?|.screenshot_ref|select(.!=null)][0]"); C=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/workers/steps/screenshots/$REF" -H "X-Tenant-Id: $TENANT_B"); [ "$C" = "404" ] || { echo "FAIL 跨租户截图 code=$C"; exit 1; }; echo OK'

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — Playwright 打真实后端）

- [ ] [BEHAVIOR:E2E] 主理人在 /dashboard/workers 走完总览→详情，截图可视化验证
  Screenshots:
    - 01-overview.png   期望：/dashboard/workers 总览页加载，含 🖥️/📱 卡片与在线状态
    - 02-detail-running.png   期望：详情页左画面区、右步骤流出现 ✅/▶️ 与缩略截图，卡片显示"第 x/y 步"
    - 03-history.png    期望：任务 complete 后底部历史新增一条（结果/耗时）
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：evaluator 完成后截图复制到 ${SPRINT_DIR}/screenshots/，Claude Read 图自验通过
