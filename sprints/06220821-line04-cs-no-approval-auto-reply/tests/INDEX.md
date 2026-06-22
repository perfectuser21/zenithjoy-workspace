# TDD Red 测试索引 — 无审批自动回复闭环（Line 04）

测试落在仓库 canonical 位置（被 `apps/api/vitest.config.ts` include 扫描，与既有 line04 测试同处），
不放 sprint 目录（apps/api vitest 不扫 sprints/）。GAN Round 1 已确认 Red（模块未实现 → Cannot find module / store 缺导出）。

| Test File（canonical）| 覆盖 | Round 1 Red 证据 |
|---|---|---|
| `apps/api/src/services/wechat/__tests__/auto-mode.test.ts` | decideReplyMode 四态裁决 + humanDelayMs∈[1000,5000] | Cannot find module '../auto-mode' |
| `apps/api/src/services/wechat/__tests__/business-hours.test.ts` | isWithinBusinessHours 普通窗 + 跨午夜 | Cannot find module '../business-hours' |
| `apps/api/src/services/wechat/__tests__/agent-toggle.test.ts` | resolveToggleBroadcast online/offline/none/skip | Cannot find module '../agent-toggle' |
| `apps/api/src/routes/__tests__/wechat-auto-agent.test.ts` | GET/PUT /api/wechat/auto-agent Response Schema | store 缺 getAutoAgentConfig/saveAutoAgentConfig |

Red 复跑：
```bash
cd /workspace && npx vitest run \
  apps/api/src/services/wechat/__tests__/auto-mode.test.ts \
  apps/api/src/services/wechat/__tests__/business-hours.test.ts \
  apps/api/src/services/wechat/__tests__/agent-toggle.test.ts \
  apps/api/src/routes/__tests__/wechat-auto-agent.test.ts --reporter=dot
```

接缝断言（真机，不在 vitest 内）见 `../contract-draft.md` 接缝清单 S1–S4 + `../e2e-verify.ps1`。
