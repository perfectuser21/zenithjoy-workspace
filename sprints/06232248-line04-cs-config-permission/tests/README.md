# tests/ — 测试落点说明

本 sprint 的 TDD-red 永久回归测试按 repo 既有约定落在：

- **`apps/api/tests/regression/line04-cs-config-permission.test.ts`**
  （与前序 `apps/api/tests/regression/line04-cs-tenant-isolation.test.ts` 同目录；
  smoke `line04-cs-config-permission-smoke.sh` 与 contract-dod 的 [BEHAVIOR] 均引用此路径，
  CLAUDE.md 要求修 bug 的 test 必须 commit 进 repo 永久留 CI）

- 前台 Playwright spec：**`apps/dashboard/e2e/cs-config-permission.spec.ts`**（generator 创建）

**Round 1 实测红证据**：`npx vitest run tests/regression/line04-cs-config-permission.test.ts`
→ 8 用例 6 failed / 2 passed（缺安全闸时 member/跨租户/无身份/deny-by-default 错误地放行写库 = 真红；
admin happy-path 现状偶然 200、auto-agent 既有 superAdminGuard 拦 member = 已正确的 2 绿）。
