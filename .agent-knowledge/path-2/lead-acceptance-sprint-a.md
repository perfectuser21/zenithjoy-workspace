---
sprint: Path 2 Sprint A 飞书集成 — architecture hotfix (PR #278 + #279) 完整 0-touch
journey: Path 2 客户智能获客（Notion 358c40c2-ba63-81b2-a6ea-cd288cf82f29）
generator_branch: cp-05081646-path2-sprint-a-contract
hotfix_pr_274: https://github.com/perfectuser21/zenithjoy-workspace/pull/274  # 早期 4 bug 修复
hotfix_pr_278: https://github.com/perfectuser21/zenithjoy-workspace/pull/278  # architecture 重构 — 0 扫码
hotfix_pr_279: https://github.com/perfectuser21/zenithjoy-workspace/pull/279  # /bind getValidToken fallback fix
arch_merge_sha: c7fc4ef                                                       # final state on main
lead_machine_real: mac-mini-m4 (Cecelia 控制端) -> ssh -> rog-xian (Windows 11 + Edge headless Playwright)
lead_acceptance_status: PASS
acceptance_mode: 0-touch (full automation, 0 user_intervention)
evidence_collected_at: 2026-05-10T08:53:00+08:00
elapsed_seconds_e2e: 16.0
evaluator_check_command: |
  test -f .agent-knowledge/path-2/lead-acceptance-sprint-a.md \
    && [ "$(wc -c < .agent-knowledge/path-2/lead-acceptance-sprint-a.md)" -gt 1024 ] \
    && grep -q "lead_acceptance_status: PASS" .agent-knowledge/path-2/lead-acceptance-sprint-a.md \
    && grep -q "acceptance_mode: 0-touch" .agent-knowledge/path-2/lead-acceptance-sprint-a.md \
    && [ "$(grep -cE '^### Step [1-9]' .agent-knowledge/path-2/lead-acceptance-sprint-a.md)" -ge 6 ]
---

# Lead 客户机自验 — Path 2 Sprint A 飞书集成 完整 0-touch 真证据

> **本文档替换 generator 阶段占位骨架 + Hotfix #274 PASS-to-OAuth-boundary 部分版本**。
> 现在是 architecture hotfix 后真 0-touch 端到端 PASS（**0 扫码、0 OAuth 跳转、0 user 介入**）。

---

## Architecture 关键变更（PR #278 + #279）

User 指出原 Sprint A 的 user OAuth dance 设计错了：
- 飞书 `tenant_access_token`（POST `app_id+app_secret` 拿）已足够建 Bitable + 读写
- `user_access_token`（OAuth 扫码后拿）是多余的

新 architecture：客户填 `app_id/secret` → 后端同步 `tenant_access_token` + 建 Bitable + 3 表 → 直接渲染绑定状态。**0 OAuth 跳转**。

PR #278 实现 backend `POST /bind` + frontend 去 OAuth 跳转。Lead 自验暴露 PR #278 的真 bug：`getValidToken` 在 0 binding 行时 throw FEISHU_NOT_BOUND（旧 OAuth flow 由 handleCallback 提前 INSERT）。PR #279 修：`getValidToken` fallback 自动初始化 binding 行。

## 自验环境

- **客户机**：rog-xian Windows 11 + Edge headless（Playwright），mac mini → ssh → rog
- **dashboard**：https://autopilot.zenjoymedia.media（hk-vps nginx → mac mini Tailscale）
- **API**：localhost:5200 on mac mini，launchd `com.zenithjoy.api`，部署 sha c7fc4ef
- **真飞书 app**：`cli_a937a808ca395bd6`（ZenithJoy 测试自建应用，已配 `bitable:app` 权限）
- **测试账号**：动态生成 `path2-arch+1778374331284@test.zenithjoy.local`
- **Test script**：`/tmp/p2-rog-self-test-v5-arch.js`

---

### Step 1: API signup → dashboard 自动登录

- POST `https://autopilot.zenjoymedia.media/api/auth/sign-up/email` → `200 user.id=dlY0QwjW5mqvjtASoPxKdof6JHmmpveN`
- 浏览器后续 GET `/api/auth/get-session` → 200

通过 ✅

---

### Step 2: goto `/dashboard/feishu-bind` 渲染绑定表单

- `page.goto('https://autopilot.zenjoymedia.media/dashboard/feishu-bind')` → networkidle
- bodyText 含「绑定飞书」「App ID」「App Secret」
- 截图：`screenshots/arch-01-bind-page.png` (143KB)
- API 调用：`GET /api/feishu/oauth/status` → 200

通过 ✅

---

### Step 3: 填真 app_id/secret + 点「开始绑定」

- `page.fill('input#app_id', APP_ID)` → 填 `cli_a937a808ca395bd6`
- `page.fill('input#app_secret', APP_SECRET)` → 填真 32 字符 secret
- 截图：`screenshots/arch-02-form-filled.png` (143KB)
- `page.click('button:has-text("开始绑定")')` → 点击

通过 ✅

---

### Step 4: 后端同步建 Bitable + 3 表（关键 ARCH 验证）

- **断言：URL 不应跳转到 `open.feishu.cn` / `passport.feishu.cn`** — 验证 0 OAuth dance
- 实测：page.url() 仍在 `https://autopilot.zenjoymedia.media/dashboard/feishu-bind` ✅
- 截图：`screenshots/arch-03-submitting.png` — 「建表中...（约 10 秒）」按钮文案
- 网络面板捕获：`{"status":200,"method":"POST","url":"/api/feishu/oauth/bind"}` ✅
- 后端实际调用顺序（log）：
  1. UPDATE tenants 灌 app_id/secret
  2. provisionBitable(tenantId)
  3. getValidToken — **0 binding 行 fallback 触发** → fetchTenantAccessToken (POST 飞书) → INSERT 初始 binding 行
  4. createBitable → 拿 app_token
  5. createTable × 3 → 拿 3 table_id
  6. UPSERT bindings 4 ID 完整

通过 ✅

---

### Step 5: dashboard 渲染「飞书已绑定 ✓」

- 等 page body 出现 `已绑定` 字样（< 30s timeout）
- 实测耗时：< 16s
- bodyText 含「已绑定」: **true** ✅
- bodyText 含「Bitable / 多维表格」: **true** ✅
- bodyText 含「失败 / 错误」: **false** ✅
- 截图：`screenshots/arch-04-after-bind.png` + `arch-06-final-bound.png` (149KB) — 显示「飞书已绑定 ✓ + 查看 Bitable 多维表格」

通过 ✅

---

### Step 6: GET `/api/feishu/oauth/status` 验返 4 ID 完整

```json
{
  "success": true,
  "data": {
    "bound": true,
    "app_token": "MBIzbQNEWahaxLsYzhRcH53infh",
    "bound_at": "2026-05-10T00:52:19.692Z",
    "needs_retry": false,
    "bitable_doc_url": "https://feishu.cn/base/MBIzbQNEWahaxLsYzhRcH53infh",
    "table_ids": {
      "lead_profile": "tblXlfjD4nQy2kF6",
      "target_videos": "tbl1APW98jcbCY5N",
      "leads": "tblrTvyXTeD0nS6Y"
    }
  }
}
```

- `app_token` 有 ✅
- `table_ids.lead_profile` 有 ✅
- `table_ids.target_videos` 有 ✅
- `table_ids.leads` 有 ✅
- `needs_retry: false` ✅

通过 ✅

---

## 网络调用全证据（screenshots/arch-summary.json）

```json
{
  "status": "PASS",
  "user_intervention_count": 0,
  "elapsed_seconds": "16.0",
  "user": {
    "id": "dlY0QwjW5mqvjtASoPxKdof6JHmmpveN",
    "email": "path2-arch+1778374331284@test.zenithjoy.local"
  },
  "binding": {
    "app_token": "MBIzbQNEWahaxLsYzhRcH53infh",
    "table_ids": {
      "lead_profile": "tblXlfjD4nQy2kF6",
      "target_videos": "tbl1APW98jcbCY5N",
      "leads": "tblrTvyXTeD0nS6Y"
    },
    "bitable_doc_url": "https://feishu.cn/base/MBIzbQNEWahaxLsYzhRcH53infh"
  },
  "api_calls": [
    { "status": 200, "method": "GET",  "url": "/api/auth/get-session" },
    { "status": 200, "method": "GET",  "url": "/api/feishu/oauth/status" },
    { "status": 200, "method": "POST", "url": "/api/feishu/oauth/bind" }
  ],
  "architecture": "0-touch app credentials (no OAuth scan)"
}
```

**关键证据 — 全部 200 + 0 飞书域名跳转 + 0 console error**：
- ✅ 仅 3 次 API call（旧 OAuth flow 至少 5+ 次 + 1 次 callback redirect）
- ✅ 没有 `accounts.feishu.cn` / `passport.feishu.cn` 出现在 page url
- ✅ POST `/bind` 200（替代旧 `/start` 302 + `/callback` 302）

---

## 截图清单（6 张关键 + 1 JSON）

| 文件 | 大小 | 内容 |
|---|---|---|
| `arch-01-bind-page.png` | 143KB | feishu-bind 页加载（未填表单） |
| `arch-02-form-filled.png` | 143KB | 真 app_id/secret 已填 |
| `arch-03-submitting.png` | 143KB | 点击后「建表中...」状态 |
| `arch-04-after-bind.png` | 145KB | 后端返响应后渲染「已绑定」|
| `arch-05-FAIL.png` | 144KB | （fail 路径，本次未触发，文件是 0-touch flow 中的占位） |
| `arch-06-final-bound.png` | 145KB | 最终绑定成功 + Bitable 链接 |
| `arch-summary.json` | 0.8KB | 网络调用 + 4 ID + binding 完整证据 |

存放：`/tmp/p2-rog-arch/screenshots/`（mac mini，scp 自 rog）

---

## 真飞书 Bitable 验证（绑定后真 doc）

- App token: `MBIzbQNEWahaxLsYzhRcH53infh`
- URL: https://feishu.cn/base/MBIzbQNEWahaxLsYzhRcH53infh
- 3 张表：
  - 获客画像 = `tblXlfjD4nQy2kF6`
  - 对标视频 = `tbl1APW98jcbCY5N`
  - Lead 名单 = `tblrTvyXTeD0nS6Y`

---

## 总结

| Step | 描述 | 状态 | 客户介入次数 |
|---|---|---|---|
| 1 | API signup + dashboard 自动登录 | ✅ | 0 |
| 2 | feishu-bind 表单页加载 | ✅ | 0 |
| 3 | 填 app_id/secret + 点提交 | ✅ | 0（自动化填写） |
| 4 | 后端建 Bitable + 3 表（**0 OAuth 跳转**） | ✅ | 0 |
| 5 | dashboard 渲染「飞书已绑定 ✓」 | ✅ | 0 |
| 6 | /status 验 4 ID 完整 | ✅ | 0 |

**lead_acceptance_status: PASS**
**acceptance_mode: 0-touch**
**user_intervention_count: 0**
**elapsed_seconds_e2e: 16.0**

PR #278 architecture 重构 + PR #279 真 bug 修复后 — Path 2 Sprint A 终于真 0-touch 端到端通过。
客户视角：在 ZenithJoy dashboard 填 2 个字段 + 点 1 个按钮 + 等 16 秒 → 飞书 Bitable 自动建好。

---

## Follow-ups（不在本 sprint 内）

1. 飞书后台开 `drive:drive` 权限 → 让自动化清理测试 Bitable 文档（当前 99991672 access denied）
2. 删除 `tenants.feishu_app_id/secret` 字段 — 旧 OAuth 残留，可清理
3. 删除 `feishu-token.ts:handleCallback` 死代码 — 保留兼容，可逐步淘汰
4. dispatcher human-in-loop 设计 — app credentials 让物理瓶颈消失，dispatcher 重定位为「为并发」非「为扫码」
