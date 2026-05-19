# Sprint Contract Draft (Round 1)

## Golden Path

[用户打开 Dashboard] → [侧边栏渲染3分组] → [点击"设置"] → [/settings 页面] → [卡片式设置入口]

---

### Step 1: 侧边栏显示 3 个分组标题

**可观测行为**: 展开侧边栏时，顶部到底部依次显示"核心功能"/"账号绑定"/"系统"三个分组标题（折叠时标题隐藏，分组间显示分隔线）

**验证命令**:
```bash
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');
  ['核心功能','账号绑定','系统'].forEach(t => {
    if (!s.includes(t)) { console.error('FAIL: 缺分组',t); process.exit(1); }
  });
  console.log('OK');
"
```

**硬阈值**: 3个分组标题全部出现在 autopilotNavGroups 导出值中

---

### Step 2: "系统"分组包含 /settings 入口，/license 和 /admin/* 移出主导航

**可观测行为**: 侧边栏"系统"分组出现"设置"菜单项；"License"/"License 管理"/"会员管理"不再直接出现在侧边栏任意分组

**验证命令**:
```bash
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');
  // 取 additionalRoutes 声明前的部分（即 autopilotNavGroups）
  const navBlock = s.split('export const additionalRoutes')[0];
  if (!navBlock.includes(\"path: '/settings'\")) { console.error('FAIL: /settings 未加入导航'); process.exit(1); }
  if (navBlock.includes(\"path: '/license'\")) { console.error('FAIL: /license 仍在主导航'); process.exit(1); }
  if (navBlock.includes(\"path: '/admin/license'\")) { console.error('FAIL: /admin/license 仍在主导航'); process.exit(1); }
  if (navBlock.includes(\"path: '/admin/users'\")) { console.error('FAIL: /admin/users 仍在主导航'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: /settings 存在于主导航；/license /admin/license /admin/users 不在主导航

---

### Step 3: InstanceContext 注册 'settings' feature flag

**可观测行为**: autopilotConfig.features 含 `'settings': true`，使 /settings 菜单项通过 filterNavGroups 过滤

**验证命令**:
```bash
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/contexts/InstanceContext.tsx','utf8');
  if (!s.includes(\"'settings': true\")) { console.error('FAIL: settings feature flag 未注册'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: 'settings': true 出现在 autopilotConfig.features 对象中

---

### Step 4: 点击"设置"导航到 /settings，SettingsPage 正常渲染

**可观测行为**: 侧边栏"设置"链接点击后，URL 变为 /settings，页面展示卡片式布局而非 404

**验证命令** (Playwright — 需 dev server 运行在 localhost:5173):
```bash
cd apps/dashboard && \
VITE_SKIP_AUTH=true npx vite --port 5173 &
DEV_PID=$! && sleep 10 && \
npx playwright test e2e/settings-sidebar.spec.ts --reporter=line; \
RESULT=$?; kill $DEV_PID 2>/dev/null; exit $RESULT
```

**硬阈值**: Playwright exit 0，所有 test case 通过

---

### Step 5: /settings 显示 License 卡片；super admin 额外见管理员专区卡片

**可观测行为**: 普通用户在 /settings 看到 License 卡片（链接 /license）；管理员专区卡片仅 isSuperAdmin=true 时渲染

**验证命令**:
```bash
node -e "
  const s = require('fs').readFileSync('apps/dashboard/src/pages/SettingsPage.tsx','utf8');
  if (!s.includes('to=\"/license\"')) { console.error('FAIL: License 卡片链接缺失'); process.exit(1); }
  if (!s.includes('isSuperAdmin')) { console.error('FAIL: isSuperAdmin 条件渲染缺失'); process.exit(1); }
  console.log('OK');
"
```

**硬阈值**: License 卡片存在，管理员专区受 isSuperAdmin 条件控制

---

## E2E 验收（final-e2e — target_environment: mac_web）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// apps/dashboard/e2e/settings-sidebar.spec.ts
// 运行：
//   1. VITE_SKIP_AUTH=true npm run dev:dashboard  （另一终端，port 5173）
//   2. npx playwright test e2e/settings-sidebar.spec.ts
import { test, expect } from '@playwright/test';

test.describe('WS1 侧边栏分组 + 统一设置入口', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('侧边栏展示"核心功能"/"账号绑定"/"系统"三个分组标题', async ({ page }) => {
    await expect(page.getByText('核心功能')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('账号绑定')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('系统')).toBeVisible({ timeout: 5000 });
  });

  test('点击"设置"菜单项导航到 /settings', async ({ page }) => {
    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
  });

  test('/settings 页面显示 License 卡片', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('License')).toBeVisible({ timeout: 5000 });
  });

  test('非 super admin 不显示管理员专区卡片', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // VITE_SKIP_AUTH 模式下无 feishu_user_id，isSuperAdmin = false
    await expect(page.getByText('管理员专区')).not.toBeVisible();
  });
});
```

**通过标准**: exit 0，4 个 test 全部通过

---

## Workstreams

workstream_count: 2

### Workstream 1: navigation.config.ts 拆3组 + InstanceContext feature 注册

**范围**: 将 `autopilotNavGroups` 单组改为3个有标题的分组（核心功能/账号绑定/系统）；把 /license /admin/license /admin/users 移出主导航 items（放入 additionalRoutes 供路由注册，不在侧边栏显示）；在"系统"组新增 `/settings` NavItem；在 `autopilotPageComponents` 注册 `SettingsPage`；在 `autopilotConfig.features` 添加 `'settings': true`

**大小**: S（净变更 < 80 行，2 文件）
**依赖**: 无（TDD Red commit 先行）

**预期受影响文件**:
- `apps/dashboard/src/config/navigation.config.ts`（主要重构）
- `apps/dashboard/src/contexts/InstanceContext.tsx`（+1 行 feature flag）

---

### Workstream 2: SettingsPage.tsx 新建

**范围**: 新建 `apps/dashboard/src/pages/SettingsPage.tsx`，卡片式布局：License 卡片（Link to="/license"）+ 管理员专区卡片（仅 `isSuperAdmin` 时渲染，link 到 /admin/license 或 AdminSettingsPage）；卡片风格同 AdminSettingsPage.tsx

**大小**: S（净增 ~80 行，1 文件）
**依赖**: Workstream 1 完成后（pageComponents 需已注册 'SettingsPage'）

**预期受影响文件**:
- `apps/dashboard/src/pages/SettingsPage.tsx`（新建）

---

## Workstreams 切分自查（v7.7）

- WS1: 2 文件，净变更 ~80 行 → ≤3 文件 ✓，≤200 行 ✓
- WS2: 1 文件，净增 ~80 行 → ≤3 文件 ✓，≤200 行 ✓
- 总净增 ~300 行（含 E2E spec + vitest tests）> 200 行 → ws_count=1 不允许，ws_count=2 ✓

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/nav-groups.test.ts` | 3分组结构 / /settings 存在 / /license 不在主导航 | 5 failures（navGroups 当前1组） |
| WS2 | `tests/ws2/settings-page.test.ts` | SettingsPage default export / License link / isSuperAdmin | import Error（文件不存在） |
| Final E2E | `apps/dashboard/e2e/settings-sidebar.spec.ts` | 侧边栏3分组 / 导航 /settings / License卡片 / 管理员专区权限 | 4 failures（当前无分组标题） |
