/**
 * Path 2 Sprint B-1 architecture hotfix — self-test Step 1-3 真 implement 验证
 *
 * 修 Bug 2: ws7 generator 偷懒，self-test Step 1-3 是 stub（log 一行 +
 * status: 'assumed_done'）。直接跳 Step 4 用 hardcoded text agent_id 撞
 * backend UUID 校验。
 *
 * 此 test 用 文件结构正则 锁住 Step 1-3 必须含真 fetch + 必须 mock-agent
 * + Step 4 必须不再 hardcode 'xian-rog-agent'。
 *
 * 路径: apps/api/tests/p2-b1-arch/ (3 deep) → ../../../../scripts/...
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const SELFTEST = path.resolve(
  __dirname,
  '../../../../scripts/lead-acceptance/path2-sprint-b1-self-test.cjs'
);

describe('Path 2 B-1 architecture hotfix — self-test Step 1-3 真实化', () => {
  it('Step 1 含真 fetch /api/auth/sign-up/email （better-auth 真注册）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    expect(c).toContain('/api/auth/sign-up/email');
  });

  it('Step 2 含真 fetch /api/feishu/oauth/bind （0-touch app credentials 真飞书绑）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    expect(c).toContain('/api/feishu/oauth/bind');
  });

  it('Step 3 含真飞书 Bitable POST records （写视频 URL 进 target_videos 表）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    // 真飞书 API base + bitable apps records 路径
    expect(c).toMatch(/open\.feishu\.cn[\s\S]{0,200}bitable\/v1\/apps/);
  });

  it('Step 3.5 含真 fetch /api/_smoke/mock-agent （创 active agent 行）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    expect(c).toContain('/api/_smoke/mock-agent');
  });

  it('Step 4 不再 hardcode agent_id: "xian-rog-agent" 字面量 body（backend agentContext 自 resolve）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    // 不能在 qr-bind body 段含字面 agent_id: 'xian-rog-agent' 的 hardcode
    // 允许的：mock-agent body 含 agent_id_text: 'xian-rog-agent' (那是 dev 端 mock 入参，不是 qr-bind body)
    const qrBindSection = c.split('/api/agent/burner/qr-bind')[1] || '';
    // 取 qr-bind 后的 500 字符（body 区段）
    const region = qrBindSection.slice(0, 500);
    // qr-bind body 段不应含 agent_id: 字面量
    expect(region).not.toMatch(/agent_id:\s*['"]xian-rog-agent['"]/);
  });

  it('Step 4 qr-bind body 仅含 account_label（不再传 tenant_id/agent_id 显式 body）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    // 找到 qr-bind 调用 + body
    const qrBindCallMatch = c.match(
      /\/api\/agent\/burner\/qr-bind[\s\S]{0,800}?body:\s*JSON\.stringify\(\{([\s\S]+?)\}\)/
    );
    expect(qrBindCallMatch).not.toBeNull();
    const bodyContent = qrBindCallMatch![1];
    expect(bodyContent).toContain('account_label');
    expect(bodyContent).not.toMatch(/\btenant_id\b/);
    expect(bodyContent).not.toMatch(/\bagent_id\b/);
  });

  it('脚本携带 session cookie 跨 fetch（注册后 sign-in cookie 必须传给后续 burner endpoints）', () => {
    const c = fs.readFileSync(SELFTEST, 'utf8');
    // 必须有 cookie 处理 — header 'Cookie' 或者 jar / store 模式
    expect(c).toMatch(/[Cc]ookie/);
  });
});
