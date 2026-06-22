import { describe, it, expect } from 'vitest';
import {
  listMigrationFiles,
  computePending,
} from '../../db/migrations/migration-core';

describe('migration-core — migration runner 幂等/排序纯逻辑', () => {
  describe('listMigrationFiles', () => {
    it('只取 .sql 文件，过滤掉非 sql', () => {
      const files = listMigrationFiles('/x', () => [
        '20260210_a.sql',
        'run-migration.ts',
        'README.md',
        '20260101_b.sql',
      ]);
      expect(files).toEqual(['20260101_b.sql', '20260210_a.sql']);
    });

    it('按文件名严格升序（保证 schema 依赖顺序）', () => {
      const files = listMigrationFiles('/x', () => [
        '20260509_120100_z.sql',
        '20260509_120000_a.sql',
        '20260428_100000_first.sql',
      ]);
      expect(files).toEqual([
        '20260428_100000_first.sql',
        '20260509_120000_a.sql',
        '20260509_120100_z.sql',
      ]);
    });

    it('空目录返空数组', () => {
      expect(listMigrationFiles('/x', () => [])).toEqual([]);
    });
  });

  describe('computePending — 幂等核心', () => {
    const all = ['001_a.sql', '002_b.sql', '003_c.sql'];

    it('全未应用 → 全部 pending（首次部署）', () => {
      expect(computePending(all, new Set())).toEqual(all);
    });

    it('全已应用 → pending 为空（重复跑不重复应用）', () => {
      expect(computePending(all, new Set(all))).toEqual([]);
    });

    it('部分已应用 → 只返未应用的，保持升序（新 migration 被应用）', () => {
      const applied = new Set(['001_a.sql', '002_b.sql']);
      expect(computePending(all, applied)).toEqual(['003_c.sql']);
    });

    it('幂等：两次 computePending 同输入返同结果', () => {
      const applied = new Set(['001_a.sql']);
      const first = computePending(all, applied);
      const second = computePending(all, applied);
      expect(first).toEqual(second);
      expect(first).toEqual(['002_b.sql', '003_c.sql']);
    });

    it('applied 含已不存在的旧文件 → 不影响 pending 计算（不报错）', () => {
      const applied = new Set(['001_a.sql', 'deleted_old.sql']);
      expect(computePending(all, applied)).toEqual(['002_b.sql', '003_c.sql']);
    });
  });
});
