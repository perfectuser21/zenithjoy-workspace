# line04 preflight 自动修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 空白 Windows 机器装完 Agent 后，line04 模块自动安装微信 4.1.8 和 pywinauto，无需用户手动操作。

**Architecture:** 在 `preflight.ts` 里新增 `autoRepair()` 函数，首轮检测失败时自动修复（下载安装微信、pip install pywinauto），修复后重检。另新增 `checkWechatRunning()` 软检测（不阻塞模块启动，仅提示用户打开微信）。

**Tech Stack:** Node.js `https`、`child_process.spawn`、`fs`、`os`；vitest mock 隔离副作用。

---

## 文件结构

- **修改：** `services/agent/modules/line04/preflight.ts`（276 行 → 约 430 行）
- **修改：** `services/agent/modules/line04/__tests__/preflight.test.ts`（100 行 → 约 220 行）
- **修改：** `services/agent/modules/line04/manifest.json`（version bump 1.0.1 → 1.0.2）
- **修改：** `services/agent/package.json`（version bump 2.0.3 → 2.0.4）
- **修改：** `apps/api/src/services/walking-skeleton.service.ts`（line04-wechat-cs required_version 1.0.1 → 1.0.2）
- **修改：** `.github/workflows/scripts/smoke/heartbeat-module-health-smoke.sh`（版本断言更新）
- **修改：** `apps/api/tests/routes/heartbeat-modules.test.ts`（版本断言更新）
- **修改：** `apps/api/src/routes/__tests__/heartbeat-payload-passthrough.test.ts`（mock 版本更新）

---

## Task 1：修复 `getModulePython()` — 回退到 ZENITHJOY_CORE_DIR

**Files:**
- Modify: `services/agent/modules/line04/__tests__/preflight.test.ts`（在末尾追加）
- Modify: `services/agent/modules/line04/preflight.ts`（修改 `getModulePython` 函数）

- [ ] **Step 1: 写失败测试（追加到 preflight.test.ts 末尾）**

```typescript
import { vi } from 'vitest';
import fs from 'node:fs';

// 在文件末尾追加这个 describe 块：
describe('getModulePython — ZENITHJOY_CORE_DIR 回退', () => {
  afterEach(() => {
    delete process.env.ZENITHJOY_CORE_DIR;
    vi.restoreAllMocks();
  });

  it('module 自带 python-embedded 优先', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('python-embedded') && String(p).includes('/moduleDir/')
    );
    const result = getModulePython('/moduleDir');
    expect(result).toBe('/moduleDir/python-embedded/python.exe');
  });

  it('module 无 embedded 时回退到 ZENITHJOY_CORE_DIR', () => {
    process.env.ZENITHJOY_CORE_DIR = '/coreDir';
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).includes('/coreDir/python-embedded')
    );
    const result = getModulePython('/moduleDir');
    expect(result).toBe('/coreDir/python-embedded/python.exe');
  });

  it('两者都没有时 Windows 回退到 "python"', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const result = getModulePython('/moduleDir');
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    expect(result).toBe('python');
  });
});
```

- [ ] **Step 2: 在 preflight.test.ts 顶部 import 里加 `getModulePython`**

```typescript
import {
  isWechatVersionSupported,
  parseVersionParts,
  parseWechatVersionFromRegOutput,
  wechatFixGuide,
  pywinautoFixGuide,
  memoryFixGuide,
  WECHAT_DOWNLOAD_URL,
  runPreflight,
  getModulePython,   // ← 新增
} from '../preflight';
```

- [ ] **Step 3: 运行测试确认失败**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -20
```

期望：`getModulePython` 相关测试 FAIL（函数逻辑未更新）

- [ ] **Step 4: 修改 `preflight.ts` 的 `getModulePython()`**

将现有：
```typescript
export function getModulePython(moduleDir: string): string {
  const embedded = path.join(moduleDir, 'python-embedded', 'python.exe');
  if (fs.existsSync(embedded)) return embedded;
  return process.platform === 'win32' ? 'python' : 'python3';
}
```

替换为：
```typescript
export function getModulePython(moduleDir: string): string {
  const embedded = path.join(moduleDir, 'python-embedded', 'python.exe');
  if (fs.existsSync(embedded)) return embedded;
  const coreDir = process.env.ZENITHJOY_CORE_DIR;
  if (coreDir) {
    const coreEmbedded = path.join(coreDir, 'python-embedded', 'python.exe');
    if (fs.existsSync(coreEmbedded)) return coreEmbedded;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}
```

- [ ] **Step 5: 运行测试确认通过**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -20
```

期望：全部 PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
git add services/agent/modules/line04/__tests__/preflight.test.ts \
        services/agent/modules/line04/preflight.ts
git commit -m "test(line04): getModulePython ZENITHJOY_CORE_DIR 回退 failing test + fix

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2：新增 `checkWechatRunning()` 软检测

**Files:**
- Modify: `services/agent/modules/line04/__tests__/preflight.test.ts`
- Modify: `services/agent/modules/line04/preflight.ts`

- [ ] **Step 1: 写失败测试（追加到 preflight.test.ts）**

```typescript
import { execSync } from 'node:child_process';

describe('checkWechatRunning — 微信进程检测（软检测）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('非 Windows 跳过，返回 ok:true', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });

  it('tasklist 输出含 WeChat.exe → ok:true 无 fixGuide', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.spyOn(childProcess, 'execSync').mockReturnValue(
      'WeChat.exe                    1234 Console                    1     12,345 K\r\n' as any
    );
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toBeUndefined();
  });

  it('tasklist 无 WeChat.exe → ok:true + fixGuide 含"请打开微信"', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.spyOn(childProcess, 'execSync').mockReturnValue('INFO: 没有运行的任务匹配指定标准。\r\n' as any);
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toContain('请打开微信');
  });

  it('execSync 抛出（WeChat 不存在）→ ok:true + fixGuide', () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    vi.spyOn(childProcess, 'execSync').mockImplementation(() => { throw new Error('cmd fail'); });
    const r = checkWechatRunning();
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
    expect(r.ok).toBe(true);
    expect(r.fixGuide).toContain('请打开微信');
  });
});
```

在 import 区加：
```typescript
import * as childProcess from 'node:child_process';
import { checkWechatRunning } from '../preflight';
```

- [ ] **Step 2: 运行确认失败**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

期望：`checkWechatRunning` 相关 FAIL（函数不存在）

- [ ] **Step 3: 在 preflight.ts 里实现 `checkWechatRunning()`（放在 `checkMemory` 后面）**

```typescript
// 检测 4（软检测）：微信进程是否在跑。
// 非 Windows 跳过。ok 始终为 true——未跑只给用户提示，不阻塞模块激活。
export function checkWechatRunning(): CheckOutcome {
  if (process.platform !== 'win32') return { ok: true, skipped: true };
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq WeChat.exe" /FO LIST', {
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (/WeChat\.exe/i.test(out)) return { ok: true };
  } catch {
    // tasklist 失败视同未找到
  }
  return {
    ok: true,
    fixGuide: '微信未运行，请打开微信并登录，Agent 将在 30 秒内自动连接。',
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
git add services/agent/modules/line04/__tests__/preflight.test.ts \
        services/agent/modules/line04/preflight.ts
git commit -m "test(line04): checkWechatRunning 软检测 failing test + impl

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3：新增 `downloadFile()` + `installWeChat()`

**Files:**
- Modify: `services/agent/modules/line04/__tests__/preflight.test.ts`
- Modify: `services/agent/modules/line04/preflight.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import https from 'node:https';
import * as childProcess from 'node:child_process';

describe('installWeChat — 下载并静默安装微信 4.1.8', () => {
  afterEach(() => vi.restoreAllMocks());

  it('调用 spawn 时参数含 /S 静默标志', async () => {
    // mock downloadFile（通过 mock https.get）
    vi.spyOn(https, 'get').mockImplementation((_url, cb: any) => {
      const fakeReq = { on: vi.fn() } as any;
      // 模拟写空文件
      const fakeRes = { pipe: vi.fn(), on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); } } as any;
      setImmediate(() => cb(fakeRes));
      return fakeReq;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {} as any; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnMock = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installWeChat(os.tmpdir());

    const spawnArgs = spawnMock.mock.calls[0];
    expect(String(spawnArgs[0])).toContain('WeChatWin_4.1.8.exe');
    expect(spawnArgs[1]).toContain('/S');
  });

  it('安装后 taskkill WeChat.exe', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url, cb: any) => {
      const fakeReq = { on: vi.fn() } as any;
      const fakeRes = { pipe: vi.fn(), on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); } } as any;
      setImmediate(() => cb(fakeRes));
      return fakeReq;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {} as any; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnMock = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installWeChat(os.tmpdir());

    const taskkillCall = spawnMock.mock.calls.find((c) => String(c[0]).toLowerCase().includes('taskkill'));
    expect(taskkillCall).toBeDefined();
    const joined = [taskkillCall![0], ...(taskkillCall![1] ?? [])].join(' ');
    expect(joined.toLowerCase()).toContain('wechat.exe');
  });
});
```

在 import 区追加：
```typescript
import https from 'node:https';
import { installWeChat } from '../preflight';
```

- [ ] **Step 2: 运行确认失败**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: 在 preflight.ts 实现 `downloadFile()` 和 `installWeChat()`**

在文件顶部 import 区补充：
```typescript
import https from 'node:https';
import { spawnSync } from 'node:child_process';
```

在 `checkWechatRunning` 后面追加：

```typescript
// ---------- 自动修复：下载工具 ----------

export function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        res.pipe(file);
        res.on('end', () => file.close(() => resolve()));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

// ---------- 自动修复：安装微信 ----------

export async function installWeChat(downloadDir: string): Promise<void> {
  const installer = path.join(downloadDir, 'WeChatWin_4.1.8.exe');
  await downloadFile(WECHAT_DOWNLOAD_URL, installer);
  // 腾讯自研包静默参数是 /S（不是 NSIS 的 /VERYSILENT）
  spawnSync(installer, ['/S'], { windowsHide: true, timeout: 120_000 });
  // 静默安装后微信会自动启动，需关掉等用户手动登录
  spawnSync('taskkill', ['/F', '/IM', 'WeChat.exe'], {
    windowsHide: true,
    stdio: 'ignore',
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
git add services/agent/modules/line04/__tests__/preflight.test.ts \
        services/agent/modules/line04/preflight.ts
git commit -m "test(line04): installWeChat /S 静默安装 failing test + impl

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4：新增 `installPywinauto()`

**Files:**
- Modify: `services/agent/modules/line04/__tests__/preflight.test.ts`
- Modify: `services/agent/modules/line04/preflight.ts`

- [ ] **Step 1: 写失败测试**

```typescript
describe('installPywinauto — get-pip + pip install 清华源', () => {
  afterEach(() => vi.restoreAllMocks());

  it('先跑 get-pip.py 再 pip install pywinauto', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url, cb: any) => {
      const fakeReq = { on: vi.fn() } as any;
      const fakeRes = { pipe: vi.fn(), on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); } } as any;
      setImmediate(() => cb(fakeRes));
      return fakeReq;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {} as any; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnMock = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installPywinauto('python.exe', os.tmpdir());

    const calls = spawnMock.mock.calls.map((c) => [c[0], ...(c[1] ?? [])].join(' '));
    expect(calls.some((c) => c.includes('get-pip.py'))).toBe(true);
    expect(calls.some((c) => c.includes('pywinauto'))).toBe(true);
  });

  it('pip install 使用清华镜像源', async () => {
    vi.spyOn(https, 'get').mockImplementation((_url, cb: any) => {
      const fakeReq = { on: vi.fn() } as any;
      const fakeRes = { pipe: vi.fn(), on: (ev: string, fn: () => void) => { if (ev === 'end') fn(); } } as any;
      setImmediate(() => cb(fakeRes));
      return fakeReq;
    });
    vi.spyOn(fs, 'createWriteStream').mockReturnValue({
      on: (_ev: string, fn: () => void) => { fn(); return {} as any; },
      close: (fn: () => void) => fn(),
    } as any);

    const spawnMock = vi.spyOn(childProcess, 'spawnSync').mockReturnValue({ status: 0 } as any);

    await installPywinauto('python.exe', os.tmpdir());

    const pipCall = spawnMock.mock.calls.find((c) => (c[1] ?? []).includes('pywinauto'));
    const args = (pipCall?.[1] ?? []).join(' ');
    expect(args).toContain('tuna.tsinghua.edu.cn');
  });
});
```

在顶部 import 追加：
```typescript
import { installPywinauto } from '../preflight';
```

- [ ] **Step 2: 运行确认失败**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: 在 preflight.ts 实现 `installPywinauto()`（追加在 `installWeChat` 后）**

```typescript
export const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
export const PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/';

export async function installPywinauto(pythonPath: string, downloadDir: string): Promise<void> {
  const getPipScript = path.join(downloadDir, 'get-pip.py');
  await downloadFile(GET_PIP_URL, getPipScript);
  spawnSync(pythonPath, [getPipScript, '--quiet'], { windowsHide: true, timeout: 60_000 });
  spawnSync(
    pythonPath,
    ['-m', 'pip', 'install', 'pywinauto', '--quiet', '--index-url', PIP_INDEX_URL],
    { windowsHide: true, timeout: 120_000 },
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
git add services/agent/modules/line04/__tests__/preflight.test.ts \
        services/agent/modules/line04/preflight.ts
git commit -m "test(line04): installPywinauto get-pip+清华源 failing test + impl

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5：新增 `autoRepair()` + 接入 `runPreflight()`

**Files:**
- Modify: `services/agent/modules/line04/__tests__/preflight.test.ts`
- Modify: `services/agent/modules/line04/preflight.ts`

- [ ] **Step 1: 写失败测试**

```typescript
describe('autoRepair — 按需调用安装函数', () => {
  afterEach(() => vi.restoreAllMocks());

  it('wechat 失败时调用 installWeChat', async () => {
    const installWeChatMock = vi.spyOn(preflightModule, 'installWeChat').mockResolvedValue();
    const installPywMock = vi.spyOn(preflightModule, 'installPywinauto').mockResolvedValue();

    await autoRepair(
      { wechatFailed: true, pywinautoFailed: false },
      'python.exe',
      os.tmpdir(),
    );

    expect(installWeChatMock).toHaveBeenCalledOnce();
    expect(installPywMock).not.toHaveBeenCalled();
  });

  it('pywinauto 失败时调用 installPywinauto', async () => {
    const installWeChatMock = vi.spyOn(preflightModule, 'installWeChat').mockResolvedValue();
    const installPywMock = vi.spyOn(preflightModule, 'installPywinauto').mockResolvedValue();

    await autoRepair(
      { wechatFailed: false, pywinautoFailed: true },
      'python.exe',
      os.tmpdir(),
    );

    expect(installWeChatMock).not.toHaveBeenCalled();
    expect(installPywMock).toHaveBeenCalledOnce();
  });

  it('两者都失败时都调用', async () => {
    vi.spyOn(preflightModule, 'installWeChat').mockResolvedValue();
    const installPywMock = vi.spyOn(preflightModule, 'installPywinauto').mockResolvedValue();

    await autoRepair(
      { wechatFailed: true, pywinautoFailed: true },
      'python.exe',
      os.tmpdir(),
    );

    expect(installPywMock).toHaveBeenCalledOnce();
  });
});

describe('runPreflight — 失败时触发 autoRepair（Windows mock）', () => {
  afterEach(() => vi.restoreAllMocks();

  it('非 Windows 不触发 autoRepair', async () => {
    if (process.platform === 'win32') return;
    const repairSpy = vi.spyOn(preflightModule, 'autoRepair').mockResolvedValue();
    await runPreflight(os.tmpdir());
    expect(repairSpy).not.toHaveBeenCalled();
  });
});
```

在顶部 import 追加：
```typescript
import * as preflightModule from '../preflight';
import { autoRepair } from '../preflight';
```

- [ ] **Step 2: 运行确认失败**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -15
```

- [ ] **Step 3: 实现 `autoRepair()` 并更新 `runPreflight()`**

在 preflight.ts 中，`installPywinauto` 之后追加 `autoRepair`：

```typescript
export interface RepairTargets {
  wechatFailed: boolean;
  pywinautoFailed: boolean;
}

export async function autoRepair(
  targets: RepairTargets,
  pythonPath: string,
  downloadDir: string,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  if (targets.wechatFailed) tasks.push(installWeChat(downloadDir));
  if (targets.pywinautoFailed) tasks.push(installPywinauto(pythonPath, downloadDir));
  await Promise.all(tasks);
}
```

将 `runPreflight()` 替换为：

```typescript
export async function runPreflight(moduleDir?: string): Promise<ModulePreflightResult> {
  const dir = moduleDir ?? __dirname;
  const python = getModulePython(dir);
  const downloadDir = path.join(os.tmpdir(), 'zenithjoy-setup');
  fs.mkdirSync(downloadDir, { recursive: true });

  // 首轮检测
  let wechat = checkWechatVersion();
  let pyw = await checkPywinauto(python);
  const mem = checkMemory();

  // 自动修复（仅 Windows，非 CI mock 模式）
  if (process.platform === 'win32' && !process.env.MOCK_WECHAT_VERSION) {
    const needRepair = !wechat.ok || !pyw.ok;
    if (needRepair) {
      await autoRepair({ wechatFailed: !wechat.ok, pywinautoFailed: !pyw.ok }, python, downloadDir);
      // 修复后重检
      wechat = checkWechatVersion();
      pyw = await checkPywinauto(python);
    }
  }

  // 软检测：微信进程是否在跑
  const running = checkWechatRunning();

  const checks = {
    wechat_version: wechat.ok,
    pywinauto: pyw.ok,
    memory: mem.ok,
  };

  if (wechat.ok && pyw.ok && mem.ok) {
    return {
      ok: true,
      checks,
      // 如果微信没跑，透传提示
      ...(running.fixGuide ? { fixGuide: running.fixGuide } : {}),
    };
  }

  // version-only warning（wechat 版本失败但其他两项通过）→ ok:true
  if (!wechat.ok && pyw.ok && mem.ok) {
    return {
      ok: true,
      checks,
      ...(running.fixGuide ? { fixGuide: running.fixGuide } : {}),
    };
  }

  const fixGuide = [wechat, pyw, mem]
    .filter((c) => !c.ok && c.fixGuide)
    .map((c) => c.fixGuide)
    .join('\n');
  return { ok: false, checks, fixGuide };
}
```

- [ ] **Step 4: 运行全量测试**

```bash
cd services/agent && ../../node_modules/.bin/vitest run modules/line04/__tests__/preflight.test.ts 2>&1 | tail -20
```

期望：全部 PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
git add services/agent/modules/line04/__tests__/preflight.test.ts \
        services/agent/modules/line04/preflight.ts
git commit -m "test(line04): autoRepair + runPreflight 自动修复流程 failing test + impl

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6：版本 Bump + 同步 API 端版本断言

**Files:**
- Modify: `services/agent/modules/line04/manifest.json`
- Modify: `services/agent/package.json`
- Modify: `apps/api/src/services/walking-skeleton.service.ts`
- Modify: `.github/workflows/scripts/smoke/heartbeat-module-health-smoke.sh`
- Modify: `apps/api/tests/routes/heartbeat-modules.test.ts`
- Modify: `apps/api/src/routes/__tests__/heartbeat-payload-passthrough.test.ts`

- [ ] **Step 1: 更新 line04 manifest.json**

将 `"version": "1.0.1"` 改为 `"version": "1.0.2"`

- [ ] **Step 2: 更新 Agent package.json**

将 `"version": "2.0.3"` 改为 `"version": "2.0.4"`

- [ ] **Step 3: 更新 walking-skeleton.service.ts**

将 `'line04-wechat-cs': { status: 'active', required_version: '1.0.1' }` 改为 `'1.0.2'`

- [ ] **Step 4: 更新 heartbeat-module-health-smoke.sh**

将 `[ "$L04_VER" = "1.0.1" ]` 改为 `[ "$L04_VER" = "1.0.2" ]`

- [ ] **Step 5: 更新 heartbeat-modules.test.ts**

将 `'line04-wechat-cs': '1.0.1'` 改为 `'1.0.2'`

- [ ] **Step 6: 更新 heartbeat-payload-passthrough.test.ts**

将 mock 中 `'line04-wechat-cs': { status: 'active', required_version: '1.0.1' }` 改为 `'1.0.2'`

- [ ] **Step 7: 运行 API 测试确认**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
../../node_modules/.bin/vitest run apps/api/tests/routes/heartbeat-modules.test.ts \
  apps/api/src/routes/__tests__/heartbeat-payload-passthrough.test.ts 2>&1 | tail -15
```

- [ ] **Step 8: Commit**

```bash
cd /Users/administrator/perfect21/zenithjoy-wt-cp-line04-preflight-autorepair-06091230
git add services/agent/modules/line04/manifest.json \
        services/agent/package.json \
        apps/api/src/services/walking-skeleton.service.ts \
        .github/workflows/scripts/smoke/heartbeat-module-health-smoke.sh \
        apps/api/tests/routes/heartbeat-modules.test.ts \
        apps/api/src/routes/__tests__/heartbeat-payload-passthrough.test.ts
git commit -m "chore: bump line04 1.0.2 + agent 2.0.4，同步 API 版本断言

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ `getModulePython` ZENITHJOY_CORE_DIR 回退 → Task 1
- ✅ `checkWechatRunning` 软检测 → Task 2
- ✅ `installWeChat` /S 静默 → Task 3
- ✅ `installPywinauto` get-pip + 清华源 → Task 4
- ✅ `autoRepair` 按需调用 → Task 5
- ✅ `runPreflight` 两阶段检测 → Task 5
- ✅ 版本 bump → Task 6

**Placeholder scan:** 无 TBD / TODO。

**Type consistency:** `RepairTargets` 在 Task 5 定义并在同 Task 使用，无不一致。
