# Contract DoD — Workstream 3: Dashboard /admin/license super-admin 后台

**范围**: apps/dashboard — 新建 AdminLicensePage（创建表单 / 列表 / 吊销）+ license.api.ts 扩展 admin client 函数 + navigation 添加 super-admin only 入口
**大小**: M
**依赖**: Workstream 1（API 端点）

## ARTIFACT 条目

- [ ] [ARTIFACT] AdminLicensePage 组件文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/AdminLicensePage.tsx')"

- [ ] [ARTIFACT] AdminLicensePage 默认导出 React 组件
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminLicensePage.tsx','utf8');if(!/export\s+default\s+function\s+AdminLicensePage|export\s+default\s+AdminLicensePage/.test(c))process.exit(1)"

- [ ] [ARTIFACT] license.api.ts export listAllLicenses
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/api/license.api.ts','utf8');if(!/export\s+(async\s+)?function\s+listAllLicenses|export\s+const\s+listAllLicenses/.test(c))process.exit(1)"

- [ ] [ARTIFACT] license.api.ts export createLicense
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/api/license.api.ts','utf8');if(!/export\s+(async\s+)?function\s+createLicense|export\s+const\s+createLicense/.test(c))process.exit(1)"

- [ ] [ARTIFACT] license.api.ts export revokeLicense
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/api/license.api.ts','utf8');if(!/export\s+(async\s+)?function\s+revokeLicense|export\s+const\s+revokeLicense/.test(c))process.exit(1)"

- [ ] [ARTIFACT] navigation.config.ts 含 /admin/license 路径
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!/['\"]\/admin\/license['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] navigation.config.ts 中 /admin/license 入口标记 requireSuperAdmin
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');const m=c.match(/['\"]\/admin\/license['\"][^}]*?requireSuperAdmin\s*:\s*true/s);if(!m)process.exit(1)"

- [ ] [ARTIFACT] AdminLicensePage 含"吊销"按钮文案
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminLicensePage.tsx','utf8');if(!/吊销/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 apps/dashboard/src/pages/__tests__/AdminLicensePage.test.tsx）

见 `apps/dashboard/src/pages/__tests__/AdminLicensePage.test.tsx`，覆盖：
- AdminLicensePage super-admin 渲染创建表单 + 列表
- AdminLicensePage 非 super-admin 不渲染表单（显示 403 或重定向标识）
- AdminLicensePage 提交创建表单调用 createLicense API 一次
- AdminLicensePage 点击吊销按钮 + 确认调用 revokeLicense API 一次
