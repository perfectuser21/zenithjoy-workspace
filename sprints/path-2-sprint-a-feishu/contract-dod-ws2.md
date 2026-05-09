---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: feishu-token.ts 服务

**范围**: `apps/api/src/services/feishu-token.ts`：OAuth flow + token 自动刷新
**大小**: M
**依赖**: WS1

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/services/feishu-token.ts` 文件存在
  Test: `node -e "require('fs').statSync('apps/api/src/services/feishu-token.ts')"`

- [ ] [ARTIFACT] 文件导出 3 个核心函数 `getAuthorizeUrl` / `handleCallback` / `getValidToken`
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-token.ts','utf8');['export async function getAuthorizeUrl','export async function handleCallback','export async function getValidToken'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`

- [ ] [ARTIFACT] 文件含飞书 OAuth 端点常量 `https://open.feishu.cn/open-apis/authen/v1/`
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-token.ts','utf8');if(!c.includes('open.feishu.cn/open-apis/authen'))process.exit(1)"`

- [ ] [ARTIFACT] 文件不引用全局 `FEISHU_APP_ID` env（多租户模式从 tenants 表取）
  Test: `node -e "const c=require('fs').readFileSync('apps/api/src/services/feishu-token.ts','utf8');if(/process\.env\.FEISHU_APP_ID/.test(c))process.exit(1)"`

## BEHAVIOR 索引（实际测试在 tests/ws2/）

见 `tests/ws2/feishu-token.test.ts`，覆盖：
- `getAuthorizeUrl(tenantId, appId)` 返回 `https://*.feishu.cn/...authorize?...&state=<signed>`
- `state` 签名内含 tenant_id 且可被 callback 验签反解
- `handleCallback(code, state)` 调飞书 token 端点（用 nock/MSW stub）→ 写 `tenant_feishu_bindings`
- `getValidToken(tenantId)`：当 `expires_at < NOW + 5min` 自动用 `app_id`/`app_secret` 换新 token，更新 `last_refreshed_at`
- `getValidToken` 当 token 仍有效时不发起刷新（time-windowed 断言：`last_refreshed_at` 不变）
- 错误路径：`app_id` 错 → 抛带飞书原始错误码的 Error
