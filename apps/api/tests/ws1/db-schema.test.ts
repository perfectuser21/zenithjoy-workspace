/**
 * ws1 DB schema migration 文件存在性 + 关键约束校验。
 *
 * 设计：用文件内容校验代替真 psql（vitest 默认环境无 postgres）。
 * 真 psql 集成测试由 .github/workflows/scripts/smoke/golden-path-4-smoke.sh 跑。
 *
 * 这一层测试保证：
 *   1) migration 文件确实存在于 apps/api/db/migrations/
 *   2) wechat_publish_task 含 approval_source CHECK (feishu_user, feishu_api) — A 路线护栏
 *   3) approval_status='approved' 必须配 approval_source（CHECK 二元约束）
 *   4) llm_audit 表含 cost / model / tokens / request_purpose
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'db', 'migrations');

function readMigration(pattern: RegExp): string | null {
  if (!fs.existsSync(MIGRATIONS_DIR)) return null;
  const file = fs.readdirSync(MIGRATIONS_DIR).find((f) => pattern.test(f));
  if (!file) return null;
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
}

describe('ws1 wechat_publish_task migration', () => {
  const sql = readMigration(/^2026\d{4}_\d{6}_create_wechat_publish_task\.sql$/);

  it('migration 文件存在（YYYYMMDD_HHMMSS_create_wechat_publish_task.sql）', () => {
    expect(sql).not.toBeNull();
  });

  it('表名 wechat_publish_task 含 task_id UUID PRIMARY KEY', () => {
    expect(sql).toMatch(/CREATE\s+TABLE.*wechat_publish_task/i);
    expect(sql).toMatch(/task_id\s+UUID\s+PRIMARY\s+KEY/i);
  });

  it('platform 字段含 CHECK in (wechat_personal)', () => {
    expect(sql).toMatch(/platform\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/CHECK[\s\S]*?platform[\s\S]*?wechat_personal/i);
  });

  it('type 字段含 CHECK in (moment, chat)', () => {
    expect(sql).toMatch(/type\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/CHECK[\s\S]*?type[\s\S]*?moment[\s\S]*?chat/i);
  });

  it('approval_status 字段含 6 状态 CHECK', () => {
    for (const s of [
      'pending_review',
      'approved',
      'rejected',
      'published',
      'failed',
      'rate_limited',
    ]) {
      expect(sql).toMatch(new RegExp(s));
    }
  });

  it('approval_source CHECK 仅允许 feishu_user / feishu_api（A 路线护栏）', () => {
    expect(sql).toMatch(/approval_source/i);
    // 关键 CHECK：禁 system / auto
    expect(sql).toMatch(/approval_source[\s\S]*?CHECK[\s\S]*?feishu_user[\s\S]*?feishu_api/i);
    // 不能含 system / auto
    expect(sql).not.toMatch(/approval_source[\s\S]*?CHECK[\s\S]*?'system'/i);
    expect(sql).not.toMatch(/approval_source[\s\S]*?CHECK[\s\S]*?'auto'/i);
  });

  it('approval_status=approved 时 approval_source NOT NULL（CHECK 二元约束）', () => {
    // CHECK ((approval_status != 'approved') OR (approval_source IN (...)))
    expect(sql).toMatch(
      /CHECK[\s\S]*?approval_status[\s\S]*?approved[\s\S]*?OR[\s\S]*?approval_source[\s\S]*?feishu_user[\s\S]*?feishu_api/i,
    );
  });

  it('rate_limit / receipt / feishu_record_id 字段齐', () => {
    expect(sql).toMatch(/rate_limit_status\s+TEXT/i);
    expect(sql).toMatch(/next_allowed_at\s+TIMESTAMPTZ/i);
    expect(sql).toMatch(/receipt_status\s+TEXT/i);
    expect(sql).toMatch(/receipt_error\s+TEXT/i);
    expect(sql).toMatch(/feishu_record_id\s+TEXT/i);
  });

  it('created_at / updated_at 含 NOT NULL DEFAULT NOW()', () => {
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
    expect(sql).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
  });
});

describe('ws1 llm_audit migration', () => {
  const sql = readMigration(/^2026\d{4}_\d{6}_create_llm_audit\.sql$/);

  it('migration 文件存在', () => {
    expect(sql).not.toBeNull();
  });

  it('表 llm_audit 含 id BIGSERIAL PK', () => {
    expect(sql).toMatch(/CREATE\s+TABLE.*llm_audit/i);
    expect(sql).toMatch(/id\s+BIGSERIAL\s+PRIMARY\s+KEY/i);
  });

  it('含 provider / model / prompt_tokens / completion_tokens / cost / request_purpose 字段', () => {
    expect(sql).toMatch(/provider\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/model\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/prompt_tokens\s+INTEGER/i);
    expect(sql).toMatch(/completion_tokens\s+INTEGER/i);
    expect(sql).toMatch(/cost\s+NUMERIC\(12,\s*8\)/i);
    expect(sql).toMatch(/request_purpose\s+TEXT/i);
    expect(sql).toMatch(/error\s+TEXT/i);
    expect(sql).toMatch(/created_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/i);
  });
});
