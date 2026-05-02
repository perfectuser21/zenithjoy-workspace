## ZenithJoy Phase 2 Integration Tests (2026-05-02)

### 根本原因

- Unit tests mock `pool.query`，无法发现 SQL 语法错误、schema 漂移、tenant 隔离失效等运行时问题
- 缺少 integration 层测试，导致"单元测试全绿但 DB 层行为崩"的盲区

### 下次预防

- [ ] Integration tests 需独立的 vitest config（`vitest.integration.config.ts`）+ 独立 CI job（`ci-l4-integration.yml`）
- [ ] `globalSetup` 用 `path.join(process.cwd(), 'db/migrations')` 而非 `import.meta.url`（CJS 兼容）
- [ ] `setupFiles` 在模块求值前设置 `DATABASE_NAME=zenithjoy_test`，让 `connection.ts` Pool 连测试库
- [ ] 测试数据通过直连 `testPool` 写入（不走 HTTP），HTTP 层只验证行为
- [ ] 每个 suite 用 `TRUNCATE ... CASCADE` 清理，按表依赖顺序排列（publish_logs → works → tenant_members → tenants）
- [ ] GitHub Actions postgres service 用 `POSTGRES_DB: zenithjoy_test` 直接建库，global setup 里的 CREATE DATABASE 会正确 skip
- [ ] `import.meta.url` 在 vitest globalSetup（CJS 模式）中不可用；用 `process.cwd()` 代替
