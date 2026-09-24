import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

describe('brain_sync_outbox migration', () => {
  const dir = join(__dirname, '../../../db/migrations');
  const file = readdirSync(dir).find((f) => f.includes('brain_sync_outbox'));

  it('migration 文件存在', () => {
    expect(file).toBeTruthy();
  });

  const sql = file ? readFileSync(join(dir, file), 'utf8') : '';

  it('建表用 IF NOT EXISTS，重复跑不炸', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zenithjoy\.brain_sync_outbox/i);
  });

  it('没有破坏性语句', () => {
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM)\b/i);
  });

  it('字段齐：区分操作类型、可重试、留错因', () => {
    for (const col of ['worker_task_id', 'op', 'payload', 'attempts', 'last_error', 'created_at']) {
      expect(sql).toContain(col);
    }
  });
});
