import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

const DB = process.env.DB_URL ?? 'postgresql://postgres:postgres@localhost/cecelia';

function psql(sql: string): string {
  return execSync(`psql "${DB}" -t -c "${sql}" 2>&1`, { encoding: 'utf8' }).trim();
}

describe('WS1 — operator_sessions DB migration [BEHAVIOR]', () => {
  it('operator_sessions 表存在', () => {
    const count = psql(
      "SELECT count(*) FROM information_schema.tables WHERE table_name='operator_sessions'"
    );
    expect(parseInt(count.trim(), 10)).toBe(1);
  });

  it('operator_sessions 含 5 核心字段（platform/secret_name/status/last_checked_at/last_valid_at）', () => {
    const count = psql(
      "SELECT count(*) FROM information_schema.columns WHERE table_name='operator_sessions' AND column_name IN ('platform','secret_name','status','last_checked_at','last_valid_at')"
    );
    expect(parseInt(count.trim(), 10)).toBe(5);
  });

  it('status CHECK 约束拒绝 ok（禁用值）', () => {
    const result = psql(
      "INSERT INTO operator_sessions (platform, secret_name, status) VALUES ('__test_check__', 'TEST_COOKIES', 'ok')"
    );
    expect(result).toMatch(/violates check constraint|check_oper|ERROR/i);
  });

  it('status CHECK 约束允许 active/expired/missing', () => {
    const ts = Date.now();
    for (const status of ['active', 'expired', 'missing']) {
      const result = psql(
        `INSERT INTO operator_sessions (platform, secret_name, status) VALUES ('__test_${status}_${ts}', 'TEST_COOKIES', '${status}') ON CONFLICT (platform) DO UPDATE SET status='${status}'`
      );
      expect(result).not.toMatch(/ERROR/i);
      psql(`DELETE FROM operator_sessions WHERE platform='__test_${status}_${ts}'`);
    }
  });

  it('migration SQL 不含禁用 status 值 ok/healthy/valid 在 CHECK 约束中', () => {
    const files = execSync("ls db/migrations/ 2>/dev/null | grep operator_sessions | grep '\\.sql$'", { encoding: 'utf8' }).trim();
    expect(files).toBeTruthy();
    const content = execSync(`cat "db/migrations/${files.split('\n').pop()?.trim()}"`, { encoding: 'utf8' });
    expect(content).not.toMatch(/CHECK.*\bok\b/i);
    expect(content).not.toMatch(/CHECK.*healthy/i);
  });
});
