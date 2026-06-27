# Line02 采集/私信 handler 转 spawn 外部 .cjs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `keyword-search-douyin`（采集）和 `douyin-dm-outreach`（私信）两个 agent handler 的生产路径改成 spawn 外部 `publishers/*.cjs` 独立进程，绕开 pkg 二进制内 require playwright 的 "Invalid host defined options" 崩溃。

**Architecture:** 照 PR#923（qr-bind-burner）同构。每个 handler：生产路径（无注入）→ spawn 外部 `.cjs`（独立 Node 进程 `require('playwright-core')` 从真实 FS 加载）；测试路径（注入 launcher/page）→ 走内部逻辑保旧单测绿。`.cjs` 末行 stdout 输出 JSON，handler 解析。

**Tech Stack:** TypeScript, Node child_process.spawn, playwright-core, vitest, pkg。

工作目录：worktree `~/worktrees/zenithjoy/line02-collect-dm-spawn-cjs`，分支 `cp-06271057-line02-collect-dm-spawn-cjs`。所有命令在 `services/agent/` 下跑。

---

## Task 1: keyword-search-douyin → spawn 外部 .cjs

**Files:**
- Create: `services/agent/publishers/keyword-search-douyin.cjs`
- Modify: `services/agent/src/handlers/keyword-search-douyin.ts`
- Test: `services/agent/src/handlers/__tests__/keyword-search-douyin.test.ts`（追加 describe，旧两个测试不动）

- [ ] **Step 1: 写失败的回归测试（commit-1）**

在 `keyword-search-douyin.test.ts` 末尾追加（顶部 import 补 `EventEmitter`）：

```ts
import { EventEmitter } from 'node:events';
import { resolveKeywordSearchScript } from '../keyword-search-douyin';

describe('keyword-search-douyin — spawn 外部 .cjs（生产）[BEHAVIOR]', () => {
  it('源码生产路径 spawn 外部 .cjs（绕 pkg+playwright 崩溃）', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/spawn/);
    expect(src).toMatch(/keyword-search-douyin\.cjs/);
  });

  it('resolveKeywordSearchScript 指向 publishers/keyword-search-douyin.cjs', () => {
    expect(resolveKeywordSearchScript()).toMatch(/[\\/]publishers[\\/]keyword-search-douyin\.cjs$/);
  });

  it('publishers/keyword-search-douyin.cjs 文件真实存在', () => {
    expect(fs.existsSync(resolveKeywordSearchScript())).toBe(true);
  });
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

describe('keyword-search-douyin — spawn 路径 argv [BEHAVIOR]', () => {
  function makeFakeProc(stdoutLine: string) {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => { proc.stdout.emit('data', Buffer.from(stdoutLine + '\n')); proc.emit('close', 0); }, 0);
    return proc;
  }

  it('未注入 launcher/loader → spawn .cjs，argv=[脚本,keyword,cdpPort,maxVideos]，返回末行 JSON', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(
      makeFakeProc(JSON.stringify({ ok: true, keyword: '装修', video_urls: ['https://www.douyin.com/video/9'] })) as unknown as ReturnType<typeof spawn>,
    );

    const result = await searchDouyinVideosByKeyword('装修', { cdpPort: 19222, maxVideosPerKeyword: 5 });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [nodeExe, argv] = spawnMock.mock.calls[0];
    expect(nodeExe).toBeTruthy();
    expect(argv![0]).toMatch(/keyword-search-douyin\.cjs$/);
    expect(argv![1]).toBe('装修');
    expect(argv![2]).toBe('19222');
    expect(argv![3]).toBe('5');
    expect(result).toMatchObject({ ok: true, keyword: '装修', video_urls: ['https://www.douyin.com/video/9'] });
  });
});
```

> 注意：`searchDouyinVideosByKeyword` 已在文件顶部 import。新加 `resolveKeywordSearchScript`、`EventEmitter` import。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent && npx vitest run src/handlers/__tests__/keyword-search-douyin.test.ts`
Expected: FAIL —`resolveKeywordSearchScript` 未导出 / .cjs 不存在 / 源码无 spawn。

- [ ] **Step 3: 新建 publishers/keyword-search-douyin.cjs**

```js
#!/usr/bin/env node
'use strict';
/**
 * keyword-search-douyin.cjs — 主号 CDP 搜抖音关键词取热门视频 URL（外部进程）
 *
 * pkg 二进制内 require/import playwright-core 在 Node18+ 报 "Invalid host defined options"，
 * 本脚本作为独立 Node 进程从真实 FS require('playwright-core') 绕过（同 qr-bind-douyin-burner.cjs）。
 *
 * Usage:  node keyword-search-douyin.cjs <keyword> [cdpPort=19222] [maxVideos=5]
 * Output: 末行 stdout JSON → { ok, keyword, video_urls, error? }；stderr 打日志
 */
const { chromium } = require('playwright-core');

const [, , keyword = '', cdpPortStr = '19222', maxVideosStr = '5'] = process.argv;
const cdpPort = parseInt(cdpPortStr, 10) || 19222;
const maxVideos = parseInt(maxVideosStr, 10) || 5;

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
}

async function main() {
  if (!keyword) {
    emit({ ok: false, keyword, video_urls: [], error: 'MISSING_KEYWORD' });
    process.exit(1);
    return;
  }
  let browser = null;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      emit({ ok: false, keyword, video_urls: [], error: 'NO_CDP_CONTEXT' });
      process.exit(1);
      return;
    }
    const ctx = contexts[0];
    const page = await ctx.newPage();
    try {
      const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page
        .waitForSelector('[data-e2e="search-video-card"], [class*="video-card"], a[href*="/video/"]', { timeout: 15000 })
        .catch(() => null);
      const videoUrls = await page.evaluate((max) => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        const seen = new Set();
        const results = [];
        for (const a of anchors) {
          const href = a.href;
          const m = href.match(/douyin\.com\/video\/(\d+)/);
          if (m && !seen.has(m[1])) {
            seen.add(m[1]);
            results.push(`https://www.douyin.com/video/${m[1]}`);
            if (results.length >= max) break;
          }
        }
        return results;
      }, maxVideos);
      emit({ ok: true, keyword, video_urls: videoUrls });
      process.exit(0);
    } finally {
      await page.close().catch(() => null);
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    process.stderr.write(`[keyword-search-douyin] keyword="${keyword}" error: ${msg}\n`);
    emit({ ok: false, keyword, video_urls: [], error: msg });
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

main().catch((e) => {
  emit({ ok: false, keyword, video_urls: [], error: String(e) });
  process.exit(1);
});
```

- [ ] **Step 4: 改 keyword-search-douyin.ts 加 spawn 生产路径**

顶部 import 区把第 8 行 `import path from 'node:path';` 后补两行：

```ts
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { loadChromium, type ChromiumLike, type LoadChromiumOptions } from '../shared/playwright-launcher';
```

在 `searchDouyinVideosByKeyword` 函数体最前面（第 27 行注释前）插入生产 spawn 分支：

```ts
export async function searchDouyinVideosByKeyword(
  keyword: string,
  options: KeywordSearchOptions = {},
): Promise<KeywordSearchResult> {
  // 生产路径：无注入 → spawn 外部 .cjs（绕 pkg+playwright 崩溃）。
  // 测试路径：注入 chromiumLauncher/chromiumLoader → 走下方内部 loadChromium 逻辑（保旧单测绿）。
  if (!options.chromiumLauncher && !options.chromiumLoader) {
    return spawnKeywordSearchProcess(keyword, options);
  }

  // 共享底座：优先 playwright-core（包里打进的那个）...（以下原内部逻辑不动）
  const chromium = (await loadChromium(options)) as ChromiumLike & {
```

在文件末尾（最后 `}` 之后）追加 spawn helper：

```ts
// 解析外部脚本路径（与 qr-bind-douyin-burner resolveBurnerScript 同款查找）
export function resolveKeywordSearchScript(): string {
  const beside = path.join(path.dirname(process.execPath), 'publishers', 'keyword-search-douyin.cjs');
  if (fs.existsSync(beside)) return beside;
  return path.resolve(__dirname, '..', '..', 'publishers', 'keyword-search-douyin.cjs');
}

function resolveNodeExe(): string {
  const env = process.env.ZJ_NODE_EXE;
  if (env && fs.existsSync(env)) return env;
  return 'node';
}

// 生产路径：spawn 外部 Node 进程跑 .cjs，读末行 JSON 当结果。
function spawnKeywordSearchProcess(
  keyword: string,
  options: KeywordSearchOptions,
): Promise<KeywordSearchResult> {
  const scriptPath = resolveKeywordSearchScript();
  const nodeExe = resolveNodeExe();
  const cdpPort = options.cdpPort ?? parseInt(process.env.DOUYIN_CDP_PORT ?? '19222');
  const maxVideos = options.maxVideosPerKeyword ?? 5;
  const args = [scriptPath, keyword, String(cdpPort), String(maxVideos)];

  return new Promise<KeywordSearchResult>((resolve) => {
    let stdout = '';
    const proc = spawn(nodeExe, args, { env: { ...process.env } });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { console.log('[keyword-search-douyin]', d.toString().trimEnd()); });
    proc.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(lastLine) as KeywordSearchResult);
      } catch {
        resolve({ ok: false, keyword, video_urls: [], error: `result parse failed: ${lastLine || '(no output)'}` });
      }
    });
    proc.on('error', (err: Error) => {
      resolve({ ok: false, keyword, video_urls: [], error: `spawn failed: ${err.message}` });
    });
  });
}
```

- [ ] **Step 5: 跑测试确认通过（含旧两个注入式测试）**

Run: `cd services/agent && npx vitest run src/handlers/__tests__/keyword-search-douyin.test.ts`
Expected: PASS（旧 2 个注入测试 + 新 4 个 spawn 测试全绿）。

- [ ] **Step 6: 两次 commit（TDD 顺序）**

```bash
# commit-1：失败测试（Step 1 写的）—— 若已混着 staged，分两次 add
cd ~/worktrees/zenithjoy/line02-collect-dm-spawn-cjs
git add services/agent/src/handlers/__tests__/keyword-search-douyin.test.ts
git commit -m "test(line02): keyword-search spawn 外部 .cjs 回归守卫（failing）"
# commit-2：实现
git add services/agent/publishers/keyword-search-douyin.cjs services/agent/src/handlers/keyword-search-douyin.ts
git commit -m "fix(line02): keyword-search 生产改 spawn publishers/keyword-search-douyin.cjs 绕 pkg+playwright 崩溃"
```

---

## Task 2: douyin-dm-outreach → spawn 外部 .cjs（删 createRealDmPage 死代码）

**Files:**
- Create: `services/agent/publishers/douyin-dm-outreach.cjs`
- Modify: `services/agent/src/handlers/douyin-dm-outreach.ts`
- Test: `services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts`（改第 1 个断言 + 追加 spawn 测试）

- [ ] **Step 1: 写失败的回归测试（commit-1）**

改 `douyin-dm-outreach.test.ts`：把第 29-35 行那个 `it('源码改走共享 loadChromium...')` 整块替换为：

```ts
  it('源码生产路径 spawn 外部 .cjs，删除 createRealDmPage 内联 playwright', () => {
    const src = fs.readFileSync(HANDLER_PATH, 'utf8');
    expect(src).toMatch(/spawn/);
    expect(src).toMatch(/douyin-dm-outreach\.cjs/);
    // createRealDmPage 已删（真机逻辑搬进 .cjs），不再 binary 内 loadChromium
    expect(src).not.toMatch(/loadChromium/);
    expect(src).not.toMatch(/createRealDmPage/);
  });
```

文件末尾追加（顶部 import 补 `EventEmitter` + `resolveDmOutreachScript`）：

```ts
import { EventEmitter } from 'node:events';
import { resolveDmOutreachScript } from '../douyin-dm-outreach';

describe('douyin-dm-outreach — spawn 外部 .cjs（生产）[BEHAVIOR]', () => {
  it('resolveDmOutreachScript 指向 publishers/douyin-dm-outreach.cjs', () => {
    expect(resolveDmOutreachScript()).toMatch(/[\\/]publishers[\\/]douyin-dm-outreach\.cjs$/);
  });

  it('publishers/douyin-dm-outreach.cjs 文件真实存在', () => {
    expect(fs.existsSync(resolveDmOutreachScript())).toBe(true);
  });
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

describe('douyin-dm-outreach — spawn 路径 argv [BEHAVIOR]', () => {
  function makeFakeProc(stdoutLine: string) {
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setTimeout(() => { proc.stdout.emit('data', Buffer.from(stdoutLine + '\n')); proc.emit('close', 0); }, 0);
    return proc;
  }

  it('未注入 page → spawn .cjs，argv=[脚本,profile,message,label,udd]，返回末行 JSON', async () => {
    const { spawn } = await import('node:child_process');
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(
      makeFakeProc(JSON.stringify({ ok: true, status: 'sent', account_label: 'b1', profile_url: 'https://www.douyin.com/user/x' })) as unknown as ReturnType<typeof spawn>,
    );

    const r = await handleDouyinDmOutreach({ profile_url: 'https://www.douyin.com/user/x', message: '你好', account_label: 'b1' });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [nodeExe, argv] = spawnMock.mock.calls[0];
    expect(nodeExe).toBeTruthy();
    expect(argv![0]).toMatch(/douyin-dm-outreach\.cjs$/);
    expect(argv![1]).toBe('https://www.douyin.com/user/x');
    expect(argv![2]).toBe('你好');
    expect(argv![3]).toBe('b1');
    expect(r).toMatchObject({ ok: true, status: 'sent' });
  });
});
```

> 注意：注入式三态测试（第 37-63 行 `sent`/`limited`/`failed`）传 `{ page }`，走内部编排，**不动，保持绿**。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd services/agent && npx vitest run src/handlers/__tests__/douyin-dm-outreach.test.ts`
Expected: FAIL —`resolveDmOutreachScript` 未导出 / .cjs 不存在 / 源码仍含 loadChromium+createRealDmPage。

- [ ] **Step 3: 新建 publishers/douyin-dm-outreach.cjs**

```js
#!/usr/bin/env node
'use strict';
/**
 * douyin-dm-outreach.cjs — 抖音 burner 号私信主动触达（外部进程，承载完整三态编排）
 *
 * pkg 二进制内 require/import playwright-core 在 Node18+ 报 "Invalid host defined options"，
 * 本脚本作为独立 Node 进程从真实 FS require('playwright-core') 绕过（同 qr-bind-douyin-burner.cjs）。
 *
 * Usage:  node douyin-dm-outreach.cjs <profile_url> <message> <account_label> [user_data_dir_root]
 * Output: 末行 stdout JSON → { ok, status, account_label, profile_url, error_code?, error? }；stderr 打日志
 *   status: sent=已发出 / limited=仅互关受限 / failed=失败
 */
const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');

const [, , profileUrl = '', message = '', accountLabel = '', userDataDirRootArg = ''] = process.argv;

// burner profile user-data-dir，与 qr-bind-douyin-burner getBurnerUserDataDir 同约定
function getBurnerUserDataDir() {
  if (userDataDirRootArg) return path.join(userDataDirRootArg, accountLabel);
  if (process.platform === 'win32') {
    return path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel);
  }
  return path.join(os.homedir(), '.zenithjoy-agent', 'chrome-profile', 'douyin-burner', accountLabel);
}

// 抖音私信按钮（Semi UI）+ contenteditable 输入框
const DM_BUTTON_SELECTORS = [
  'button.semi-button-secondary:has-text("私信")',
  'button:has-text("私信")',
  'a[href*="/message"]',
];
const EDITOR_SELECTOR = 'div[contenteditable="true"]';

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
}

async function main() {
  if (!profileUrl) {
    emit({ ok: false, status: 'failed', account_label: accountLabel, error_code: 'MISSING_PROFILE_URL', error: 'profile_url 必填' });
    process.exit(1);
    return;
  }
  if (!message) {
    emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'MISSING_MESSAGE', error: 'message 必填' });
    process.exit(1);
    return;
  }

  const userDataDir = getBurnerUserDataDir();
  let context = null;
  try {
    // 多级浏览器 fallback：bundled chromium → system Chrome → system Edge（headful 真发）
    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    for (const opts of [
      { headless: false, args: launchArgs },
      { headless: false, channel: 'chrome', args: launchArgs },
      { headless: false, channel: 'msedge', args: launchArgs },
    ]) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, opts);
        process.stderr.write(`[douyin-dm-outreach] 已 launch (${JSON.stringify(opts)})\n`);
        break;
      } catch (e) {
        process.stderr.write(`[douyin-dm-outreach] launch 失败 ${JSON.stringify(opts)}: ${e.message}\n`);
      }
    }
    if (!context) {
      emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'PAGE_LAUNCH_FAILED', error: '无法启动浏览器：bundled chromium / system chrome / system edge 均不可用' });
      process.exit(1);
      return;
    }

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // 进主页 + 模拟滑动随机停留降风控
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await page.mouse.wheel(0, 600).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500 + (message.length % 5) * 300));

    // 点私信按钮；不可点 = 仅互关受限 → 如实标 limited（禁止假 sent）
    let canDm = false;
    for (const sel of DM_BUTTON_SELECTORS) {
      const loc = page.locator(sel).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isEnabled())) {
          await loc.click({ timeout: 5000 });
          canDm = true;
          break;
        }
      } catch {
        // 该 selector 不可点，试下一个
      }
    }
    if (!canDm) {
      emit({ ok: false, status: 'limited', account_label: accountLabel, profile_url: profileUrl });
      process.exit(0);
      return;
    }

    // 输入文案 + 回车
    const editor = page.locator(EDITOR_SELECTOR).first();
    await editor.click({ timeout: 5000 });
    await editor.fill(message);
    await page.keyboard.press('Enter');

    // 气泡出现 = 真发出
    let sent = false;
    try {
      const bubble = page.locator(`text=${message}`).first();
      await bubble.waitFor({ state: 'visible', timeout: 5000 });
      sent = true;
    } catch {
      sent = false;
    }
    if (sent) {
      emit({ ok: true, status: 'sent', account_label: accountLabel, profile_url: profileUrl });
      process.exit(0);
      return;
    }
    emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'NO_BUBBLE', error: '回车后未见消息气泡' });
    process.exit(0);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    process.stderr.write(`[douyin-dm-outreach] error: ${msg}\n`);
    emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'SEND_ERROR', error: msg });
    process.exit(1);
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

main().catch((e) => {
  emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'SEND_ERROR', error: String(e) });
  process.exit(1);
});
```

- [ ] **Step 4: 改 douyin-dm-outreach.ts —— 加 spawn、删 createRealDmPage 死代码**

(a) 顶部 import：把第 15-17 行替换为：

```ts
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
```
（删 `import os from 'node:os';` 和 `import { loadChromium } from '../shared/playwright-launcher';` —— 删 createRealDmPage 后二者无引用。）

(b) 删除 `getBurnerUserDataDir` 函数（第 76-89 行整块，连同上方第 76 行注释）—— 仅 createRealDmPage 用，搬进 .cjs。

(c) `handleDouyinDmOutreach` 里第 108-120 行那段 `let page: DmPage; try { page = options.page ?? (await createRealDmPage(...)); } catch {...}` 替换为：

```ts
  // 生产路径：无注入 page → spawn 外部 .cjs（完整三态编排在 .cjs 内，绕 pkg+playwright 崩溃）。
  // 测试路径：注入 page → 走下方内部三态编排（保旧单测绿）。
  if (!options.page) {
    return spawnDmOutreachProcess(payload, options);
  }
  const page: DmPage = options.page;
```

(d) 删除整个 `createRealDmPage` 函数（第 152-226 行）及其下方的 `RealLocator` / `RealPage` / `RealContext` 三个 interface（第 228-247 行）。

(e) 文件末尾追加 spawn helper：

```ts
// 解析外部脚本路径（与 qr-bind-douyin-burner resolveBurnerScript 同款查找）
export function resolveDmOutreachScript(): string {
  const beside = path.join(path.dirname(process.execPath), 'publishers', 'douyin-dm-outreach.cjs');
  if (fs.existsSync(beside)) return beside;
  return path.resolve(__dirname, '..', '..', 'publishers', 'douyin-dm-outreach.cjs');
}

function resolveNodeExe(): string {
  const env = process.env.ZJ_NODE_EXE;
  if (env && fs.existsSync(env)) return env;
  return 'node';
}

// 生产路径：spawn 外部 Node 进程跑 .cjs，读末行 JSON 当结果。
function spawnDmOutreachProcess(
  payload: DmOutreachPayload,
  options: DmOutreachOptions,
): Promise<DmOutreachResult> {
  const scriptPath = resolveDmOutreachScript();
  const nodeExe = resolveNodeExe();
  const args = [scriptPath, payload.profile_url, payload.message, payload.account_label, options.userDataDirRoot ?? ''];

  return new Promise<DmOutreachResult>((resolve) => {
    let stdout = '';
    const proc = spawn(nodeExe, args, { env: { ...process.env } });
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { console.log('[douyin-dm-outreach]', d.toString().trimEnd()); });
    proc.on('close', () => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve(JSON.parse(lastLine) as DmOutreachResult);
      } catch {
        resolve({ ok: false, status: 'failed', account_label: payload.account_label, profile_url: payload.profile_url, error_code: 'SPAWN_PARSE_FAILED', error: `result parse failed: ${lastLine || '(no output)'}` });
      }
    });
    proc.on('error', (err: Error) => {
      resolve({ ok: false, status: 'failed', account_label: payload.account_label, profile_url: payload.profile_url, error_code: 'SPAWN_FAILED', error: `spawn failed: ${err.message}` });
    });
  });
}
```

> `DmOutreachOptions` 接口里的 `channel`/`headless` 字段保留（.cjs 自带多级 fallback，handler 不再用，但留着不碍事，避免改调用方类型）。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd services/agent && npx vitest run src/handlers/__tests__/douyin-dm-outreach.test.ts`
Expected: PASS（注入式三态测试 + mapDmStatusToFeishu + 新 spawn 测试全绿）。

- [ ] **Step 6: 两次 commit（TDD 顺序）**

```bash
cd ~/worktrees/zenithjoy/line02-collect-dm-spawn-cjs
git add services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts
git commit -m "test(line02): dm-outreach spawn 外部 .cjs 回归守卫（failing）"
git add services/agent/publishers/douyin-dm-outreach.cjs services/agent/src/handlers/douyin-dm-outreach.ts
git commit -m "fix(line02): dm-outreach 生产改 spawn publishers/douyin-dm-outreach.cjs，删 createRealDmPage 死代码"
```

---

## Task 3: bump 版本 2.0.37 + 全量验证

**Files:**
- Modify: `services/agent/package.json`（version）

- [ ] **Step 1: bump 版本**

把 `services/agent/package.json` 的 `"version": "2.0.36"` 改为 `"version": "2.0.37"`。

- [ ] **Step 2: 全量单测 + typecheck**

Run:
```bash
cd services/agent
npx vitest run
npm run typecheck
```
Expected: 全 PASS，tsc 无错（注意：删 import 后无 unused，无报错）。

- [ ] **Step 3: 确认 .cjs 进打包路径**

Run: `grep -n "cp -r publishers" .github/../scripts/build-install-pack.sh 2>/dev/null || grep -rn "cp -r publishers" services/agent/scripts/build-install-pack.sh`
Expected: 命中 `cp -r publishers/ "$PACK_DIR/publishers/"` —— 新两个 .cjs 自动随包。

- [ ] **Step 4: commit**

```bash
cd ~/worktrees/zenithjoy/line02-collect-dm-spawn-cjs
git add services/agent/package.json
git commit -m "chore(agent): bump 2.0.36 → 2.0.37（采集/私信 spawn .cjs 修复）"
```

---

## Self-Review

- **Spec coverage**：单元1 keyword-search.cjs=Task1 / 单元2 dm-outreach.cjs=Task2 / 单元3 keyword handler=Task1 / 单元4 dm handler=Task2 / 版本=Task3 / 打包=Task3 Step3 / 测试策略（旧单测绿+spawn守卫）=Task1/2。全覆盖。
- **不做项**：未碰 handleCrawlCommentsBurner / loadChromium（keyword 仍用）/ 频控-AI-定时。✓
- **Type 一致**：`resolveKeywordSearchScript`/`resolveDmOutreachScript`/`spawnKeywordSearchProcess`/`spawnDmOutreachProcess` 命名前后一致；返回类型 `KeywordSearchResult`/`DmOutreachResult` 与现有 export 一致。
- **Placeholder**：无 TBD/TODO，所有 step 含真实代码与命令。
