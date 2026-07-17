import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('agent loadOrInitConfig — Sprint 2.1f Fix 6 envOrConfig', () => {
  const ENV_VARS_TO_RESTORE = [
    'ZENITHJOY_LICENSE',
    'ZENITHJOY_API_BASE',
    'ZENITHJOY_API_URL',
    'ZENITHJOY_CHROME_DEBUG_PORT',
    'APPDATA',
    'HOME',
  ];
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => (original[k] = process.env[k]));
    // 清空 env，让每个 case 自己控制
    delete process.env.ZENITHJOY_LICENSE;
    delete process.env.ZENITHJOY_API_BASE;
    delete process.env.ZENITHJOY_API_URL;
    delete process.env.ZENITHJOY_CHROME_DEBUG_PORT;
    // 隔离 APPDATA 到临时目录，避免污染真实 config
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-agent-test-'));
    process.env.APPDATA = tmp;
    process.env.HOME = tmp;
    vi.resetModules();
  });

  afterEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    });
  });

  it('设了 ZENITHJOY_LICENSE env → loadOrInitConfig 返此 license', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-XXXXXXXX';
    process.env.ZENITHJOY_API_URL = 'wss://api.test.com/agent-ws';

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();

    expect(cfg.licenseKey).toBe('ZJ-F-XXXXXXXX');
    expect(cfg.agentId).toMatch(/^agent-env-/);
  });

  it('未设 env，但 %APPDATA%/zenithjoy-agent/config.json 存在 → fallback 读 config.json', async () => {
    const cfgDir = path.join(process.env.APPDATA!, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({
        licenseKey: 'ZJ-F-FROMCONF',
        agentId: 'agent-test',
        apiUrl: 'wss://api.test.com/agent-ws',
        loggedInAt: 0,
      })
    );

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();
    expect(cfg.licenseKey).toBe('ZJ-F-FROMCONF');
  });

  it('env 和 config 都没 → 抛错告知去检查 .env / 重装 install pack', async () => {
    const mod = await import('../config-loader');
    expect(() => mod.loadOrInitConfig()).toThrowError(/ZENITHJOY_LICENSE|install pack|.env/i);
  });

  // ── 身份统一（cp-06270030）：有 license 但无 apiBase 配置时绝不静默回落生产 ──
  // 背景：自升级后新核心若拿不到 apiUrl，旧代码默认连 wss://api.zenithjoy.com →
  //       客户机静默连错环境（staging 机连到生产）→ 身份裂开。改成报清晰错误。
  it('有 license 但无 ZENITHJOY_API_URL/ZENITHJOY_API_BASE → 抛错，不回落生产', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-NOAPI';
    // 故意不设 ZENITHJOY_API_URL / ZENITHJOY_API_BASE
    const mod = await import('../config-loader');
    expect(() => mod.loadOrInitConfig()).toThrowError(/apiUrl|api.url|ZENITHJOY_API|api.?base/i);
  });

  it('返回的 apiUrl 永不等于硬编码生产地址（无配置应报错而非默认生产）', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-NOAPI2';
    const mod = await import('../config-loader');
    let apiUrl: string | undefined;
    try {
      apiUrl = mod.loadOrInitConfig().apiUrl;
    } catch {
      apiUrl = undefined; // 报错是预期行为
    }
    expect(apiUrl).not.toBe('wss://api.zenithjoy.com/agent-ws');
  });

  it('显式设了 ZENITHJOY_API_URL 时正常返回该地址', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-OK';
    process.env.ZENITHJOY_API_URL = 'wss://api.staging.test/agent-ws';
    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();
    expect(cfg.apiUrl).toBe('wss://api.staging.test/agent-ws');
  });
});

// ── 回归测试：agentId 持久化——同机器每次重启必须复用同一个 agentId ──
// 背景：start.bat 始终注入 ZENITHJOY_LICENSE env var → Priority 1 路径每次生成新
//       agent-env-XXXX → Dashboard 同一台机器累积多条客户端条目。
// 修法：Priority 1 路径先读 config.json；有同 license 的记录则复用 agentId；
//       没有则生成新 ID 并写入 config.json 供下次复用。
describe('agent loadOrInitConfig — agentId 持久化回归（同机多次启动稳定 ID）', () => {
  const ENV_VARS_TO_RESTORE = ['ZENITHJOY_LICENSE', 'ZENITHJOY_API_URL', 'APPDATA', 'HOME'];
  const original: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => (original[k] = process.env[k]));
    delete process.env.ZENITHJOY_LICENSE;
    delete process.env.ZENITHJOY_API_URL;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-persist-test-'));
    process.env.APPDATA = tmpDir;
    process.env.HOME = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('同 license 的 config.json 已存在时，复用其 agentId（稳定 ID，不每次生成新的）', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-STABLE';
    const cfgDir = path.join(tmpDir, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({
        licenseKey: 'ZJ-F-STABLE',
        agentId: 'agent-stable-001',
        apiUrl: 'wss://api.test.com/agent-ws',
        loggedInAt: 0,
      })
    );

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();

    expect(cfg.agentId).toBe('agent-stable-001');
  });

  it('config.json 不存在时，首次启动后自动写入 config.json（下次重启可复用 agentId）', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-NEWINSTALL';
    process.env.ZENITHJOY_API_URL = 'wss://api.test.com/agent-ws'; // 身份统一后无 apiUrl 会报错，显式提供
    const cfgFile = path.join(tmpDir, 'zenithjoy-agent', 'config.json');

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();

    expect(fs.existsSync(cfgFile)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(saved.agentId).toBe(cfg.agentId);
    expect(saved.licenseKey).toBe('ZJ-F-NEWINSTALL');
  });

  it('license 变更时生成新 agentId（不复用旧 license 对应的 ID）', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-NEWLICENSE';
    const cfgDir = path.join(tmpDir, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(
      path.join(cfgDir, 'config.json'),
      JSON.stringify({
        licenseKey: 'ZJ-F-OLDLICENSE',
        agentId: 'agent-old-should-not-reuse',
        apiUrl: 'wss://api.test.com/agent-ws',
        loggedInAt: 0,
      })
    );

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();

    expect(cfg.agentId).not.toBe('agent-old-should-not-reuse');
  });
});

// ── 回归测试：config.json 的 apiUrl 缓存不能永久卡死（2026-07-16 真机实证）──
// 背景：孙燕青/于瑾两台真机 .env 都正确写着 ZENITHJOY_API_BASE=staging-autopilot，但
// listen_chat.py 的真实连接记录（zj-listener 日志）100% 只连 autopilot.zenjoymedia.media
// （生产），0 次 staging- 前缀。追到根因：loadOrInitConfig() 只在 !stableAgentId（首次见到
// 这个 license）时才 fs.writeFileSync 更新 config.json，一旦 agentId 命中缓存复用，
// apiUrl 字段就再也不会被刷新——如果这台机器早期（比如刚拿到手、还没换 staging 配置）
// 缓存写进去的是生产地址，之后不管 .env 改成什么，只要某次核心进程读环境变量失败（代码
// 注释自己承认这个兜底场景真实存在），就会捡回这个永久卡死的旧值，且从此没有任何自愈路径。
describe('agent loadOrInitConfig — apiUrl 缓存刷新回归（真机实证：staging .env 却连着生产）', () => {
  const ENV_VARS_TO_RESTORE = ['ZENITHJOY_LICENSE', 'ZENITHJOY_API_URL', 'ZENITHJOY_API_BASE', 'APPDATA', 'HOME'];
  const original: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => (original[k] = process.env[k]));
    delete process.env.ZENITHJOY_LICENSE;
    delete process.env.ZENITHJOY_API_URL;
    delete process.env.ZENITHJOY_API_BASE;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-apiurl-refresh-test-'));
    process.env.APPDATA = tmpDir;
    process.env.HOME = tmpDir;
    vi.resetModules();
  });

  afterEach(() => {
    ENV_VARS_TO_RESTORE.forEach((k) => {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('★核心回归点：同 license 复用 agentId 时，若本次 env 提供了新 apiUrl，config.json 缓存必须同步刷新', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-STALEURL';
    process.env.ZENITHJOY_API_URL = 'wss://staging-autopilot.zenjoymedia.media/agent-ws';
    const cfgDir = path.join(tmpDir, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgFile = path.join(cfgDir, 'config.json');
    fs.writeFileSync(
      cfgFile,
      JSON.stringify({
        licenseKey: 'ZJ-F-STALEURL',
        agentId: 'agent-existing-001',
        apiUrl: 'wss://autopilot.zenjoymedia.media/agent-ws', // 早期缓存的生产地址（旧坏值）
        loggedInAt: 0,
      })
    );

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();

    // 本次返回值本来就该优先用 env（这一点旧代码已经对）
    expect(cfg.apiUrl).toBe('wss://staging-autopilot.zenjoymedia.media/agent-ws');

    // 关键断言：磁盘上的 config.json 缓存也必须被同步刷新，不能留着旧生产地址
    // ——否则下一次核心进程读不到 env（真机已知会发生）时，会捡回这条卡死的旧值。
    const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(saved.apiUrl).toBe('wss://staging-autopilot.zenjoymedia.media/agent-ws');
    expect(saved.agentId).toBe('agent-existing-001'); // agentId 依然稳定复用，不受影响
  });

  it('env 缺失、只能靠缓存兜底时，不应该报错也不应该改写缓存（纯只读兜底）', async () => {
    process.env.ZENITHJOY_LICENSE = 'ZJ-F-CACHEDONLY';
    const cfgDir = path.join(tmpDir, 'zenithjoy-agent');
    fs.mkdirSync(cfgDir, { recursive: true });
    const cfgFile = path.join(cfgDir, 'config.json');
    const before = JSON.stringify({
      licenseKey: 'ZJ-F-CACHEDONLY',
      agentId: 'agent-existing-002',
      apiUrl: 'wss://staging-autopilot.zenjoymedia.media/agent-ws',
      loggedInAt: 0,
    });
    fs.writeFileSync(cfgFile, before);

    const mod = await import('../config-loader');
    const cfg = mod.loadOrInitConfig();

    expect(cfg.apiUrl).toBe('wss://staging-autopilot.zenjoymedia.media/agent-ws');
    const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf-8'));
    expect(saved.apiUrl).toBe('wss://staging-autopilot.zenjoymedia.media/agent-ws');
  });
});
