---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 1: DB schema + 中台路由 + Agent 协议扩展 + LLM audit + rog 部署脚本

**范围**: 基础设施层 — wechat_publish_task / llm_audit migration（含 approval_source CHECK 约束 enforce A 路线护栏）+ 中台 3 端点（zod 校验）+ zenithjoy-agent wechat-rpa handler（NodeJS spawn Python）+ OpenRouter DeepSeek 封装（FORCE_5XX/CI max_tokens）+ rog 部署脚本
**大小**: L
**依赖**: 无（depends_on: []）

## ARTIFACT 条目

- [ ] [ARTIFACT] migration `20260508_<HHMMSS>_create_wechat_publish_task.sql` 存在含 approval_source CHECK
  Test: ls apps/api/db/migrations/2026*create_wechat_publish_task*.sql && grep -E "approval_source.*CHECK.*\(feishu_user.*feishu_api\)" apps/api/db/migrations/2026*create_wechat_publish_task*.sql

- [ ] [ARTIFACT] migration `20260508_<HHMMSS>_create_llm_audit.sql` 存在
  Test: ls apps/api/db/migrations/2026*create_llm_audit*.sql

- [ ] [ARTIFACT] OpenRouter 封装 + FORCE_5XX/CI max_tokens 逻辑
  Test: grep -E "OPENROUTER_FORCE_5XX|process\.env\.CI" apps/api/src/llm/openrouter.ts | wc -l | awk '{ exit ($1 < 2) }'

- [ ] [ARTIFACT] 中台 3 端点 zod schema 注册
  Test: grep -rE "/api/wechat/(qr-bind|draft-review-poll|scheduler-tick)" apps/api/src/routes/wechat.ts | wc -l | awk '{ exit ($1 < 3) }'

- [ ] [ARTIFACT] Agent wechat-rpa handler 真 spawn 调用
  Test: grep -E "import \{ ?spawn ?\}" services/agent/src/handlers/wechat-rpa.ts && grep -E "spawn\(.*python" services/agent/src/handlers/wechat-rpa.ts

- [ ] [ARTIFACT] rog 部署脚本可执行
  Test: bash -n scripts/deploy-agent-to-rog.sh && [ -x scripts/deploy-agent-to-rog.sh ]

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/db-schema.test.ts`、`tests/ws1/openrouter-llm.test.ts`、`tests/ws1/wechat-rpa-handler.test.ts`，覆盖：

- migration 跑后 wechat_publish_task 含 approval_source 字段 + CHECK 约束（INSERT system 触发 23514 violation）
- llm_audit 表 INSERT/SELECT 联通（cost / model / tokens / request_purpose）
- POST /api/wechat/qr-bind {} → 400 + zod 错误响应含字段名 platform/agent_id
- POST /api/wechat/draft-review-poll?task_id=00000000-0000-0000-0000-000000000000 → 404
- OPENROUTER_FORCE_5XX=1 + NODE_ENV=test → callOpenRouter() throws Error 含 'simulated 5xx'
- 生产环境 NODE_ENV 不在 (test, development) → OPENROUTER_FORCE_5XX 被忽略
- CI=true → callOpenRouter 内部 max_tokens ≤ 20
- handler 端到端：dispatch wechat_qr_bind dryrun task → 子进程退出 0 + receipt JSON 含 wechat_id
