import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../../../../apps/api/db/migrations/20260524_100000_acquisition_tables.sql',
);

describe('WS1 Migration — acquisition_keyword_tasks + acquisition_videos [BEHAVIOR]', () => {
  it('[ARTIFACT] 迁移文件存在', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it('[ARTIFACT] 迁移文件包含 acquisition_keyword_tasks 表定义', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf8');
    expect(content).toContain('acquisition_keyword_tasks');
  });

  it('[ARTIFACT] 迁移文件包含 acquisition_videos 表定义', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf8');
    expect(content).toContain('acquisition_videos');
  });

  it('[ARTIFACT] 迁移文件包含 expanded_keywords JSONB 列', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf8');
    expect(content).toContain('expanded_keywords');
    expect(content.toLowerCase()).toContain('jsonb');
  });

  it('[ARTIFACT] 迁移文件包含 comment_task_status 列', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf8');
    expect(content).toContain('comment_task_status');
  });

  it('[BEHAVIOR] 迁移文件不含 DROP TABLE（安全性）', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf8').toUpperCase();
    expect(content).not.toContain('DROP TABLE');
  });

  it('[BEHAVIOR] 迁移文件使用 IF NOT EXISTS（幂等性）', () => {
    const content = readFileSync(MIGRATION_PATH, 'utf8').toUpperCase();
    expect(content).toContain('IF NOT EXISTS');
  });
});
