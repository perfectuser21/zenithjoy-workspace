# Path 2 Sprint A Architecture Hotfix — Implementation Plan

**Spec**: `docs/superpowers/specs/2026-05-10-path-2-sprint-a-arch-app-creds-design.md`
**Branch**: `cp-05100828-feishu-app-creds-arch`

---

## Tasks

### Task 1: TDD RED — backend 新增 `/bind` 测试 + `/rebuild` 测试

**Files**: `apps/api/src/routes/feishu-oauth.test.ts`

Add the following 5 cases (all should fail initially because `/bind` and `/rebuild` don't exist):

1. `POST /api/feishu/oauth/bind` happy path — provisionBitable 被 mock 调用 + 返回 4 ID + bitable_doc_url + 200
2. `POST /api/feishu/oauth/bind` 缺 app_id → 400 MISSING_FIELDS
3. `POST /api/feishu/oauth/bind` ALREADY_BOUND → 400 with rebind_required: true
4. `POST /api/feishu/oauth/bind` provisionBitable throws ProvisionFailedError → 502 PROVISION_FAILED
5. `POST /api/feishu/oauth/rebuild` happy path — 删 binding 行 + 重 provision + 200

Commit message: `test(arch): RED unit tests for feishu oauth /bind /rebuild endpoints`

### Task 2: TDD GREEN — backend 实现 `/bind` `/rebuild`

**Files**: `apps/api/src/routes/feishu-oauth.ts`

实现：
- `router.post('/bind', tenantContext, ...)`:
  - 收 body `{app_id, app_secret}` + tenantId from context
  - 校验：tenant 存在 / 未已绑 / app_id+secret 非空
  - UPDATE tenants 灌 app_id/secret
  - 调 `provisionBitable(tenantId)` 同步建 Bitable + 3 表
  - 返回 `{success, data: {app_token, table_ids: {...}, bitable_doc_url}}`
  - error: ProvisionFailedError → 502
- `router.post('/rebuild', tenantContext, ...)`:
  - DELETE binding 行（保留 tenants.app_id/secret）
  - 调 provisionBitable
  - 返回新 IDs

测试 PASS。Commit: `feat(arch): backend POST /bind /rebuild — 0-touch Bitable provision`

### Task 3: Frontend 改 `FeishuBindTenant.tsx`

**Files**: `apps/dashboard/src/pages/FeishuBindTenant.tsx`

- `onSubmit`: POST `/api/feishu/oauth/bind` 取代 `/start` + 去掉 `window.location.href`
- 等响应（loading state「建表中... 大约 10 秒」）
- 成功 → 直接 setStatus({bound: true, app_token, bitable_url}) → 渲染绑定状态
- 失败 → 现有 leadConfigError UI

Commit: `fix(arch): frontend FeishuBindTenant — 同步 /bind 替代 OAuth 跳转`

### Task 4: 本地 build / lint / test

```bash
cd apps/api && rm -rf dist && npm run build && npm test && npm run lint
cd apps/dashboard && npm run build && npm test && npm run lint
```

如果 lint-tdd-commit-order 报错，调整 commit 顺序（test 先 commit，src 后 commit）。

### Task 5: Push + 开 PR

`git push -u origin HEAD` + `gh pr create` with full description。

### Task 6: Merge + Redeploy

merge → backend redeploy（主 working tree stash + main pull + apps/api build + 重启 launchctl + 切回 stash pop） → dashboard redeploy（worktree reset hard + apps/dashboard build + rsync hk）

### Task 7: Lead 0-touch E2E 自验

改 `/tmp/p2-rog-self-test-v5.js`：
- API signup
- Playwright (msedge headless on rog) goto /dashboard/feishu-bind
- 填 ZenithJoy real app_id/secret
- 点提交 → 等 15s
- 断言"飞书已绑定"
- 截图 6+
- scp 截图回 mac
- 写真证据 `.agent-knowledge/path-2/lead-acceptance-sprint-a.md`

Commit + push 真证据。

### Task 8: Follow-up note

写 `.agent-knowledge/path-2/dispatcher-followup-note.md`：app credentials 让物理瓶颈消失，dispatcher human-in-loop 设计要重定位为「为并发」而非「为扫码」。

---

## Done Criteria

- [ ] CI all green on PR
- [ ] Merged to main
- [ ] backend redeployed + new `/bind` 端点 live (curl test from mac)
- [ ] dashboard redeployed
- [ ] ROG 0-touch E2E PASS — user_intervention_count = 0
- [ ] 真证据 doc committed
