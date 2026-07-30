/**
 * Regression: promote-all-prod.yml 后端部署逻辑必须走 07-15 拆库后的 HK docker 生产路径，
 * 不能再指向已废弃的美国 Mac :5200 蓝绿部署（promote-prod.yml 同款 —— 该文件已被
 * promote-prod-hk.yml 取代，本合同顺带断言它已被删除）。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const PROMOTE_ALL_PROD = path.join(REPO_ROOT, '.github', 'workflows', 'promote-all-prod.yml');
const PROMOTE_PROD_DEPRECATED = path.join(REPO_ROOT, '.github', 'workflows', 'promote-prod.yml');

describe('promote-all-prod.yml — 后端 job 必须走 HK docker 生产路径', () => {
  it('文件存在', () => {
    expect(fs.existsSync(PROMOTE_ALL_PROD)).toBe(true);
  });

  it('不再引用已废弃的美国 Mac 蓝绿部署 secrets', () => {
    const src = fs.readFileSync(PROMOTE_ALL_PROD, 'utf-8');
    expect(src).not.toMatch(/US_MAC_HOST|US_MAC_USER|US_MAC_SSH_KEY|US_MAC_PORT/);
  });

  it('promote-backend job 走 HK docker 部署（Tailscale + HK_VPS_SSH_KEY + docker健康冒烟）', () => {
    const src = fs.readFileSync(PROMOTE_ALL_PROD, 'utf-8');
    expect(src).toMatch(/tailscale\/github-action/);
    expect(src).toMatch(/HK_VPS_SSH_KEY/);
    expect(src).toMatch(/zenithjoy-api-prod/);
  });
});

describe('promote-prod.yml — 已废弃文件必须删除', () => {
  it('不存在（已被 promote-prod-hk.yml 取代）', () => {
    expect(fs.existsSync(PROMOTE_PROD_DEPRECATED)).toBe(false);
  });
});
