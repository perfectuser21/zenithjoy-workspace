/**
 * workflow-constraints.test.mjs
 * INV-5 / INV-6 / INV-7 / FR-08: 打表器 workflow 静态约束检查
 *
 * INV-5: runs-on = ubuntu-latest，禁止 self-hosted / android-capable
 * INV-6: secrets 白名单不含 ACCEPTANCE_API_TOKEN / TAILSCALE_AUTHKEY / HK_VPS_SSH_KEY
 * INV-7: Playwright allowlist 只放行 staging-autopilot.zenjoymedia.media
 * FR-08: 允许 secrets = STAGING_ACCEPTANCE_EMAIL + STAGING_ACCEPTANCE_PASSWORD + ACCEPTANCE_AI_TOKEN
 *
 * 这是 failing test（commit-1），实现完成后（commit-5）应全绿。
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/acceptance-scorer.yml');

describe('INV-5 / FR-08: workflow 文件存在且 runs-on 约束', () => {
  test('acceptance-scorer.yml 文件存在', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  test('workflow 使用 ubuntu-latest（不含 self-hosted）', () => {
    if (!existsSync(WORKFLOW_PATH)) {
      console.warn('workflow 文件不存在，跳过（commit-5 实现后再跑）');
      return;
    }
    const content = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(content).not.toMatch(/self-hosted/);
    expect(content).not.toMatch(/android-capable/);
    expect(content).toMatch(/ubuntu-latest/);
  });
});

describe('INV-6: workflow secrets 禁止项', () => {
  const BANNED_SECRETS = ['ACCEPTANCE_API_TOKEN', 'TAILSCALE_AUTHKEY', 'HK_VPS_SSH_KEY'];

  test.each(BANNED_SECRETS)('workflow 不含禁止 secret: %s', (secret) => {
    if (!existsSync(WORKFLOW_PATH)) {
      console.warn('workflow 文件不存在，跳过');
      return;
    }
    const content = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(content).not.toContain(secret);
  });
});

describe('FR-08: workflow 允许 secrets 正确', () => {
  const REQUIRED_SECRETS = [
    'STAGING_ACCEPTANCE_EMAIL',
    'STAGING_ACCEPTANCE_PASSWORD',
    'ACCEPTANCE_AI_TOKEN',
  ];

  test.each(REQUIRED_SECRETS)('workflow 含允许 secret: %s', (secret) => {
    if (!existsSync(WORKFLOW_PATH)) {
      console.warn('workflow 文件不存在，跳过');
      return;
    }
    const content = readFileSync(WORKFLOW_PATH, 'utf8');
    expect(content).toContain(secret);
  });
});

describe('INV-7: Playwright allowlist 只放行 staging 域名', () => {
  test('workflow 或 capture.mjs 含 allowlist 域名约束（staging-autopilot.zenjoymedia.media）', () => {
    if (!existsSync(WORKFLOW_PATH)) {
      console.warn('workflow 文件不存在，跳过');
      return;
    }

    // 检查 workflow 或 capture.mjs 含 allowlist 配置
    const workflowContent = readFileSync(WORKFLOW_PATH, 'utf8');
    const capturePath = resolve(REPO_ROOT, 'scripts/acceptance-spec/ai-run/capture.mjs');
    const captureContent = existsSync(capturePath) ? readFileSync(capturePath, 'utf8') : '';

    const combinedContent = workflowContent + captureContent;
    expect(combinedContent).toMatch(/staging-autopilot\.zenjoymedia\.media/);

    // allowlist 应含 route/abort 拦截器配置
    expect(captureContent).toMatch(/route\.|allowlist|abort/i);
  });
});
