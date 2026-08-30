import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
const MIG = path.resolve(__dirname, '../../../db/migrations/20260830_120000_worker_tasks.sql');
describe('worker_tasks migration', () => {
  const sql = fs.existsSync(MIG) ? fs.readFileSync(MIG, 'utf8') : '';
  it('文件存在', () => { expect(fs.existsSync(MIG)).toBe(true); });
  it('建 worker_tasks 与 worker_task_steps（幂等）', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zenithjoy\.worker_tasks/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS zenithjoy\.worker_task_steps/);
  });
  it('同 worker 同时仅一条 running 的 partial unique index', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tasks_running_per_agent[\s\S]*WHERE status = 'running'/);
  });
  it('状态枚举含 needs_review 与 executor 三件套字段', () => {
    expect(sql).toMatch(/'running',\s*'completed',\s*'failed',\s*'needs_review'/);
    expect(sql).toMatch(/foreground_pkg TEXT/);
    expect(sql).toMatch(/diag_line TEXT/);
    expect(sql).toMatch(/screenshot_ref TEXT/);
  });
});
