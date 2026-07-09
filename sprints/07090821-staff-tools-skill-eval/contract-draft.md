# Contract Draft：ZenithJoy 员工工具中心 + Skill Evaluator 上传页接入

sprint_dir: sprints/07090821-staff-tools-skill-eval
task_id: 23b96c28-cf91-4657-bd26-46cd33837f16
date: 2026-07-09

---

## 背景

ZenithJoy Dashboard 当前只有 `isSuperAdmin` 一个特权档位。运营侧需要引入面向员工的内部工具入口，但客户完全无感。本 sprint 新增 `isStaff` 权限档位（邮箱白名单 env var 驱动），在侧边栏建立「员工工具」可扩展分组，并将 Skill Evaluator（技能评测上传页）作为第一个入驻工具，提供 zip 上传 → 异步评测 → 报告展示的完整链路。后端通过 `staffGuard` 中间件双重保护，前端通过路由守卫确保非白名单账号无法访问任何 staff 路由。

---

## 交付范围

### 权限层（FR1、FR2）
- 新增 `VITE_STAFF_EMAILS`（前端）/ `STAFF_EMAILS`（后端）环境变量，逗号分隔白名单邮箱
- `AuthContext` 新增 `isStaff: boolean`，与 `isSuperAdmin` 对称，独立判断（staff 不自动含 superAdmin）
- `STAFF_EMAILS` 未配置时 `staffGuard` 默认 403，不放行

### 导航层（FR3、FR4、FR5）
- `NavItem` 类型新增 `requireStaff?: boolean` 字段
- `filterNavGroups` 函数接受 `isStaff` 参数，过滤掉 staff 专属分组
- `DynamicSidebar` 把 `isStaff` 传入 `filterNavGroups`
- `autopilotNavGroups` 新增「员工工具」分组（`requireStaff: true`），含子条目「Skill 评测上传」（路径 `/staff/skill-eval`）

### 路由保护层（FR6、FR7）
- `additionalRoutes` / `App.tsx` 新增 `/staff/skill-eval` 路由，标记 `requireStaff: true`
- `App.tsx` Route 守卫：`requireStaff` 路由非 staff 账号访问 → 重定向回 `/`

### 前端页面（FR8）
- 新建 `SkillEvalPage.tsx`（参考 `VideoRemakePipelinePage` 模式）
  - 文件上传区域（接受 `.zip`）
  - 点击上传 → POST `/api/staff/skill-eval/upload` → 获取 `job_id`
  - 轮询 GET `/api/staff/skill-eval/status/:jobId`（每 3s，超 60s 展示「评测服务暂不可用」）
  - 状态 `completed` → 展示评测报告（分数 + 详情）
  - 上传失败 / 504 超时 → 展示友好错误，不永久转圈

### 后端中间件与代理（FR9、FR10、FR11）
- 新建 `apps/api/src/middleware/staff.ts`：`staffGuard` 检查 `X-User-Email` 头是否在 `STAFF_EMAILS` 白名单，不在 → 403
- 新建 `apps/api/src/routes/staff.ts`：
  - `POST /api/staff/skill-eval/upload`（受 staffGuard 保护，转发到 HK 反代 9100 端口，超时 30s）
  - `GET /api/staff/skill-eval/status/:jobId`（受 staffGuard 保护，轮询转发）
- `apps/api/src/app.ts` 注册 staff router

### 测试与 CI（FR12、FR13）
- 新建 `apps/dashboard/e2e/staff-skill-eval.spec.ts`（Playwright）
- 新建 `.github/workflows/scripts/smoke/staff-skill-eval-smoke.sh`（curl API smoke）
- `.github/workflows/scripts/smoke-baseline.txt` 追加棘轮条目

---

## E2E 验收

### 场景 1：staff 账号能看到员工工具侧边栏分组

**Playwright spec**（`apps/dashboard/e2e/staff-skill-eval.spec.ts`）：

```typescript
test('staff 账号登录后侧边栏出现「员工工具」分组', async ({ page }) => {
  // 使用 STAFF_TEST_EMAIL（在白名单中）登录
  await loginAs(page, process.env.STAFF_TEST_EMAIL);
  await expect(page.locator('text=员工工具')).toBeVisible();
  await expect(page.locator('text=Skill 评测上传')).toBeVisible();
});
```

### 场景 2：staff 账号能访问 /staff/skill-eval 页面（有上传区域）

**Playwright spec**：

```typescript
test('staff 账号能访问 /staff/skill-eval 且页面有上传区域', async ({ page }) => {
  await loginAs(page, process.env.STAFF_TEST_EMAIL);
  await page.goto('/staff/skill-eval');
  await expect(page).not.toHaveURL('/');
  // 页面存在文件上传区域
  await expect(page.locator('input[type="file"]')).toBeVisible();
});
```

### 场景 3：非 staff 账号访问 /staff/skill-eval 被重定向

**Playwright spec**：

```typescript
test('非 staff 账号访问 /staff/skill-eval 被重定向回 /', async ({ page }) => {
  await loginAs(page, process.env.NON_STAFF_TEST_EMAIL);
  await page.goto('/staff/skill-eval');
  await expect(page).toHaveURL('/');
  await expect(page.locator('text=员工工具')).not.toBeVisible();
});
```

### 场景 4：curl POST /api/staff/skill-eval/upload 不带 staff 头返回 403

**Smoke shell**（`.github/workflows/scripts/smoke/staff-skill-eval-smoke.sh`）：

```bash
# 不带认证头 → 403
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${API_BASE}/api/staff/skill-eval/upload")
[ "$STATUS" = "403" ] || (echo "FAIL: expected 403, got $STATUS" && exit 1)

# 不带认证头 GET status → 403
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  "${API_BASE}/api/staff/skill-eval/status/test-job-id")
[ "$STATUS" = "403" ] || (echo "FAIL: expected 403, got $STATUS" && exit 1)

echo "PASS: staff endpoints return 403 without auth header"
```

---

## 不包含

- 按工具细粒度的权限矩阵（未来可按需在 `requireStaff` 基础上扩展）
- 员工工具 UI 设计规范体系
- 员工白名单具体邮箱（env var 占位，用户自行配置）
- Skill Evaluator 后端评测服务本身（本 sprint 只接入代理转发到 HK 9100 端口）
- 多文件批量上传
- 评测历史记录页
