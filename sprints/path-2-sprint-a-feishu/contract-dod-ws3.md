---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: feishu-bitable-multitenant.ts + feishu-oauth + lead-config 路由

**范围**: 多租户 Bitable 自动建表服务 + OAuth start/callback + lead-config GET API
**大小**: L
**依赖**: WS2

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/services/feishu-bitable-multitenant.ts` 文件存在
  Test: `node -e "require('fs').statSync('apps/api/src/services/feishu-bitable-multitenant.ts')"`

- [ ] [ARTIFACT] 多租户 Bitable 文件导出 `provisionBitable` + `fetchLeadConfig`
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-bitable-multitenant.ts','utf8');['export async function provisionBitable','export async function fetchLeadConfig'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`

- [ ] [ARTIFACT] 多租户文件不复用旧的 `COMPETITOR_BITABLE` 常量（防撞 Path 1 单租户）
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-bitable-multitenant.ts','utf8');if(c.includes('COMPETITOR_BITABLE')||c.includes(\"FEISHU_COMPETITOR_APP_TOKEN\"))process.exit(1)"`

- [ ] [ARTIFACT] `apps/api/src/routes/feishu-oauth.ts` 文件存在 + 含 `/start` + `/callback` 路由
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/feishu-oauth.ts','utf8');['router.post','/start','router.get','/callback'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`

- [ ] [ARTIFACT] `apps/api/src/routes/lead-config.ts` 文件存在 + `router.get('/:tenantId'`
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/routes/lead-config.ts','utf8');if(!c.includes(\"router.get('/:tenantId'\")&&!c.includes('router.get(\"/:tenantId\"'))process.exit(1)"`

- [ ] [ARTIFACT] `apps/api/src/app.ts` 挂载新路由 `/api/feishu/oauth` + `/api/lead-config`
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8');if(!c.includes('/api/feishu/oauth')||!c.includes('/api/lead-config'))process.exit(1)"`

- [ ] [ARTIFACT] 旧的 `apps/api/src/services/feishu-bitable.ts` 单租户文件未被本 sprint 修改（git diff 字节级）
  Test: `bash -c "git diff origin/main...HEAD -- apps/api/src/services/feishu-bitable.ts | wc -l | tr -d ' ' | grep -q '^0$'"`

- [ ] [ARTIFACT] `apps/api/test-utils/fake-feishu-server.ts` 文件存在 + 监听 3099 + 含 5 个核心端点
  Test: `node -e "const c=require('fs').readFileSync('apps/api/test-utils/fake-feishu-server.ts','utf8');['3099','tenant_access_token','/bitable/v1/apps','/tables','/records','bascn','tbl'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

- [ ] [ARTIFACT] 多租户文件用 `process.env.FEISHU_API_BASE` 而非硬编码 `https://open.feishu.cn`
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-bitable-multitenant.ts','utf8');if(!c.includes('FEISHU_API_BASE'))process.exit(1)"`

- [ ] [ARTIFACT] feishu-token.ts 用 `process.env.FEISHU_API_BASE` 而非硬编码
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-token.ts','utf8');if(!c.includes('FEISHU_API_BASE'))process.exit(1)"`

- [ ] [ARTIFACT] `apps/api/.env.example` 含 FEISHU_API_BASE 条目（注释 CI 改 localhost:3099）
  Test: `bash -c "grep -q 'FEISHU_API_BASE' apps/api/.env.example && grep -q 'localhost:3099' apps/api/.env.example"`

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/feishu-bitable-mt.test.ts` + `tests/ws3/lead-config.test.ts`，覆盖：
- `provisionBitable(tenantId)` 调飞书 createBitable + 3 次 createTable（用 nock stub）→ 写回 4 个 ID
- 3 次 createTable 的字段定义匹配 PRD schema（获客画像 3 字段 / 对标视频 3 字段 / Lead 名单 5 字段）
- `provisionBitable` 在已绑定时直接返回缓存 ID，不重复建（幂等）
- `fetchLeadConfig(tenantId)` 调飞书 list records 返回结构化 `{profile, target_videos[]}`
- `GET /api/lead-config/:tenantId` 200 + JSON `success/data/timestamp` + 数据值匹配
- `GET /api/lead-config/:tenantId` 当 tenant 未绑飞书 → 400 `FEISHU_NOT_BOUND`
- `POST /api/feishu/oauth/start` 当 missing `app_id` → 400
- `GET /api/feishu/oauth/callback` 当 state 验签失败 → 400 `INVALID_STATE`
- `GET /api/feishu/oauth/callback` 成功后串行调 token 入库 → provisionBitable，事务化或失败回滚
