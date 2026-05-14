## Path 4 Sprint 1 WS2 飞书 Bitable 审批表（2026-05-14）

### 根本原因

WS2 在现有多租户飞书集成（feishu-bitable-multitenant.ts）基础上扩展，主要挑战：
- `vi.resetModules()` 与顶层 import 并用导致 mock 失效（高危误报风险）
- `TABLE_SCHEMAS` 扩展需同步更新 4 处 DB 操作（幂等检查/成功写回/失败写回/loadBinding SELECT）
- lint-feature-has-smoke 要求 feat: PR 必须有新 smoke 脚本，单纯修改现有 smoke 不够

### 下次预防

- [ ] vitest mock 模式：同文件用顶层 import（不用 `await import()`），在 vi.mock 后紧跟 import，beforeEach 只用 `vi.clearAllMocks()`，不混 `vi.resetModules()`
- [ ] 扩展 ProvisionResult 类型时，grep 所有 pool.query INSERT INTO 该表的调用，确保 SQL 列和参数一一对齐
- [ ] feat: 类 PR 改了 apps/*/src/，必须同时新建 smoke/<feature>-smoke.sh（不是修改现有文件），否则 lint-feature-has-smoke 失败
- [ ] draft-submit 等写 DB 的路由，INSERT 必须 try/catch 并返回 `{ ok: false, code: 'DB_ERROR' }`，与同文件其他端点风格一致
- [ ] test-registry.yaml 新条目记得加 `ci: L4` 和 `status: active` 两个字段
