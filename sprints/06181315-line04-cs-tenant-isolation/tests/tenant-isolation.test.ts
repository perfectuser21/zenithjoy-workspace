/**
 * Harness 归档入口 —— 本 sprint 的多租户隔离测试 canonical 位置在
 * apps/api/tests/regression/line04-cs-tenant-isolation.test.ts
 * （CLAUDE.md：修隔离类缺陷的 regression test 必须永久留在 repo CI 跑；
 *   且需 apps/api vitest 上下文解析 supertest app + pg pool mock）。
 *
 * 此处 re-import 单一来源，避免重复维护两份测试。
 * 真实 RED/GREEN 证据由 `cd apps/api && npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts` 产生。
 */
import '../../../apps/api/tests/regression/line04-cs-tenant-isolation.test';
