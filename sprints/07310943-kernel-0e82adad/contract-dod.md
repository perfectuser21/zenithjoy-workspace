---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — 前台放弃安卓获客任务（不可逆取消）

**范围**: 本人租户单设备 running 获客任务的不可逆放弃、心跳取消、Android 安全退出回执、三段可见状态、稳定物理设备 5 分钟冷却。
**不含**: 暂停/恢复、批量放弃、staging 发布、Bark/promote、已采数据回滚。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 增加取消时间、唯一命令与稳定设备快照字段
  Test: node -e "const c=require('fs').readFileSync('apps/api/db/migrations/20260731_acquisition_cancel_lifecycle.sql','utf8');for(const s of ['cancel_requested_at','cancel_sent_at','cancelled_at','cancel_command_id','device_machine_id'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] Dashboard cancel spec 打真实后端且不含 `page.route()`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/acquisition-cancel.spec.ts','utf8');if(c.includes('page.route(')||!c.includes('cancel-requested')||!c.includes('cancel-confirmed'))process.exit(1)"

- [ ] [ARTIFACT] Windows workflow 启真 API/Postgres 并执行 cancel spec 两次
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-orphan-consolidation-windows.yml','utf8');for(const s of ['acquisition-cancel.spec.ts','apps/api','Repeat cancel E2E'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] Android workflow 支持 `scenario=cancel`、`repeat=2` 并上传 `android-cancel-evidence`
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-line02-android-collect.yml','utf8');for(const s of ['scenario','cancel','repeat','attempt_marker','android-cancel-evidence'])if(!c.includes(s))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 本人租户放弃 running 任务后进入取消中
  动作: 以租户 A session 调 POST /api/acquisition/collect/cancel，body 只传 task_id
  预期观察: HTTP 200，status=cancelling、cancel_phase=requested，响应无租户/设备字段
  等待预算: 0s
  留证: Vitest reporter、response JSON 与真 PG 任务行
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "本人租户取消 running 任务返回 cancelling"'

- [ ] [BEHAVIOR] [L2] B-02: 跨租户与不存在任务不可区分
  动作: 租户 B 分别取消租户 A 的真实 task_id 和随机不存在 UUID
  预期观察: 两次均返回完全相同的 403 FORBIDDEN 信封，DB 无变化且响应不含任务/设备信息
  等待预算: 0s
  留证: 两个 response JSON 的 deep-equal 输出与 DB 前后状态
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "跨租户与不存在任务返回不可区分的 403"'

- [ ] [BEHAVIOR] [L2] B-03: 重复取消幂等且终态不可重入
  动作: 并发重复取消同一 running 任务，再取消本人已 done 任务
  预期观察: 活动命令 exactly 1、首次请求时间不变；done 返回 409 且状态不变
  等待预算: 5s
  留证: publish_tasks 计数、时间戳与终态查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "重复取消幂等|已结束任务返回 409"'

- [ ] [BEHAVIOR] [L2] B-04: heartbeat 下发唯一指令并快照稳定设备 [接缝×2]
  动作: 先确认任务 device_machine_id/cancel_sent_at 均为空，再记录 cancel 接受时间并以生产字段和已认证 machine_id 发 heartbeat
  预期观察: 实测 within 30s 响应含唯一 acquisition_cancel，只有 heartbeat 后任务 device_machine_id 才等于 machine_id
  等待预算: 30s
  留证: cancel accepted/command received 实测毫秒差、heartbeat JSON 与 heartbeat 前后真 PG 快照
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "heartbeat 下发唯一取消指令并快照稳定设备|取消接受到真实 heartbeat 响应的实测时延不超过 30 秒"'

- [ ] [BEHAVIOR] [L3] B-05: Android 真机抢占采集、安全退出后回执 [接缝×2]
  动作: xian-rog 在采集运行中接收真实取消指令，按 workflow repeat=2 执行
  预期观察: 两轮均停止当前采集、关闭切换账号面板、后续列表读取为 0，随后 report_status=cancelled
  等待预算: 900s
  留证: 绑定本次 github_run_id/head_sha/attempt_marker 的 result-1.json、result-2.json 与 GitHub run URL
  Test: manual:bash -c ': "${ANDROID_RUN_ID:?}" "${EXPECTED_SHA:?}" "${ATTEMPT_MARKER:?}"; for N in 1 2; do F="sprints/07310943-kernel-0e82adad/evidence/android/result-$N.json"; jq -e --argjson run_id "$ANDROID_RUN_ID" --arg sha "$EXPECTED_SHA" --arg marker "$ATTEMPT_MARKER" --argjson repeat_index "$N" ".github_run_id==\$run_id and .head_sha==\$sha and .attempt_marker==\$marker and .repeat_index==\$repeat_index and .safe_exit==true and .switch_account_panel_open==false and .continued_list_reads==0 and .report_status==\"cancelled\" and (((.command_received_at|fromdateiso8601)-(.cancel_requested_at|fromdateiso8601)) <= 30)" "$F"; done'

- [ ] [BEHAVIOR] [L2] B-06: 无回执两分钟仍等待，绑定回执才落终态
  动作: 先在 heartbeat 前用绑定 Agent 提前回执，再让 cancel_sent_at 超过 121 秒不回执，最后以错误 Agent 和经过 heartbeat/sent 的绑定 Agent 分别回执
  预期观察: heartbeat 前回执 409 CANCEL_NOT_SENT；超时仍 cancelling/sent；错误 Agent 403；只有 heartbeat 真下发后的绑定 Agent 才返回 data.status=cancelled
  等待预算: 5s
  留证: 三次响应与 cancelled_at/ended_at 真 PG 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "121 秒无回执|只有绑定 Android Agent 回执"'

- [ ] [BEHAVIOR] [L2] B-07: 重复 cancelled 回执不延长冷却起点
  动作: 对已 confirmed 的任务重复发送同一生产 report body
  预期观察: 两次均返回 cancelled，cancelled_at 与 ended_at 保持首次值
  等待预算: 0s
  留证: 两次 response 与前后时间戳
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "重复 cancelled 回执幂等"'

- [ ] [BEHAVIOR] [L2] B-08: 稳定 machine_id 冷却不能被换 agent_id 绕过
  动作: confirmed 后用同一 machine_id 注册新的 runtime agent_id 再 start，并用另一 machine_id 对照，最后把 cancelled_at 调到 301 秒前
  预期观察: 同物理设备 409 且 remaining_seconds=1..300；另一设备不误伤；期满同设备返回 pending
  等待预算: 5s
  留证: 三次 start response 与 `(tenant_id,device_machine_id)` 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "稳定 machine_id 冷却不能被更换 agent_id 绕过"'

- [ ] [BEHAVIOR] [L2] B-09: 未登录请求被鉴权层拒绝
  动作: 不带 session 调取消端点
  预期观察: HTTP 401，任务状态、取消时间与命令计数均不变
  等待预算: 0s
  留证: response JSON 与 DB 前后快照
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "未登录取消返回 401"'

- [ ] [BEHAVIOR] [L2] B-10: Windows UI 真实显示取消三态与冷却 [接缝×2]
  动作: 在 Windows Chrome 对真 API/PG 连走两次“点击放弃→等待 heartbeat→回执→重触发”，并在 requested、sent 两态分别对“放弃”控件执行 Playwright `toBeDisabled()` 断言
  预期观察: 每轮依次可见“取消中”“取消指令已发送，等待设备响应”“已取消”和剩余等待时间；requested/sent 期间“放弃”按钮持续禁用，无法再次触发取消请求
  等待预算: 240s
  留证: screenshots/cancel-requested.png、cancel-sent.png（均须呈现禁用控件状态）、cancel-confirmed.png、cancel-cooldown.png 与含两次 `toBeDisabled()` oracle 的 Playwright trace
  Test: manual:bash -c 'test "${RUNNER_OS:-}" = "Windows" && pwsh -NoProfile -File sprints/07310943-kernel-0e82adad/e2e-verify.ps1 -BaseUrl http://localhost:5174 -ApiUrl http://localhost:3000 -Repeat 2 -ScreenshotDir sprints/07310943-kernel-0e82adad/screenshots'

## Invariant 铁律映射

- [ ] [BEHAVIOR] [L2] INV-1: 租户隔离且防存在性枚举
  动作: 两租户对真实异租户 UUID 和不存在 UUID 执行取消
  预期观察: 两个 403 信封深相等，只有本人任务可变化
  等待预算: 5s
  留证: integration reporter 与两租户 DB 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "跨租户与不存在任务返回不可区分的 403"'

- [ ] [BEHAVIOR] [L2] INV-2: 新增和修改端点都有生产鉴权
  动作: 无 session 调 cancel，无效 license 调 heartbeat，无 x-agent-id 调 report
  预期观察: 分别 401/401/401，均不写业务状态
  等待预算: 0s
  留证: integration response 与 DB 快照
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "未登录取消返回 401|无效生产调用方认证"'

- [ ] [BEHAVIOR] [L2] INV-3: E2E 默认两个租户且互不串
  动作: 真 PG 创建租户 A/B，A 取消本人任务，B 尝试同一 UUID
  预期观察: A 成功、B 防枚举拒绝，B 无法读到 A 的设备键
  等待预算: 5s
  留证: 两租户 fixture 与 DB 查询
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "本人租户取消|跨租户与不存在任务"'

- [ ] [BEHAVIOR] [L3] INV-4: 真机接缝未真验不得 done [接缝×2]
  动作: 读取 Android workflow 两轮真实 evidence
  预期观察: 两轮语义 oracle 全真且结论一致，否则 FAIL/FLAKY
  等待预算: 0s
  留证: evidence/android/result-1.json、result-2.json
  Test: manual:bash -c ': "${ANDROID_RUN_ID:?}" "${EXPECTED_SHA:?}" "${ATTEMPT_MARKER:?}"; for N in 1 2; do jq -e --argjson run_id "$ANDROID_RUN_ID" --arg sha "$EXPECTED_SHA" --arg marker "$ATTEMPT_MARKER" ".github_run_id==\$run_id and .head_sha==\$sha and .attempt_marker==\$marker and .safe_exit==true and .report_status==\"cancelled\"" "sprints/07310943-kernel-0e82adad/evidence/android/result-$N.json"; done'

- [ ] [BEHAVIOR] [L3] INV-5: 环境身份从真机发现而非写死
  动作: workflow 从 AgentConfig/heartbeat 采集本轮 machine_id 与 adb serial
  预期观察: 两轮 evidence 的 machine_id、adb_serial 均非空，合同无固定坐标 oracle
  等待预算: 0s
  留证: evidence environment 字段
  Test: manual:bash -c 'for N in 1 2; do jq -e "(.machine_id|type==\"string\" and length>0) and (.adb_serial|type==\"string\" and length>0)" "sprints/07310943-kernel-0e82adad/evidence/android/result-$N.json"; done'

- [ ] [BEHAVIOR] [L2] INV-6: 凭据不硬编码、不进日志
  动作: 对当前提交运行仓库 secrets scan
  预期观察: gitleaks exit 0，evidence 与日志不含 license/session 原值
  等待预算: 120s
  留证: secrets scan job URL 与脱敏日志
  Test: manual:bash -c 'npx gitleaks detect --no-banner --redact --source .'

- [ ] [BEHAVIOR] [L2] INV-7: 错误与日志不泄露租户、任务或设备
  动作: 执行跨租户和不存在 UUID 防枚举请求并扫描结构化响应
  预期观察: 响应 shape 深相等且不含 tenant_id/device_machine_id/agent_id
  等待预算: 0s
  留证: response JSON 与 reporter 输出
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "跨租户与不存在任务返回不可区分的 403"'

- [ ] [BEHAVIOR] [L2] INV-8: 全状态枚举仍可真实读写
  动作: 真 PG 逐一写入所有既有状态和 cancelling/cancelled，再尝试 paused
  预期观察: 合法状态原样读回，paused 被约束拒绝
  等待预算: 10s
  留证: 状态矩阵 reporter 与 PG constraint error
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "新增取消状态后全状态枚举"'

- [ ] [BEHAVIOR] [L2] INV-9: 指令与终态按语义字段判成功
  动作: 检查 heartbeat 指令 type/payload，再检查 report 的 data.status 与 DB 终态
  预期观察: 只有 acquisition_cancel+匹配 collect_task_id 算 sent，只有 data.status=cancelled+DB 落章算 confirmed
  等待预算: 30s
  留证: heartbeat/report JSON 与 DB 行
  Test: manual:bash -c 'DATABASE_URL="${DATABASE_URL:?}" npx vitest run sprints/07310943-kernel-0e82adad/tests/acquisition-cancel.integration.test.ts -t "heartbeat 下发唯一取消指令|只有绑定 Android Agent 回执"'

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] [L3] E2E-01: 用户完整走完不可逆取消 Golden Path [接缝×2]
  动作: Windows 真浏览器连跑两轮 UI/API/PG，再由 xian-rog 连跑两轮 Android 真机取消
  预期观察: UI 四态正确，Android 安全退出后才 confirmed，同 machine_id 冷却不可被新 agent_id 绕过
  等待预算: 1200s
  留证: 四张截图、两轮 Playwright trace、绑定本次 run/SHA/marker 的两个 Android result JSON 与 run URL
  Test: manual:bash -c 'export SPRINT_DIR="${SPRINT_DIR:-sprints/07310943-kernel-0e82adad}"; bash -c "$(awk "/^## E2E 验收/{found=1;next} found&&/^## /{exit} found&&/^.{3}bash$/{b=1;next} b&&/^.{3}$/{b=0;next} b{print}" "$SPRINT_DIR/contract-draft.md")"'

## 未覆盖真实链路清单

- Windows workflow 尚未启动真 API/PG 或执行 cancel spec；Generator 补齐并双跑前为 `logic-done-pending`。
- Android workflow 尚无 cancel scenario/evidence；Generator 补齐并真机双跑前为 `logic-done-pending`。
- 无第三方 API、force、stub 或假数据豁免。
