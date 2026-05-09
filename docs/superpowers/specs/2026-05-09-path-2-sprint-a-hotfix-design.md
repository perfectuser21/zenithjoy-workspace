# Path 2 Sprint A Hotfix — 设计 spec

**日期**：2026-05-09
**性质**：Hotfix（已 deploy 的 PR #267 lead 自验暴露真 bug，必须修才能交付）
**作者**：Claude Code (mac mini, hotfix dev session)

---

## 背景与必要性

PR #267 (Sprint A 飞书集成) 已合并 main + 部署生产 (autopilot.zenjoymedia.media)。Lead 自验自动化跑（mac → ssh rog → Edge headless Playwright）暴露 4 个真问题，前 3 个让 Path 2 Step 3+4 在生产环境根本不能用，第 4 个让侧边菜单看不到「绑飞书」。

CI mock smoke 抓不到这 4 个问题（fake-feishu-server 绕过了真 dashboard 表单 + 跨层契约校验）。这正是 walking-skeleton-1 22 bug 教训为什么强制 Lead 真客户机自验 — 第 6 类「客户体验缺失」+ 第 2 类「跨层契约 mismatch」+ 第 1 类「DB schema 与代码不同步」。

## 要修的 4 个问题（lead 自验真证据）

### Bug 1 — 跨层契约 mismatch
- **现象**：前端 `POST /api/feishu/oauth/start` 没传 `X-Tenant-Id` header，后端验证失败返 `400 {"code":"TENANT_ID_REQUIRED"}`
- **根因**：generator 写后端时假定客户端传 X-Tenant-Id header，但前端 dashboard 同期假定后端从 better-auth session 自动 resolve（FeishuBindTenant.tsx 注释 `// tenantId 实际从 session 取，这里走 self`）。两端假定不一致，PR review 没抓到
- **影响**：客户点「开始绑定」按钮，请求始终 400，无法启动 OAuth flow

### Bug 2 — 客户体验缺失
- **现象**：oauth/start 失败后页面无任何反应（没跳转、没 error 提示）
- **根因**：FeishuBindTenant.tsx onSubmit 有 `setLeadConfigError(j?.error?.code)`，但页面**没在 form 上方渲染** leadConfigError state。错误被吞
- **影响**：客户感知是"按钮坏了/无反应"，不知道实际是 400 错误，无法自助 debug

### Bug 3 — 跨层契约 mismatch（缺 endpoint）
- **现象**：dashboard FeishuBindTenant 在 mount 时 `fetch('/api/feishu/oauth/status')` → `404 Route not found`
- **根因**：generator 实现了 POST /start + GET /callback，但**漏了 GET /status**（前端在 useEffect 里调用拿"是否已绑定"状态）
- **影响**：每次进入 dashboard 该页面都报 404，前端 fallback 到"未绑定" UI（实际行为正确但 console error 噪音 + 已绑定客户也显示未绑表单）

### Bug 4 — Dashboard feature flag 漏配
- **现象**：侧边菜单看不到「绑飞书」入口，必须用 URL 直接访问 `/dashboard/feishu-bind` 才能进
- **根因**：`apps/dashboard/src/contexts/InstanceContext.tsx` autopilotConfig.features 列了所有启用的 feature flags（含 ws1-* 等），但 generator **漏了 `'feishuBind': true`**。DynamicSidebar 用 `isFeatureEnabled(featureKey)` 过滤菜单，false 就不显示
- **影响**：客户找不到入口（除非有人告诉他直接输 URL）

---

## 设计

### Fix 1 — backend feishu-oauth router 用 tenantContext middleware

`apps/api/src/routes/feishu-oauth.ts`：

```ts
import { tenantContext } from '../middleware/tenant-context';

router.post('/start', tenantContext, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;  // tenantContext middleware 已 resolve
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TENANT_CONTEXT', message: '当前用户未关联 tenant，请重新登录' },
      timestamp: new Date().toISOString(),
    });
  }
  // ... 其余逻辑不变（验 app_id/secret + ALREADY_BOUND 检查 + UPDATE tenants + 构造 authorize_url）
});
```

`tenantContext` middleware（`apps/api/src/middleware/tenant-context.ts`）已存在，从 better-auth session 拿 user_id → query `tenant_members` 表 → 挂 `req.tenantId`。`credits.ts` / `tenants.ts` 都用这套，feishu-oauth 漏用。

### Fix 2 — frontend FeishuBindTenant 加 leadConfigError 渲染

`apps/dashboard/src/pages/FeishuBindTenant.tsx`，在 form 上方（约 line 175 `{urlError && ...}` 同位置）加：

```tsx
{leadConfigError && (
  <div style={{
    padding: 12,
    background: '#fee',
    color: '#c00',
    borderRadius: 6,
    marginBottom: 12,
    border: '1px solid #fcc'
  }}>
    <strong>绑定失败：</strong> {ERROR_CN[leadConfigError] || leadConfigError}
  </div>
)}
```

ERROR_CN 加 3 条新文案：
```ts
START_FAILED: '飞书 OAuth 启动失败，请刷新重试。',
TENANT_ID_REQUIRED: '当前用户未关联租户，请重新登录或联系管理员。',
MISSING_FIELDS: '请填写完整的 App ID 和 App Secret。',
NO_TENANT_CONTEXT: '当前用户未关联租户，请重新登录或联系管理员。',
```

### Fix 3 — backend 加 GET /api/feishu/oauth/status endpoint

`apps/api/src/routes/feishu-oauth.ts` 在 `router.post('/start', ...)` 之前加：

```ts
router.get('/status', tenantContext, async (req: Request, res: Response) => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    return res.status(401).json({
      success: false,
      error: { code: 'NO_TENANT_CONTEXT', message: '当前用户未关联 tenant' },
      timestamp: new Date().toISOString(),
    });
  }
  try {
    const r = await pool.query(
      `SELECT
         (b.app_token IS NOT NULL) AS bound,
         b.app_token, b.bound_at, b.needs_retry,
         b.table_id_lead_profile, b.table_id_target_videos, b.table_id_leads
       FROM zenithjoy.tenants t
       LEFT JOIN zenithjoy.tenant_feishu_bindings b ON b.tenant_id = t.id
      WHERE t.id = $1`,
      [tenantId]
    );
    if (!r.rows[0]) {
      return res.status(404).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: `tenant ${tenantId} 不存在` },
        timestamp: new Date().toISOString(),
      });
    }
    const row = r.rows[0];
    return res.json({
      success: true,
      data: {
        bound: !!row.bound,
        app_token: row.app_token || null,
        bound_at: row.bound_at || null,
        needs_retry: !!row.needs_retry,
        bitable_doc_url: row.app_token ? `https://feishu.cn/base/${row.app_token}` : null,
        table_ids: {
          lead_profile: row.table_id_lead_profile || null,
          target_videos: row.table_id_target_videos || null,
          leads: row.table_id_leads || null,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[feishu-oauth] /status query failed', err);
    return res.status(500).json({
      success: false,
      error: { code: 'STATUS_QUERY_FAILED', message: '查询绑定状态失败' },
      timestamp: new Date().toISOString(),
    });
  }
});
```

### Fix 4 — InstanceContext 加 'feishuBind': true

`apps/dashboard/src/contexts/InstanceContext.tsx` autopilotConfig.features 对象加一行（紧跟 ws1-* features 之后）：

```ts
// Path 2 Sprint A — 客户智能获客路径（飞书集成）
'feishuBind': true,          // /dashboard/feishu-bind
```

---

## 测试策略

按 Cecelia 测试金字塔四档分类：

- **Unit (E2E gate 之前)**：backend 加 `apps/api/src/routes/feishu-oauth.test.ts` 覆盖新 GET /status endpoint 三个 case：
  - bound=true（有 binding row 含 app_token）
  - bound=false（tenant 存在但无 binding row）
  - tenant_not_found（tenantId 不存在 → 404）
  - 测试用 mock pool（pg mock，不连真 DB）

- **Integration**：不加新（CI L4 用 fake-feishu-server 跑 golden-path-2-smoke.sh，含 POST /start，覆盖 tenantContext middleware 链路；GET /status 由 unit 覆盖足够，integration 不重复加）

- **E2E**：不加新文件（lead 自验自动化脚本 mac → ssh rog → Edge headless Playwright 是真 E2E。hotfix merge + redeploy 后重跑此脚本验证全链路通到 OAuth 物理瓶颈）

- **Smoke**：不加新 smoke.sh（golden-path-2-smoke.sh 已存在，hotfix 不改 smoke 范围）

## 影响文件清单

```
新增：
  apps/api/src/routes/feishu-oauth.test.ts            (~80 行 unit test)
  docs/superpowers/specs/2026-05-09-path-2-sprint-a-hotfix-design.md  (本文件)

改造：
  apps/api/src/routes/feishu-oauth.ts                  (+~25 行 GET /status, +tenantContext import 用法)
  apps/dashboard/src/pages/FeishuBindTenant.tsx        (+~12 行 error 渲染 + ERROR_CN 4 条新文案)
  apps/dashboard/src/contexts/InstanceContext.tsx      (+~2 行 feishuBind: true 注释)

合计：5 文件，~120 行（含测试）
```

## DoD（合格门槛）

1. ✅ 4 个 fix 实施
2. ✅ backend feishu-oauth.test.ts 新 unit test 全过
3. ✅ apps/api `npm run build` clean，`npm test` 全过
4. ✅ apps/dashboard `npm run build` clean，`npm test` 全过
5. ✅ ESLint 无 error
6. ✅ TDD lint：commit-1 测试 RED → commit-2 实现 GREEN
7. ✅ PR + CI 35/35 全绿 + merge
8. ✅ Redeploy：apps/api rebuild + restart launchd `com.zenithjoy.api`；apps/dashboard rebuild + rsync hk
9. ✅ Lead 自验自动化重跑：mac → ssh rog → Playwright self-test → 全程通到 OAuth 二维码点（不真扫，物理瓶颈）→ 真 evidence 写到 `.agent-knowledge/path-2/lead-acceptance-sprint-a.md` 替换占位骨架
10. ✅ 真证据含：6 张关键截图（home / signup / dashboard / 表单 / 错误显示验证 / OAuth 二维码页）+ 真时间戳 + console / network log 摘要

## 风险与缓解

- **风险**：`tenantContext` middleware 实现假定 user 必有 tenant_member row。如果 better-auth sign-up hook (`bridgeNewUserToTenant`) 失败导致用户无 tenant，oauth/start 会返 401 NO_TENANT_CONTEXT — 这是预期行为（提示客户重登），不是 bug。
- **风险**：自动 `'feishuBind': true` 启用后所有客户侧边菜单都显示「绑飞书」，包括没付费的 free tier。**接受**：thin 阶段不分 tier，所有客户都能看到入口。加厚到 medium 时再按 tier gate。

## 不在范围

- 不动 PR #267 的合同 / RED tests / contract DoD（hotfix 不改 SSOT，只补遗漏）
- 不动 PR #267 的 fake-feishu-server / smoke.sh（hotfix 不改 CI 范围）
- 不修复 Lead 自验自动化基础设施（dispatcher / 多机池 — 那是另一个独立 sprint，已有 design proposal `lead-acceptance-automation-proposal.md`）
- 不修复 Agent 下载 404（不是本 sprint 范围 — 是 sprint 2.1e agent install pack 历史问题）
- 不动 InstanceContext 其他 feature flags
