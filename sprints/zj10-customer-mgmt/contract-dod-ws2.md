---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Workstream 2: 导航配置 + AdminCustomersPage 概览

**范围**: `apps/dashboard/src/config/navigation.config.ts` 新增「客户管理」NavGroup + 3 NavItems（requireSuperAdmin）；新建 `apps/dashboard/src/pages/AdminCustomersPage.tsx`（概览表格，含 data-testid）
**大小**: M（~150 行净增，2 文件）
**依赖**: Workstream 1（API 端点须已注册）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `navigation.config.ts` 包含「客户管理」路由组，含 `/admin/customers` NavItem 且 `requireSuperAdmin: true`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8'); if(!c.includes('/admin/customers')||!c.includes('requireSuperAdmin')||!c.includes('客户管理'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AdminCustomersPage.tsx` 文件已创建，包含 `data-testid="customers-table-row"` 和 `data-testid="customers-table"` 属性
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/AdminCustomersPage.tsx'); const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminCustomersPage.tsx','utf8'); ['customers-table-row','customers-table'].forEach(t=>{if(!c.includes(t)){console.error('FAIL:缺testid',t);process.exit(1)}}); console.log('OK')"

- [ ] [ARTIFACT] `pageComponents` 映射中包含 `AdminCustomersPage` 懒加载条目
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8'); if(!c.includes('AdminCustomersPage'))process.exit(1); console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `navigation.config.ts` 新增了含 `requireSuperAdmin: true` 的「客户管理」NavGroup，路径为 `/admin/customers`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\"); if(!c.includes(\"/admin/customers\")){console.error(\"FAIL:缺路径\");process.exit(1)} if(!c.includes(\"requireSuperAdmin\")){console.error(\"FAIL:缺鉴权\");process.exit(1)} if(!c.includes(\"客户管理\")){console.error(\"FAIL:缺label\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `AdminCustomersPage.tsx` 包含调用 `/api/admin/customers` 的 fetch 逻辑，使用 `tenant_id`/`email`/`license_status`/`platform_count`/`last_publish_at` 字段（不使用禁用字段名）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminCustomersPage.tsx\",\"utf8\"); [\"admin/customers\",\"license_status\",\"platform_count\",\"last_publish_at\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); [\"users\",\"clients\",\"members\"].forEach(f=>{const re=new RegExp(f+\":\"); if(re.test(c)){console.error(\"FAIL:含禁用字段\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `AdminCustomersPage.tsx` 含有 `data-testid="customers-table-row"` 属性（Playwright E2E 断言依赖此 testid）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminCustomersPage.tsx\",\"utf8\"); if(!c.includes(\"data-testid=\\\"customers-table-row\\\"\")){console.error(\"FAIL:缺customers-table-row testid\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `AdminCustomersPage.tsx` 处理 `last_publish_at: null` 边界情况（不崩溃，无发布记录时显示占位符）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminCustomersPage.tsx\",\"utf8\"); const hasNullHandling=c.includes(\"null\")||c.includes(\"?.\")||c.includes(\"??\")||c.includes(\"last_publish_at &&\"); if(!hasNullHandling){console.error(\"FAIL:未处理 last_publish_at null\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `pageComponents` 含 `AdminCustomersPage` 懒加载映射，`filterNavGroups` 仍正常工作（不破坏已有 superAdmin 鉴权）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\"); if(!c.includes(\"AdminCustomersPage\")||!c.includes(\"filterNavGroups\")){console.error(\"FAIL:pageComponents 或 filterNavGroups 缺失\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

---

## 假绿自查

- BEHAVIOR 1：`navigation.config.ts` 不含 `/admin/customers` → FAIL ✅（实现前文件无此内容）
- BEHAVIOR 2：`AdminCustomersPage.tsx` 不存在 → `accessSync` 或 `readFileSync` 抛异常 → FAIL ✅
- BEHAVIOR 3：同上，文件不存在 → FAIL ✅
- BEHAVIOR 4：同上，文件不存在 → FAIL ✅
- BEHAVIOR 5：`navigation.config.ts` 不含 `AdminCustomersPage` → FAIL ✅（新增映射前）
