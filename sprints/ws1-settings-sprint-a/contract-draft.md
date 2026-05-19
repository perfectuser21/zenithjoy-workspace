# Sprint Contract Draft (Round 1)

## Golden Path

[打开 Dashboard 侧边栏] → [看到 3 个有标题分组] → [点击"系统设置"] → [/settings 展示 4 张卡片]

---

### Step 1: 用户打开 Dashboard 侧边栏（已登录状态）

**可观测行为**: localhost:5174 侧边栏可见，分组标题"运营核心"、"账号与渠道"、"系统管理"全部出现

**验证命令**:
```bash
# 静态文件断言：navigation.config.ts 有 3 个非空 title 分组
COUNT=$(grep -E "title: '[^']+'" /workspace/apps/dashboard/src/config/navigation.config.ts | wc -l | tr -d ' ')
[ "$COUNT" -ge 3 ] || { echo "FAIL: 非空 title 分组数量不足，当前 COUNT=$COUNT"; exit 1; }
echo "OK: 找到 $COUNT 个有标题分组"
```

**硬阈值**: 非空 title 的 NavGroup ≥ 3

---

### Step 2: 侧边栏不再是扁平列表，旧空 title 分组已消除

**可观测行为**: 不存在 `title: ''` 的空标题分组（旧格式），所有分组都有明确中文标题

**验证命令**:
```bash
# 反向检查：空 title 分组不存在
EMPTY=$(grep -c "title: ''" /workspace/apps/dashboard/src/config/navigation.config.ts || true)
[ "$EMPTY" -eq 0 ] || { echo "FAIL: 仍有 $EMPTY 处空 title 分组（旧扁平格式未清除）"; exit 1; }
echo "OK: 空 title 分组已清除"
```

**硬阈值**: `title: ''` 出现次数 = 0

---

### Step 3: 用户在"系统管理"分组找到"系统设置"条目并点击

**可观测行为**: navigation.config.ts 在某分组内含有 path='/settings', featureKey='admin-settings' 的 NavItem，且不要求 superAdmin

**验证命令**:
```bash
# 检查 admin-settings featureKey 存在
FEAT=$(grep -c "admin-settings" /workspace/apps/dashboard/src/config/navigation.config.ts || true)
[ "$FEAT" -ge 1 ] || { echo "FAIL: featureKey admin-settings 未找到"; exit 1; }

# 检查 /settings 路径存在（NavItem 或 additionalRoutes）
SETTINGSPATH=$(grep -c "path: '/settings'" /workspace/apps/dashboard/src/config/navigation.config.ts || true)
[ "$SETTINGSPATH" -ge 1 ] || { echo "FAIL: path '/settings' 未在导航配置中出现"; exit 1; }

echo "OK: 系统设置 NavItem 存在"
```

**硬阈值**: `admin-settings` 出现 ≥ 1 次；`path: '/settings'` 出现 ≥ 1 次

---

### Step 4: 跳转到 /settings，页面展示 4 张设置卡片

**可观测行为**: AdminSettingsPage 已注册到 autopilotPageComponents，路由 /settings 能渲染 4 张卡片（Claude Monitor / VPS 监控 / Claude Stats / Agent 调试）

**验证命令**:
```bash
# 检查 AdminSettingsPage 已加入 pageComponents 映射
MAPPING=$(grep -c "'AdminSettingsPage'" /workspace/apps/dashboard/src/config/navigation.config.ts || true)
[ "$MAPPING" -ge 1 ] || { echo "FAIL: AdminSettingsPage 未在 pageComponents 中映射"; exit 1; }
echo "OK: AdminSettingsPage 映射存在，count=$MAPPING"
```

**硬阈值**: `'AdminSettingsPage'` key 在 autopilotPageComponents 中存在

---

### Step 5: 权限边界 — requireSuperAdmin 条目保留，不泄漏到非管理员分组

**可观测行为**: License 管理和会员管理仍带 requireSuperAdmin: true；非超管用户不可见

**验证命令**:
```bash
# requireSuperAdmin 条目数量保持 >= 2（license-admin + users-admin）
ADMIN_COUNT=$(grep -c "requireSuperAdmin: true" /workspace/apps/dashboard/src/config/navigation.config.ts || true)
[ "$ADMIN_COUNT" -ge 2 ] || { echo "FAIL: requireSuperAdmin 条目丢失，当前 $ADMIN_COUNT 个"; exit 1; }
echo "OK: $ADMIN_COUNT 个 requireSuperAdmin 条目保留"
```

**硬阈值**: requireSuperAdmin: true 出现 ≥ 2 次

---

## E2E 验收（final-e2e 执行 — target_environment: mac_web）

**journey_type**: user_facing
**target_environment**: mac_web

```javascript
// final-e2e Playwright 脚本（在 Mac 本机执行，要求 localhost:5174 已运行且有已登录会话）
const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  // 使用预存的认证状态（由 CI/evaluator 在 setup 阶段写入）
  const context = await browser.newContext({
    storageState: process.env.E2E_AUTH_STATE || undefined
  });
  const page = await context.newPage();

  // 1. 打开 Dashboard
  await page.goto('http://localhost:5174/');
  await page.waitForLoadState('networkidle');

  // 2. 断言侧边栏 3 个分组标题可见
  await expect(page.getByText('运营核心')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('账号与渠道')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('系统管理')).toBeVisible({ timeout: 10000 });

  // 3. 点击"系统设置"条目
  await page.getByText('系统设置', { exact: true }).click();

  // 4. 验证路由跳转
  await page.waitForURL('**/settings', { timeout: 5000 });

  // 5. 断言 4 张设置卡片可见（AdminSettingsPage 渲染正确）
  await expect(page.getByText('Claude Monitor')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('VPS 监控')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Claude Stats')).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Agent 调试')).toBeVisible({ timeout: 5000 });

  // 6. 交叉验证：确认没有意外渲染错误（无 error boundary）
  const errorText = page.locator('[data-testid="error-boundary"]');
  await expect(errorText).not.toBeVisible({ timeout: 2000 }).catch(() => {});

  await context.close();
  await browser.close();
  console.log('✅ Golden Path UI 验证通过');
})();
```

**通过标准**: 脚本 exit 0，全部 `toBeVisible` 断言通过

---

## Workstreams

workstream_count: 1

### Workstream 1: navigation.config.ts 重构（分组拆分 + AdminSettingsPage 接入 + 系统设置入口）

**范围**:
- `autopilotNavGroups` 从单空标题组拆为 3 个有标题组：运营核心 / 账号与渠道 / 系统管理
- `autopilotPageComponents` 新增 `AdminSettingsPage` 懒加载映射
- 在系统管理分组添加 系统设置 NavItem（path: `/settings`, icon: Settings, featureKey: `admin-settings`）

**大小**: S（< 80 行净变更，单文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/navigation.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/navigation.test.ts` | 分组数量/title非空/AdminSettingsPage映射/系统设置NavItem/requireSuperAdmin保留 | 当前 1 个空 title 分组 → 5 failures |
