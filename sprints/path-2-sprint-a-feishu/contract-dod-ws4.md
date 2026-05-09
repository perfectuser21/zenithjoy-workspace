---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 4: Dashboard FeishuBindTenant 页 + Playwright E2E

**范围**: 新建 dashboard 客户自助绑飞书页 + 8 步 E2E spec
**大小**: M
**依赖**: WS3

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/FeishuBindTenant.tsx` 文件存在
  Test: `node -e "require('fs').statSync('apps/dashboard/src/pages/FeishuBindTenant.tsx')"`

- [ ] [ARTIFACT] `FeishuBindTenant.tsx` 含表单 input `app_id` + `app_secret` + 提交触发 `POST /api/feishu/oauth/start`
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/FeishuBindTenant.tsx','utf8');['app_id','app_secret','/api/feishu/oauth/start'].forEach(p=>{if(!c.includes(p))process.exit(1)})"`

- [ ] [ARTIFACT] `FeishuBindTenant.tsx` 含"刷新状态"按钮触发 `GET /api/lead-config/`
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/FeishuBindTenant.tsx','utf8');if(!c.includes('/api/lead-config/'))process.exit(1)"`

- [ ] [ARTIFACT] `FeishuBindTenant.tsx` 含"飞书已绑定 ✓"文案 + 渲染 Bitable 链接
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/FeishuBindTenant.tsx','utf8');if(!c.includes('飞书已绑定')||!/feishu\\.cn\\/base\\//.test(c))process.exit(1)"`

- [ ] [ARTIFACT] `apps/dashboard/src/App.tsx`（或 router）挂 `/dashboard/feishu-bind` 路由到 FeishuBindTenant
  Test: `bash -c "grep -rE \"feishu-bind|FeishuBindTenant\" apps/dashboard/src/App.tsx apps/dashboard/src/main.tsx apps/dashboard/src/router.tsx 2>/dev/null | grep -q FeishuBindTenant"`

- [ ] [ARTIFACT] `apps/dashboard/e2e/path-2-sprint-a.spec.ts` Playwright spec 文件存在
  Test: `node -e "require('fs').statSync('apps/dashboard/e2e/path-2-sprint-a.spec.ts')"`

- [ ] [ARTIFACT] Playwright spec 含 8 步全链断言（每步 1 个 toBeVisible）
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/path-2-sprint-a.spec.ts','utf8');const visibleCount=(c.match(/toBeVisible/g)||[]).length;if(visibleCount<5)process.exit(1);['step8','飞书已绑定','装修','小户型'].forEach(k=>{if(!c.includes(k))process.exit(1)})"`

## BEHAVIOR 索引（实际测试在 tests/ws4/ + apps/dashboard/e2e/）

见 `tests/ws4/feishu-bind-page.test.ts`（Vitest 组件单测）+ `apps/dashboard/e2e/path-2-sprint-a.spec.ts`（Playwright 真浏览器）：
- 组件首次渲染显示 app_id/app_secret 表单（未绑定状态）
- 提交表单触发 fetch 到 `/api/feishu/oauth/start`，成功后 `window.location.href` 跳转到 `authorize_url`
- 已绑定状态展示 Bitable 链接 + "飞书已绑定 ✓" 文案 + "刷新状态" 按钮
- 点"刷新状态"触发 fetch `/api/lead-config/:tenantId` → 渲染 profile 三字段 + 视频列表
- E2E 8 步 spec 全过：表单填写 → OAuth 跳转（stub）→ 回调成功 → 飞书表填数据（stub）→ 刷新状态 → 渲染数据
