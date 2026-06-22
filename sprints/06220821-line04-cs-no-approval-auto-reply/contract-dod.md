---
skeleton: false
journey_type: agent_remote
target_environment: windows_wechat
---
# Contract DoD — Sprint: 微信客服 无审批自动回复闭环（Line 04）

**范围**: 自动代理开关（默认关）+ 营业时间窗口（含跨午夜）+ 关键人配置 + 上线/下线播报；名单内无审批自动回（1~5s 延迟 + 真送达读回）；名单外 `pending_human`；回执回写；migration 放开 `approval_source` 容纳 `system` + 新增 `auto_sent`/`pending_human`/`send_failed` 状态。
**不在范围**: 转人工接管 UI、朋友圈主动发（send_moment 不碰）、权限后台、Agent 客户机封装、多客服实例、多条聚合回复。
**大小**: L

> **断言分两类**：下方 BEHAVIOR（逻辑断言，环境无关）CI vitest+smoke 绿 = 真 done；BEHAVIOR:E2E（接缝断言，真机相关）必须 xian-rog 真机验，未真验 → 该闭环整体标 `logic-done-pending`，**不得标 done**。

## ARTIFACT 条目

- [ ] [ARTIFACT] auto-mode 裁决+延迟模块存在并导出 decideReplyMode / humanDelayMs
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/wechat/auto-mode.ts','utf8');if(!/export\s+function\s+decideReplyMode/.test(c)||!/export\s+function\s+humanDelayMs/.test(c))process.exit(1)"

- [ ] [ARTIFACT] business-hours 模块存在并导出 isWithinBusinessHours
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/wechat/business-hours.ts','utf8');if(!/export\s+function\s+isWithinBusinessHours/.test(c))process.exit(1)"

- [ ] [ARTIFACT] agent-toggle 播报裁决模块存在并导出 resolveToggleBroadcast
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/wechat/agent-toggle.ts','utf8');if(!/export\s+function\s+resolveToggleBroadcast/.test(c))process.exit(1)"

- [ ] [ARTIFACT] cs-config-store 新增 getAutoAgentConfig / saveAutoAgentConfig（4 键 upsert）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/wechat/cs-config-store.ts','utf8');if(!/getAutoAgentConfig/.test(c)||!/saveAutoAgentConfig/.test(c)||!/auto_agent_enabled/.test(c))process.exit(1)"

- [ ] [ARTIFACT] wechat-config 路由注册 GET/PUT /auto-agent
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/wechat-config.ts','utf8');if(!/['\"]\/auto-agent['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] migration 文件含 approval_source 放开 system + 新状态 auto_sent/pending_human/send_failed
  Test: node -e "const fs=require('fs'),d='apps/api/db/migrations';const f=fs.readdirSync(d).find(x=>/auto.?reply|auto.?agent|approval_source/i.test(x));if(!f){console.error('no migration');process.exit(1)}const s=fs.readFileSync(d+'/'+f,'utf8');for(const v of ['system','auto_sent','pending_human','send_failed']){if(!s.includes(v)){console.error('missing '+v);process.exit(1)}}console.log('OK '+f)"

- [ ] [ARTIFACT] dashboard 配置页含 4 个新配置键 UI
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/WechatCustomerServiceConfigPage.tsx','utf8');for(const k of ['auto_agent_enabled','business_hours_start','business_hours_end','key_contact_wechat']){if(!c.includes(k))process.exit(1)}"

- [ ] [ARTIFACT] xian-rog 真机 E2E 脚本存在
  Test: node -e "const c=require('fs').readFileSync('sprints/06220821-line04-cs-no-approval-auto-reply/e2e-verify.ps1','utf8');if(!/e2e-toggle|e2e-auto-reply|e2e-stranger/.test(c))process.exit(1)"

## BEHAVIOR 条目（逻辑断言 — 内嵌 manual:bash，evaluator/CI 直接跑）

- [ ] [BEHAVIOR] 模式裁决树：ON+名单内+营业内→auto / OFF→review / ON+名单外→pending_human / ON+营业外→out_of_hours
  Test: manual:bash -c 'cd /workspace && npx vitest run apps/api/src/services/wechat/__tests__/auto-mode.test.ts --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] 拟人延迟 humanDelayMs() 500 次采样恒 ∈[1000,5000]ms 且非常量
  Test: manual:bash -c 'cd /workspace && npx vitest run apps/api/src/services/wechat/__tests__/auto-mode.test.ts -t "拟人延迟" --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] 营业时间窗判定含跨午夜（06:00–24:00 含 23:59 不含 00:00；22:00–02:00 含 23:00/01:00）
  Test: manual:bash -c 'cd /workspace && npx vitest run apps/api/src/services/wechat/__tests__/business-hours.test.ts --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] 开关跳变播报：OFF→ON=online、ON→OFF=offline、无跳变=none、缺关键人=skip(reason=key_contact_not_configured)
  Test: manual:bash -c 'cd /workspace && npx vitest run apps/api/src/services/wechat/__tests__/agent-toggle.test.ts --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] 配置端点 Response Schema：GET 返 4 字段 / PUT 合法 200 {success:true} / 非法 400 {error:'INVALID_BODY'}
  Test: manual:bash -c 'cd /workspace && npx vitest run apps/api/src/routes/__tests__/wechat-auto-agent.test.ts --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] 既有 mode:auto/review/名单外 reply 行为回归保持绿（不被本 sprint 改坏）
  Test: manual:bash -c 'cd /workspace && npx vitest run apps/api/src/services/__tests__/wechat-draft-auto-reply.test.ts --reporter=dot'
  期望: exit 0

- [ ] [BEHAVIOR] migration 文件含放开后的约束（approval_source 容纳 system + 新状态 auto_sent/pending_human/send_failed）— 无 migration 时 FAIL
  Test: manual:bash -c 'cd /workspace && node -e "const fs=require(\"fs\"),d=\"apps/api/db/migrations\";const f=fs.readdirSync(d).find(x=>/auto.?reply|auto.?agent|approval_source/i.test(x));if(!f){console.error(\"FAIL: no migration\");process.exit(1)}const s=fs.readFileSync(d+\"/\"+f,\"utf8\");for(const v of [\"system\",\"auto_sent\",\"pending_human\",\"send_failed\"]){if(!s.includes(v)){console.error(\"FAIL missing \"+v);process.exit(1)}}console.log(\"OK \"+f)"'
  期望: exit 0（打印 OK <migration文件名>）

- [ ] [BEHAVIOR] 三态路由 + 回执回写 smoke 已扩到四路由（含 pending_human / out_of_hours）— 未扩 smoke 时 grep FAIL
  Test: manual:bash -c 'cd /workspace && S=.github/workflows/scripts/smoke/wechat-draft-auto-mode-smoke.sh; grep -q "pending_human" "$S" || { echo "FAIL: smoke 未覆盖 pending_human"; exit 1; }; grep -q "out_of_hours" "$S" || { echo "FAIL: smoke 未覆盖 out_of_hours"; exit 1; }; bash "$S"'
  期望: exit 0

## BEHAVIOR:E2E 条目（接缝断言 — xian-rog 真机 final-e2e；未真验整闭环标 logic-done-pending，不得标 done）

- [ ] [BEHAVIOR:E2E] S1 开关跳变 → 关键人微信真收到上线/下线通知（窗口不抢焦点）
  真目标: windows_wechat / xian-rog；脚本 sprints/06220821-line04-cs-no-approval-auto-reply/e2e-verify.ps1 步骤 2、5
  期望: 打开→关键人真出现「🟢…上线」；关闭→真出现「🔴…下线」；exit 0
  状态: logic-done-pending（接缝未真验前不得标 done）

- [ ] [BEHAVIOR:E2E] S2/S4 名单内号发消息 → AI 1~5s 内自动回 → 客户真收到 + 读回验证通过 + 不抢焦点 + ToAPI 真出 reply（非 mock）
  真目标: windows_wechat / xian-rog；e2e-verify.ps1 步骤 3
  期望: stdout 含 delivered|readback_ok；reply 非 FAIL_PLACEHOLDER；exit 0
  状态: logic-done-pending

- [ ] [BEHAVIOR:E2E] S3 名单外号发消息 → 不被自动回 + 飞书/DB 出现本轮 pending_human（时间窗 5min 防伪）
  真目标: windows_wechat / xian-rog；e2e-verify.ps1 步骤 4
  期望: stdout 含 pending_human + 无自动回复；exit 0
  状态: logic-done-pending
