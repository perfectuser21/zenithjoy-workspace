/**
 * migration-core — migration runner 的纯逻辑（无 DB / 无 process.exit），便于单测。
 *
 * 把"列出 .sql 文件、按文件名排序、算出未应用的 pending"这套幂等逻辑抽出来，
 * 这样可以脱离真实 Postgres 验证：
 *   - 重复跑不重复应用（已应用的被跳过）
 *   - 新 migration 被算进 pending
 *   - 文件名严格升序应用（保证 schema 依赖顺序）
 *
 * DB 写入（建 schema_migrations / 事务应用单文件）留在 run-migration.ts。
 */
import * as fs from 'fs';

/** 列出目录下所有 .sql 文件，按文件名严格升序（migration 必须按序应用）。 */
export function listMigrationFiles(
  dir: string,
  readdir: (d: string) => string[] = fs.readdirSync,
): string[] {
  return readdir(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * 算出 pending（未应用）migration：所有文件中剔除已应用的，保持升序。
 * 幂等核心：applied 里已有的一律不再返回。
 */
export function computePending(
  allFiles: string[],
  applied: Set<string>,
): string[] {
  return allFiles.filter((f) => !applied.has(f));
}
