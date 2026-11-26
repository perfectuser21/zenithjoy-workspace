import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyDashboardApiCompatibility } from '../dashboard-api-compat.mjs';

function candidates(t) {
  const repo = mkdtempSync(join(tmpdir(), 'dashboard-api-compat-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  const commit = (message, parent) => {
    git('add', '.');
    return git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
      'commit-tree', git('write-tree'), ...(parent ? ['-p', parent] : []), '-m', message);
  };
  const source = join(repo, 'apps/dashboard/src');
  mkdirSync(source, { recursive: true });
  git('init', '-q');
  writeFileSync(join(source, 'company-profile.api.ts'), "export const API = '/api/company-profile';\n");
  writeFileSync(join(source, 'profile.test.ts'), "fetch('/api/company-profile/source-sync');\n");
  const older = commit('Profile only');
  writeFileSync(join(source, 'company-profile.api.ts'),
    "const BASE = '/api/company-profile';\nexport const settings = () => fetch(BASE + '/outreach-settings');\n");
  writeFileSync(join(source, 'CompanySourceSync.tsx'),
    "export const sync = () => fetch('/api/company-profile/source-sync');\n");
  const newer = commit('Company features', older);
  mkdirSync(join(source, 'api'), { recursive: true });
  writeFileSync(join(source, 'ContentFactoryPage.tsx'), "import { listTopics } from './api/topics.api';");
  writeFileSync(join(source, 'api/topics.api.ts'), "fetch('/api/topics');");
  const withLegacyTopics = commit('Legacy topics', newer);
  writeFileSync(join(source, 'api/topics.api.ts'), "fetch('/api/content-factory/topics');");
  const withStaffTopics = commit('Staff topics', withLegacyTopics);
  return { repo, older, newer, withLegacyTopics, withStaffTopics };
}

function unauthorized() {
  return Response.json({ success: false, error: { code: 'UNAUTHORIZED' } }, { status: 401 });
}

test('checks the pinned candidate rather than the current worktree or old test-only paths', async (t) => {
  const { repo, older } = candidates(t);
  const observation = await verifyDashboardApiCompatibility({
    sha: older,
    cwd: repo,
    fetchImpl: () => assert.fail('older candidate does not use these endpoints'),
  });
  assert.deepEqual(observation, { sha: older, requiredRoutes: [], observations: [] });
});

test('requires both origins to acknowledge and protect both paths using anonymous read-only GETs', async (t) => {
  const { repo, newer } = candidates(t);
  const requests = [];
  const result = await verifyDashboardApiCompatibility({
    sha: newer,
    cwd: repo,
    fetchImpl: (url, options) => {
      requests.push({ url: url.href, method: options.method, redirect: options.redirect });
      return unauthorized();
    },
  });
  const origins = ['https://zenithjoy.tech', 'https://autopilot.zenjoymedia.media'];
  const routes = ['/api/company-profile/outreach-settings', '/api/company-profile/source-sync'];
  assert.deepEqual(result.requiredRoutes, routes);
  assert.equal(result.observations.length, 4);
  assert.deepEqual(requests, origins.flatMap(origin => routes.map(route => ({
    url: origin + route, method: 'GET', redirect: 'error',
  }))));
});

test('fails closed on missing origins, HTML authentication screens, and unguarded responses', async (t) => {
  const { repo, newer } = candidates(t);
  const cases = [
    { response: () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }), detail: /HTTP 404/ },
    { response: () => new Response('<html>Bad gateway</html>', { status: 502 }), detail: /HTTP 502/ },
    { response: () => new Response('<html>Authentication required</html>', { status: 401 }), detail: /HTTP 401/ },
    { response: () => Response.json({ success: true }), detail: /HTTP 200/ },
    { response: () => { throw new TypeError('network failed'); }, detail: /request failed/ },
  ];
  for (const { response, detail } of cases) {
    await assert.rejects(verifyDashboardApiCompatibility({
      sha: newer,
      cwd: repo,
      fetchImpl: url => url.hostname === 'autopilot.zenjoymedia.media' ? response() : unauthorized(),
    }), (error) => {
      assert.match(error.message, /autopilot\.zenjoymedia\.media/);
      assert.match(error.message, detail);
      return true;
    });
  }
});

test('rejects missing and abbreviated commits without querying production', async (t) => {
  const { repo, older } = candidates(t);
  for (const sha of [older.slice(0, 8), '0'.repeat(40)]) {
    await assert.rejects(verifyDashboardApiCompatibility({
      sha,
      cwd: repo,
      fetchImpl: () => assert.fail('invalid commit must not query production'),
    }), /candidate/i);
  }
});

test('topic clients require browser-session authentication on the exact path used by the candidate', async (t) => {
  const { repo, withLegacyTopics, withStaffTopics } = candidates(t);
  await assert.rejects(verifyDashboardApiCompatibility({
    sha: withLegacyTopics,
    cwd: repo,
    fetchImpl: () => unauthorized(),
  }), /\/api\/topics: HTTP 401 UNAUTHORIZED/);
  const compatible = await verifyDashboardApiCompatibility({
    sha: withStaffTopics,
    cwd: repo,
    fetchImpl: url => url.pathname.startsWith('/api/content-factory/')
      ? Response.json({ error: { code: 'SESSION_REQUIRED' } }, { status: 401 })
      : unauthorized(),
  });
  assert.ok(compatible.requiredRoutes.includes('/api/content-factory/topics'));
  assert.ok(!compatible.requiredRoutes.includes('/api/topics'));
});
