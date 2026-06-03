/**
 * P4 WS1 — wechat-rpa handler: spawn Python dryrun + receipt 解析.
 *
 * commit-1 RED (handler throws not impl); commit-2 GREEN.
 */
import { describe, it, expect } from 'vitest';
import { handleWechatRpa, resolveScriptForTest, startWechatListener } from '../wechat-rpa';
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
