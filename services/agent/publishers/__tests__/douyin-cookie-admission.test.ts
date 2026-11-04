import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const publisherDir = path.resolve(__dirname, '..');
const filename = path.join(publisherDir, 'keyword-search-douyin.cjs');
const actualRequire = createRequire(filename);
const session = (extra = {}) => ({ name: 'sessionid_ss', value: 'synthetic-session-token-not-a-real-cookie', domain: '.douyin.com', ...extra });

// Run the actual command's main(), replacing only browser/process/filesystem boundaries.
// Reaching goto proves admission, not platform login or successful collection.
async function runKeyword(initial: unknown[], fallback?: unknown[]) {
  let cookies = initial;
  const injected: unknown[][] = [];
  let navigations = 0;
  let output = '';
  let diagnostics = '';
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const page = { url: () => 'https://www.douyin.com/', goto: async () => { navigations++; throw new Error('FIXTURE_SEARCH_BOUNDARY'); } };
  const context = { cookies: async () => cookies, addCookies: async (next: unknown[]) => { injected.push(next); cookies = next; }, pages: () => [page] };
  const browser = { contexts: () => [context], close: async () => {} };
  const fakeFs = {
    existsSync: (p: string) => p === 'C:/fixture/chrome.exe' || (p.endsWith('fixture-profile.json') && fallback !== undefined),
    readFileSync: (p: string) => {
      if (p.endsWith('.env')) return 'ZJ_MAIN_DATA_DIR=C:/fixture/fixture-profile';
      if (p.endsWith('zj-burner-active-dir.txt')) return 'C:/fixture/fixture-profile';
      if (p.endsWith('fixture-profile.json') && fallback !== undefined) return JSON.stringify({ cookies: fallback });
      throw new Error('Unapproved fixture read');
    },
  };
  const requireFixture = (name: string) => {
    if (name === 'playwright-core') return { chromium: { connectOverCDP: async () => browser } };
    if (name === 'fs') return fakeFs;
    if (name === 'os') return { homedir: () => '/fixture/home', tmpdir: () => '/fixture/tmp' };
    if (name === 'child_process') return { spawn: () => { throw new Error('Unexpected process launch'); }, execSync: () => { throw new Error('Unexpected command'); } };
    return actualRequire(name);
  };
  const proc = { argv: ['node', filename, 'fixture-keyword'], env: { CHROME_EXECUTABLE_PATH: 'C:/fixture/chrome.exe' }, platform: 'win32', stdout: { write: (s: string) => { output += s; } }, stderr: { write: (s: string) => { diagnostics += s; } }, exit: () => finish() };
  vm.runInNewContext(readFileSync(filename, 'utf8'), { require: requireFixture, process: proc, __dirname: publisherDir, setTimeout, console }, { filename });
  await finished;
  return { navigations, injected, result: JSON.parse(output.trim().split('\n').at(-1)!), diagnostics };
}

describe('actual keyword command cookie admission', () => {
  it('admits a sessionid_ss-only profile to the search boundary', async () => {
    const run = await runKeyword([session()]);
    expect(run.navigations).toBe(1);
    expect(run.result.error).toBe('FIXTURE_SEARCH_BOUNDARY');
    expect(run.result.ok).toBe(false);
  });
  it('admits sessionid_ss-only saved state through the real fallback path', async () => {
    const run = await runKeyword([], [session()]);
    expect(run.injected).toHaveLength(1);
    expect(run.navigations).toBe(1);
  });
});

const admission = actualRequire('./douyin-cookie-admission.cjs');
const producers = [
  actualRequire('./qr-bind-douyin.cjs').isSessionCookie,
  actualRequire('./qr-bind-douyin-burner.cjs').isSessionCookie,
  (cookie: unknown) => actualRequire('./qr-bind-operator.cjs').isSessionReady({ cookies: [cookie] }, 'douyin'),
];

describe('shared production admission and actual QR producer entry wiring', () => {
  it.each(['sessionid', 'sessionid_ss'])('accepts both established session names: %s', name => {
    for (const expires of [undefined, -1, Date.now() / 1000 + 3600]) {
      const cookie = session({ name, expires });
      expect(admission.isDouyinSessionCookie(cookie)).toBe(true);
      for (const ready of producers) expect(ready(cookie)).toBe(true);
    }
  });
  it.each([
    { name: 'sid_tt' }, { name: 'ttwid' }, { name: '' }, { value: '' }, { value: 'placeholder' }, { value: 'x'.repeat(20) },
    { value: ' '.repeat(30) }, { domain: 'evil-douyin.com' }, { domain: 'douyin.com.evil.test' },
    { domain: '..douyin.com' }, { domain: 'https://douyin.com' }, { domain: '.douyin.com/' },
    { domain: '' }, { domain: null }, { expires: 0 }, { expires: 1 }, { expires: -2 },
    { expires: null }, { expires: '9999999999' }, { expires: Infinity }, { expires: NaN },
  ])('rejects invalid or expired credential %j across producer/consumer', extra => {
    const cookie = session(extra);
    expect(admission.isDouyinSessionCookie(cookie)).toBe(false);
    expect(admission.findDouyinSessionCookie([cookie])).toBeUndefined();
    for (const ready of producers) expect(ready(cookie)).toBe(false);
  });
  it('uses exact expiry and domain boundaries without mutating state', () => {
    for (const domain of ['douyin.com', '.douyin.com', 'creator.douyin.com', '.www.douyin.com']) {
      expect(admission.isDouyinSessionCookie(session({ domain, expires: 101 }), 100)).toBe(true);
    }
    expect(admission.isDouyinSessionCookie(session({ value: 'x'.repeat(21) }))).toBe(true);
    const cookie = Object.freeze(session({ expires: 100 }));
    expect(admission.isDouyinSessionCookie(cookie, 100)).toBe(false);
    expect(admission.findDouyinSessionCookie([session({ name: 'sid_tt' }), cookie], 100)).toBeUndefined();
    expect(admission.findDouyinSessionCookie(null)).toBeUndefined();
    expect(admission.isDouyinSessionCookie(null)).toBe(false);
  });
  it('leaves unrelated platform cookie contracts intact', () => {
    expect(actualRequire('./qr-bind-operator.cjs').isSessionReady({ cookies: [{ name: 'sid_tt', value: 'existing-toutiao-contract' }] }, 'toutiao')).toBe(true);
  });
});

describe('actual keyword command rejects invalid credentials', () => {
  it.each([[], [session({ name: 'sid_tt' })], [session({ domain: 'douyin.com.evil.test' })], [session({ expires: 1 })]].map(cookies => ({ cookies })))('does not navigate for unusable profile %j', async ({ cookies }) => {
    const run = await runKeyword(cookies);
    expect(run.navigations).toBe(0);
    expect(run.result).toMatchObject({ ok: false, error: 'DOUYIN_SESSION_UNAVAILABLE' });
    expect(run.diagnostics).not.toContain('可能已过期');
  });
  it.each([{ expires: 0 }, { expires: 1 }, { domain: 'evil-douyin.com' }, { name: 'sid_tt' }])('does not revive invalid saved state %j', async extra => {
    const run = await runKeyword([], [session(extra)]);
    expect(run.injected).toHaveLength(0);
    expect(run.navigations).toBe(0);
    expect(run.result.ok).toBe(false);
  });
  it('injects only usable Douyin cookies and preserves valid session expiry', async () => {
    const run = await runKeyword([], [session({ expires: -1 }), session({ name: 'ttwid', expires: 0 }), session({ domain: 'evil.test' })]);
    expect(run.navigations).toBe(1);
    expect(run.injected[0]).toHaveLength(1);
    expect(run.injected[0][0]).toMatchObject({ name: 'sessionid_ss', expires: -1 });
  });
});
