---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: 中台 burner 路由 + smoke fake-agent helper

**范围**: 新建 6 路由 burner endpoint + helper（NODE_ENV/SMOKE_TOKEN 双门禁）
**大小**: L
**依赖**: WS1

## ARTIFACT 条目

- [ ] [ARTIFACT] agent-burner.ts 路由文件存在 + 含 6 端点
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');['/qr-bind','/qr-bind-result','/sessions','/crawl-comments','/crawl-comments-result','/crawl-tasks/'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] agent-burner 路由含 6 错码
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');['MISSING_ACCOUNT_LABEL','BURNER_ALREADY_BOUND','MISSING_VIDEO_URL','NO_BURNER_SESSION','FEISHU_NOT_BOUND','RESERVED_ACCOUNT_LABEL'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] agent-burner 路由调 lead-writer 触发飞书写入
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/agent-burner.ts','utf8');['lead-writer','writeLeadsFromComments'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] _smoke-fake-agent-burner.ts 文件存在 + 含双门禁
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/_smoke-fake-agent-burner.ts','utf8');['NODE_ENV','production','X-Smoke-Token','SMOKE_TOKEN','fake-agent-burner-progress'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] _smoke-fake-agent-burner.ts NODE_ENV=production return 404
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/_smoke-fake-agent-burner.ts','utf8');if(!/NODE_ENV[^=]*===\s*['\"]production['\"]/.test(c)||!c.includes('404'))process.exit(1)"`

- [ ] [ARTIFACT] app.ts 挂载 burner 路由 + smoke helper
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8');['/api/agent/burner','agentBurnerRouter','/api/_smoke','smokeFakeAgentBurnerRouter'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] Sprint A feishu-* 文件字节级未变
  Test: `bash -c "git diff origin/main...HEAD -- apps/api/src/services/feishu-bitable-multitenant.ts apps/api/src/services/feishu-token.ts apps/api/src/routes/feishu-oauth.ts | wc -l | grep -q '^0$'"`

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/agent-burner-routes.test.ts`：
- POST /api/agent/burner/qr-bind 正常 200 + task_id
- POST /api/agent/burner/qr-bind 缺 account_label → 400 MISSING_ACCOUNT_LABEL
- POST /api/agent/burner/qr-bind account_label='default' → 400 RESERVED_ACCOUNT_LABEL
- POST /api/agent/burner/qr-bind 已绑过 → 400 BURNER_ALREADY_BOUND
- POST /api/agent/burner/qr-bind-result 写 agent_platform_sessions role='burner'
- GET /api/agent/burner/sessions 返 burner 列表（不返 main）
- POST /api/agent/burner/crawl-comments 缺 video_url → 400 MISSING_VIDEO_URL
- POST /api/agent/burner/crawl-comments 无 burner session → 400 NO_BURNER_SESSION
- POST /api/agent/burner/crawl-comments 飞书未绑 → 400 FEISHU_NOT_BOUND
- POST /api/agent/burner/crawl-comments-result 触发 lead-writer + 更新 task

见 `tests/ws3/smoke-fake-agent-burner.test.ts`：
- NODE_ENV=production POST /api/_smoke/fake-agent-burner-progress → 404
- NODE_ENV=test 缺 X-Smoke-Token → 403
- NODE_ENV=test 含正确 SMOKE_TOKEN → 200 + 写 task response
