## ZenithJoy Dashboard E2E — Playwright Phase 3（2026-05-02）

### 根本原因

Dashboard 完全没有 E2E 测试覆盖，5 条核心用户旅程（导航/作品/AI视频/认证/管理后台）裸奔在 CI 之外。单元测试覆盖不到"浏览器渲染 + 路由跳转 + mock API 交互"这类跨组件行为，回归时靠肉眼。

### 方案

- `VITE_SKIP_AUTH=true` 跳过登录，直接使用 mock 用户（AuthContext 已支持）
- `page.route()` 拦截所有 `/api/**` 请求返回静态 mock 数据，不依赖真实后端
- Playwright CI 通过 `webServer` 自动起 Vite dev（port 3001），本地可手动跑
- `workers: 1 + fullyParallel: false` — 避免多 worker 竞争同一 Vite dev server

### 下次预防

- [ ] 新增 Dashboard 功能页时，同时在 `e2e/` 下新建对应 `*.e2e.ts`，并注册进 `test-registry.yaml`
- [ ] `setupMockApi()` fixture 是统一入口，新接口的 mock 只加这一处
- [ ] CI 触发条件已限定 `apps/dashboard/**` 路径变更，避免无关 PR 跑全量 Playwright
- [ ] `page.route()` 顺序敏感：精确路径必须在通配 `/api/**` 之前注册，否则被 catch-all 吞掉
- [ ] `auth.e2e.ts` 测试认证页面时不调 `setupMockApi()`，保持公开路由不被拦截
