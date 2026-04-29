# Learning: PR-3 Dashboard 邮箱+密码登录 UI（better-auth 前端集成）

**任务**: Dashboard 加 SignUp / SignIn / ForgotPassword 三页 + AuthContext 双轨改造（better-auth session 优先 / 飞书 cookie 回退）
**分支**: cp-04291523-better-auth-dashboard-ui
**完成日期**: 2026-04-29

---

### 根本原因

PR #239 在后端装了 better-auth 邮箱+密码登录，但 Dashboard 前端只有飞书登录（FeishuLogin.tsx）。客户公司员工无法登录 ZenithJoy 的飞书 app（per-app open_id 限制），所以需要邮箱密码作为客户主登录通道，飞书保留为内部主理人通道。

### 发现的关键事实

1. **不需要 better-auth React SDK** — 后端已 cookie session（HTTP-only），前端 fetch + `credentials: 'include'` 透明带 cookie 就够。React SDK 增加打包体积无收益。
2. **AuthContext 双轨优先级**: better-auth session > 飞书 cookie > localStorage。命中 better-auth session 时回写 user/token cookie，让现有 `X-Feishu-User-Id` 注入器（client.ts axios interceptor / license.api.ts）不需要改动 — 兼容性最大化。
3. **lint-tdd-commit-order 只检查 .ts，不查 .tsx** — Dashboard 改 .tsx 不强制 commit-1 红测；但 `lint-feature-has-smoke` 仍强制 — 加 `dashboard-auth-ui-smoke.sh`（curl 真链路）。
4. **PR webhook 在 force-push 后会卡死** — 跟 PR #236 同问题。修法：rebase 到最新 main + force-with-lease（让 mergeable 状态从 DIRTY 恢复）。
5. **lint-test-pairing 要求 .ts src 文件配对测试** — better-auth.api.ts 必须有 `__tests__/better-auth.api.test.ts`（agent 漏了，drive-by 补）。

### 下次预防

- [ ] Dashboard 新页面默认装 4 个测试（render / submit-success / submit-fail / validation）—— vitest + RTL + fetch mock 模板
- [ ] 改 .github/ 必加 [CONFIG] 标题前缀（CI Config Audit 强制）
- [ ] 新 src/api/*.ts 必配 __tests__/*.test.ts（lint-test-pairing 强制，至少导出契约）
- [ ] Force-push 前先 rebase 到最新 main，避免 mergeStateStatus: DIRTY 卡 webhook
