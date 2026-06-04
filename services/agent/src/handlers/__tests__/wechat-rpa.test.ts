/**
 * P4 WS1 — wechat-rpa handler: spawn Python dryrun + receipt 解析.
 *
 * commit-1 RED (handler throws not impl); commit-2 GREEN.
 */
import { describe, it, expect } from 'vitest';
import { handleWechatRpa, resolveScriptForTest, startWechatListener, getPythonExeForTest, buildListenerSpawnArgs } from '../wechat-rpa';
import path from 'path';

describe('P4 WS1 — wechat-rpa handler [BEHAVIOR]', () => {
  it('dryrun qr_bind spawn 子进程 exit 0 + receipt 含 wechat_id', async () => {
    const stubPath = path.resolve(__dirname, '../../../../../scripts/wechat_rpa_dryrun.py');
    const result = await handleWechatRpa({
      type: 'wechat_qr_bind',
      payload: { dryrun: true, agent_id: 'test-agent-001' },
      pythonStub: stubPath,
    });
    expect(result.ok).toBe(true);
    expect(result.receipt).toBeDefined();
    expect(String(result.receipt?.wechat_id)).toMatch(/^mock_wx_/);
  });
});

describe('resolveScript — 按 task.type 分发真实脚本 [BEHAVIOR]', () => {
  it('wechat_private_chat_send → send_chat.py', () => {
    const p = resolveScriptForTest('wechat_private_chat_send');
    expect(p).toContain('send_chat.py');
    expect(p).toContain('wechat-rpa');
  });

  it('wechat_qr_bind → qr_bind.py', () => {
    const p = resolveScriptForTest('wechat_qr_bind');
    expect(p).toContain('qr_bind.py');
  });

  it('wechat_moments_send → send_moment.py', () => {
    const p = resolveScriptForTest('wechat_moments_send');
    expect(p).toContain('send_moment.py');
  });
});

describe('startWechatListener — 非 Windows skip [BEHAVIOR]', () => {
  it('非 Windows 平台调用后不 throw，console.log 含 skip 字样', () => {
    // CI 跑 Linux，必然触发 skip 分支
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    startWechatListener('http://localhost:5200');
    console.log = orig;
    // 非 Windows: 必须 log 含 '跳过' 或 'skip'（大小写不限）
    const joined = logs.join(' ').toLowerCase();
    expect(joined.includes('跳过') || joined.includes('skip') || joined.includes('非 windows')).toBe(true);
  });
});

describe('buildListenerSpawnArgs — 持久监听参数（防"5分钟死"回归）[BEHAVIOR]', () => {
  it('spawn 参数必须带 --middleware-url + 持久 --timeout 86400（不是默认 300）', () => {
    const args = buildListenerSpawnArgs('C:/x/listen_chat.py', 'https://autopilot.zenjoymedia.media');
    expect(args[0]).toBe('C:/x/listen_chat.py');
    const i = args.indexOf('--middleware-url');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('https://autopilot.zenjoymedia.media');
    const t = args.indexOf('--timeout');
    expect(t).toBeGreaterThanOrEqual(0);
    // 关键：必须是长持久 timeout（86400），否则监听 5 分钟后退出、客户机无人值守停摆
    expect(args[t + 1]).toBe('86400');
  });
});

describe('getPythonExeForTest — embedded Python 路径优先', () => {
  it('目录不存在时返回 python3', () => {
    expect(getPythonExeForTest('/nonexistent/path')).toBe('python3');
  });
});

describe('resolveScriptForTest — 路径基于 process.execPath 目录（pkg 打包后 __dirname 失效）', () => {
  it('返回路径位于 exe 同级目录（process.execPath dir）下，而非 __dirname', () => {
    // 根因：pkg 打包后 __dirname 是 /snapshot 虚拟路径，真实 wechat-rpa 在 exe 同级。
    const exeDir = path.dirname(process.execPath);
    const p = resolveScriptForTest('wechat_qr_bind');
    expect(p.startsWith(path.join(exeDir, 'wechat-rpa'))).toBe(true);
    // 防回归：不能再用 __dirname（测试文件 __dirname 在 src/handlers/__tests__ 下）
    expect(p.startsWith(__dirname)).toBe(false);
  });
});
