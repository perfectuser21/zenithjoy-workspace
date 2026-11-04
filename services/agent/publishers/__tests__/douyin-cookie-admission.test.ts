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
async function runKeyword(initial: unknown[], fallback?: unknown[], existingUrls = ['https://www.douyin.com/']) {
  let cookies = initial;
  const injected: unknown[][] = [];
  let navigations = 0;
  let output = '';
  let diagnostics = '';
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  let newPages = 0;
  const existingNavigations: string[] = [];
  const newNavigations: string[] = [];
  const pages = existingUrls.map(url => ({ url: () => url, goto: async () => { navigations++; existingNavigations.push(url); throw new Error('FIXTURE_SEARCH_BOUNDARY'); } }));
  const context = {
    cookies: async () => cookies,
    addCookies: async (next: unknown[]) => { injected.push(next); cookies = next; },
    pages: () => pages,
    newPage: async () => { newPages++; return { url: () => 'about:blank', goto: async (target: string) => { navigations++; newNavigations.push(target); throw new Error('FIXTURE_SEARCH_BOUNDARY'); }, close: async () => {} }; },
  };
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
  return { navigations, newPages, existingNavigations, newNavigations, injected, result: JSON.parse(output.trim().split('\n').at(-1)!), diagnostics };
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


describe('actual keyword command existing-page URL boundary', () => {
  it.each([
    'https://www.douyin.com.evil.test/',
    'https://evil.test/path/douyin.com',
    'https://evil.test/?redirect=https://www.douyin.com',
    'https://evil-douyin.com/',
    'https://.douyin.com/',
    'http://www.douyin.com/',
    'https://user:pass@www.douyin.com/',
    'https://www.douyin.com:444/',
  ])('rejects existing foreign/unsafe URL and opens a trusted new search tab: %s', async url => {
    const run = await runKeyword([session()], undefined, [url]);
    expect(run.existingNavigations).toEqual([]);
    expect(run.newPages).toBe(1);
    expect(run.newNavigations).toEqual(['https://www.douyin.com/search/fixture-keyword?type=video']);
    expect(run.result).toMatchObject({ ok: false, error: 'FIXTURE_SEARCH_BOUNDARY' });
  });
  it('skips an earlier foreign page and reuses the later trusted HTTPS page', async () => {
    const run = await runKeyword([session()], undefined, ['https://evil.test/?douyin.com', 'https://creator.douyin.com/']);
    expect(run.existingNavigations).toEqual(['https://creator.douyin.com/']);
    expect(run.newPages).toBe(0);
    expect(run.newNavigations).toEqual([]);
  });
});


describe('production Douyin page URL predicate', () => {
  it.each([
    'https://douyin.com/', 'https://www.douyin.com/', 'https://creator.douyin.com/path?q=1',
    'HTTPS://WWW.DOUYIN.COM/', 'https://www.douyin.com:443/',
  ])('admits HTTPS pages on the exact DNS boundary and default port: %s', url => {
    expect(admission.isDouyinPageUrl(url)).toBe(true);
  });
  it.each([
    'https://www.douyin.com.evil.test/', 'https://evil-douyin.com/', 'https://douyin.comevil.test/',
    'https://evil.test/path/douyin.com', 'https://evil.test/?next=https://www.douyin.com',
    'https://douyin.com@evil.test/', 'https://user@douyin.com/', 'https://user:pass@douyin.com/',
    'http://douyin.com/', 'ftp://douyin.com/', 'javascript:alert("douyin.com")',
    'https://douyin.com:444/', 'https://.douyin.com/', 'https://a..douyin.com/',
    'https://douyin.com./', 'https://foo-.douyin.com/', 'https://douyin.com%00.evil.test/',
    '//douyin.com/', '.douyin.com', '', null, undefined, {},
  ])('rejects malformed, foreign or unsafe page URL %j', url => {
    expect(admission.isDouyinPageUrl(url)).toBe(false);
  });
  it('keeps cookie domain leading-dot admission distinct from page hostname admission', () => {
    expect(admission.isDouyinDomain('.douyin.com')).toBe(true);
    expect(admission.isDouyinPageUrl('https://.douyin.com/')).toBe(false);
  });
});
