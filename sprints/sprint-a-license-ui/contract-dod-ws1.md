# Contract DoD — Workstream 1: License 后端鉴权 + /me 端点

**范围**: apps/api 后端新增/修改 — feishu-user 中间件、super-admin 中间件、admin-license.ts /me 端点 + 守卫替换、license.service.ts getLicenseByCustomerId
**大小**: M
**依赖**: 无

## ARTIFACT 条目

- [ ] [ARTIFACT] feishu-user 中间件文件存在并导出 feishuUser
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/feishu-user.ts','utf8');if(!/export\s+function\s+feishuUser/.test(c))process.exit(1)"

- [ ] [ARTIFACT] super-admin 中间件文件存在并导出 superAdminGuard
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/super-admin.ts','utf8');if(!/export\s+function\s+superAdminGuard/.test(c))process.exit(1)"

- [ ] [ARTIFACT] license.service.ts 新增 getLicenseByCustomerId 导出
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/license.service.ts','utf8');if(!/export\s+async\s+function\s+getLicenseByCustomerId/.test(c))process.exit(1)"

- [ ] [ARTIFACT] admin-license.ts 注册 GET /me 路由
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/admin-license.ts','utf8');if(!/['\"]\/me['\"]|router\.get\(['\"]\/me/.test(c))process.exit(1)"

- [ ] [ARTIFACT] admin-license.ts 引用 superAdminGuard
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/admin-license.ts','utf8');if(!/superAdminGuard/.test(c))process.exit(1)"

- [ ] [ARTIFACT] super-admin 中间件读取 ADMIN_FEISHU_OPENIDS 环境变量
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/super-admin.ts','utf8');if(!/ADMIN_FEISHU_OPENIDS/.test(c))process.exit(1)"

- [ ] [ARTIFACT] feishu-user 中间件读取 X-Feishu-User-Id 头
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/middleware/feishu-user.ts','utf8');if(!/x-feishu-user-id/i.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 apps/api/tests/admin-license-me.test.ts）

见 `apps/api/tests/admin-license-me.test.ts`，覆盖：
- GET /api/admin/license/me 缺 X-Feishu-User-Id 返回 401
- GET /api/admin/license/me 已知 customer_id 返回 license 对象 + machines 数组
- GET /api/admin/license/me 未绑定 customer_id 返回 license=null + machines=[]
- POST /api/admin/license 非 admin 返回 403
- POST /api/admin/license admin 创建 license 返回 200 + license_key
- GET /api/admin/license admin 返回 license 列表
- DELETE /api/admin/license/:id admin 吊销 license 返回 status=revoked
