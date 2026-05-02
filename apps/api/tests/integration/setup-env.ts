/**
 * vitest setupFiles — 在每个 worker 进程中、模块求值前运行。
 * 设置 DATABASE_NAME 等环境变量，确保 apps/api/src/db/connection.ts
 * 在 import 时连接测试库，而不是生产库。
 */
process.env.DATABASE_NAME = process.env.DATABASE_NAME ?? 'zenithjoy_test';
process.env.DATABASE_HOST = process.env.DATABASE_HOST ?? 'localhost';
process.env.DATABASE_PORT = process.env.DATABASE_PORT ?? '5432';
process.env.DATABASE_USER = process.env.DATABASE_USER ?? 'postgres';
process.env.DATABASE_PASSWORD = process.env.DATABASE_PASSWORD ?? 'postgres';
process.env.ZENITHJOY_INTERNAL_TOKEN =
  process.env.ZENITHJOY_INTERNAL_TOKEN ?? 'integration-test-token';
process.env.ADMIN_FEISHU_OPENIDS =
  process.env.ADMIN_FEISHU_OPENIDS ?? 'ou_admin_integration_001';
process.env.NODE_ENV = 'test';
