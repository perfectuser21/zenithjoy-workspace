/**
 * Migration test — zenithjoy.acquisition_collect_videos
 *
 * Sprint 07021006 获客 IA 重设计：验证 migration up/down 函数签名和 SQL 字段完整性（静态）。
 * 不依赖真实 DB（unit 级别）。
 */
import { describe, it, expect } from 'vitest';
import { up, down } from './20260702000000_create_acquisition_collect_videos';

describe('migration: create_acquisition_collect_videos', () => {
  it('up 函数存在且可调用', () => {
    expect(typeof up).toBe('function');
  });

  it('down 函数存在且可调用', () => {
    expect(typeof down).toBe('function');
  });

  it('up SQL 含 7 个 PRD 要求列名', async () => {
    const queries: string[] = [];
    const fakePool = { query: async (sql: string) => { queries.push(sql); } };
    await up(fakePool);

    const combined = queries.join('\n');
    const required = [
      'video_id',
      'task_id',
      'tenant_id',
      'title',
      'thumbnail_url',
      'publish_date',
      'comment_count',
    ];
    const missing = required.filter((col) => !combined.includes(col));
    expect(missing).toHaveLength(0);
  });

  it('up SQL 使用 zenithjoy schema 前缀', async () => {
    const queries: string[] = [];
    const fakePool = { query: async (sql: string) => { queries.push(sql); } };
    await up(fakePool);

    expect(queries.join('\n')).toMatch(/zenithjoy\.acquisition_collect_videos/);
  });

  it('down SQL 删除 acquisition_collect_videos 表', async () => {
    const queries: string[] = [];
    const fakePool = { query: async (sql: string) => { queries.push(sql); } };
    await down(fakePool);

    expect(queries.join('\n')).toMatch(/acquisition_collect_videos/);
  });
});
