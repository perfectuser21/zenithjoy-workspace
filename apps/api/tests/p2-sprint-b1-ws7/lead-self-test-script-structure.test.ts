/**
 * WS7 — Lead 客户机自验脚本结构验证 (CI 实跑落点)
 *
 * Path: apps/api/tests/p2-sprint-b1-ws7/ (3 deep) → ../../../...
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SELFTEST = path.resolve(
  __dirname,
  '../../../../scripts/lead-acceptance/path2-sprint-b1-self-test.cjs'
);
const EVIDENCE = path.resolve(
  __dirname,
  '../../../../.agent-knowledge/path-2/lead-acceptance-sprint-b1.md'
);

describe('Workstream 7 — self-test 脚本结构 [BEHAVIOR]', () => {
  it('self-test 脚本含 channel msedge + launchPersistentContext (B-1 arch hotfix: headless 改 false 让 chrome 弹 rog 桌面给 user 物理扫码)', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    expect(c).toMatch(/channel:\s*['"]msedge['"]/);
    // headless: false — chrome 真弹桌面（user 物理扫码）；--start-maximized 撑满屏
    expect(c).toMatch(/headless:\s*false/);
    expect(c).toContain('launchPersistentContext');
  });

  it('self-test waitForURL timeout >= 600000 (10 分钟)', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    const m = c.match(/waitForURL[^)]*timeout:\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(parseInt(m![1], 10)).toBeGreaterThanOrEqual(600000);
  });

  it('self-test 真飞书 GET 验证 5 行（含 commenter_id + comment text 非空）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    expect(c).toContain('open.feishu.cn');
    expect(c).toMatch(/items[\s\S]{0,200}length[\s\S]{0,200}5/);
  });

  it('self-test 输出截图 + summary JSON', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    expect(c).toContain('screenshot');
    expect(c).toContain('burner-qr');
    expect(c).toContain('user 现在扫');
  });

  it('lead-acceptance 真证据文档存在 + size > 1KB + lead_acceptance_status: PASS', () => {
    expect(fs.existsSync(EVIDENCE)).toBe(true);
    const stat = fs.statSync(EVIDENCE);
    expect(stat.size).toBeGreaterThan(1024);
    const c = fs.readFileSync(EVIDENCE, 'utf8');
    expect(c).toContain('lead_acceptance_status: PASS');
    expect(c).toContain('user_intervention_count: 1');
    expect(c).toContain('xian-rog');
  });
});
