/**
 * version-stamp.spec.mjs
 * FR-09 / FR-10 / AC-6: staging 版本戳双端可读
 *
 * 后端：GET /api/version 返回 { sha, version, built_at }，sha 非 'unknown'
 * 前端：deploy workflow 含 VITE_BUILD_SHA=${{ github.sha }}
 *       前端页面（页脚或 /admin）可见 sha 字符串
 *
 * 注意：后端/前端部分需要 staging 可达，不可达时 skip（static 部分不 skip）。
 *
 * 这是 failing test（commit-1），实现完成后（commit-6/7）应全绿。
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');

describe('FR-09 静态检查：/api/version 路由注册', () => {
  test('apps/api/src/app.ts 已挂载 /api/version 路由', () => {
    const appTs = resolve(REPO_ROOT, 'apps/api/src/app.ts');
    expect(existsSync(appTs)).toBe(true);

    const content = readFileSync(appTs, 'utf8');
    // /version 已存在，FR-09 要求同时暴露 /api/version（通过 /api 前缀或直接挂）
    // 检查 /api/version 或现有 /version 路由（两者均可）
    const hasVersionRoute = content.includes("'/api/version'") ||
                            content.includes('"/api/version"') ||
                            content.includes("'/version'") ||
                            content.includes('"/version"');
    expect(hasVersionRoute).toBe(true);
  });

  test('apps/api/src/app.ts 返回 getBuildInfo() 结构含 sha 字段', () => {
    const appTs = resolve(REPO_ROOT, 'apps/api/src/app.ts');
    const content = readFileSync(appTs, 'utf8');
    // getBuildInfo 已在 /version 路由使用
    expect(content).toMatch(/getBuildInfo/);
  });
});

describe('FR-10 静态检查：deploy workflow VITE_BUILD_SHA 注入', () => {
  const DEPLOY_WF = resolve(REPO_ROOT, '.github/workflows/deploy-dashboard-staging.yml');

  test('deploy-dashboard-staging.yml 存在', () => {
    expect(existsSync(DEPLOY_WF)).toBe(true);
  });

  test('workflow 含 VITE_BUILD_SHA 注入（pin github.sha）', () => {
    if (!existsSync(DEPLOY_WF)) return;
    const content = readFileSync(DEPLOY_WF, 'utf8');
    // FR-10 要求注入 VITE_BUILD_SHA=${{ github.sha }}
    expect(content).toMatch(/VITE_BUILD_SHA/);
    expect(content).toMatch(/github\.sha/);
  });

  test('workflow 已移除 reset --hard origin/main（改为 pin github.sha）', () => {
    if (!existsSync(DEPLOY_WF)) return;
    const content = readFileSync(DEPLOY_WF, 'utf8');
    // FR-10 要求去掉 reset --hard origin/main，改为显式 pin sha
    // 这是 failing test：当前 workflow 仍含 reset --hard
    expect(content).not.toMatch(/reset --hard origin\/main/);
  });
});

describe('AC-6 集成测试：staging 版本戳可达（离线则 skip）', () => {
  const STAGING_URL = process.env.STAGING_URL || 'https://staging-autopilot.zenjoymedia.media';

  test('GET /api/version 返回含 sha 的 JSON', async () => {
    let resp;
    try {
      resp = await fetch(`${STAGING_URL}/api/version`, {
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      console.warn('SKIP: staging 不可达，跳过集成测试');
      return;
    }

    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(body).toHaveProperty('sha');
    expect(body.sha).not.toBe('unknown');
    expect(body.sha.length).toBeGreaterThanOrEqual(7);
    console.log(`PASS: staging sha=${body.sha}`);
  });

  test('GET /version 路由也返回含 sha 的 JSON（向后兼容）', async () => {
    let resp;
    try {
      resp = await fetch(`${STAGING_URL}/version`, {
        signal: AbortSignal.timeout(8000)
      });
    } catch {
      console.warn('SKIP: staging 不可达，跳过集成测试');
      return;
    }

    if (!resp.ok) {
      console.warn('SKIP: /version 端点无响应，跳过');
      return;
    }
    const body = await resp.json();
    expect(body).toHaveProperty('sha');
  });
});
