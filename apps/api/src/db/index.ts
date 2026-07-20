/**
 * DB 连接池 re-export。
 * 让 `import pool from '../db'` 与 `import pool from '../db/connection'` 等价，
 * 同时允许 vitest 通过 `vi.mock('../../../apps/api/src/db')` 精确 mock 整个 db 模块。
 */
export { default } from './connection';
