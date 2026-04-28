# Contract DoD — Workstream 2: Dashboard /license 客户面板

**范围**: apps/dashboard 新建 LicensePage 组件 + license API client + navigation 配置
**大小**: M
**依赖**: Workstream 1（API 端点）

## ARTIFACT 条目

- [ ] [ARTIFACT] LicensePage 组件文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/LicensePage.tsx')"

- [ ] [ARTIFACT] LicensePage 默认导出 React 组件
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LicensePage.tsx','utf8');if(!/export\s+default\s+function\s+LicensePage|export\s+default\s+LicensePage/.test(c))process.exit(1)"

- [ ] [ARTIFACT] license.api.ts 文件存在并 export fetchMyLicense
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/api/license.api.ts','utf8');if(!/export\s+(async\s+)?function\s+fetchMyLicense|export\s+const\s+fetchMyLicense/.test(c))process.exit(1)"

- [ ] [ARTIFACT] navigation.config.ts 含 /license 路径
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!/['\"]\/license['\"]/.test(c))process.exit(1)"

- [ ] [ARTIFACT] LicensePage 内含"暂无 License"文案
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LicensePage.tsx','utf8');if(!/暂无\s*License|暂无 License/.test(c))process.exit(1)"

- [ ] [ARTIFACT] LicensePage 内含"申请续费"按钮文案
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LicensePage.tsx','utf8');if(!/申请续费/.test(c))process.exit(1)"

## BEHAVIOR 索引（实际测试在 apps/dashboard/src/pages/__tests__/LicensePage.test.tsx）

见 `apps/dashboard/src/pages/__tests__/LicensePage.test.tsx`，覆盖：
- LicensePage 在 license=null 时渲染 "暂无 License" 文案
- LicensePage 在 license 存在时渲染 tier 文案
- LicensePage 在 license 存在时渲染机器列表行（hostname）
- LicensePage 点击 "申请续费" 按钮打开包含微信号的对话框
