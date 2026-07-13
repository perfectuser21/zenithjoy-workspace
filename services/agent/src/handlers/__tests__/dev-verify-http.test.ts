import { describe, it, expect } from 'vitest';
import { handleDevVerifyHttp, isInternalAddress } from '../dev-verify-http';

// T1 遗留:快验通道 HTTP 层(Brain → Agent 接缝)[BEHAVIOR]
// 合同点④:仅内网/本机触发在这层 enforce;响应字段按设计稿 §3.1(exit_code/elapsed_ms)。

const okDeps = {
  isDevMachine: true,
  runAction: async () => ({ stdout: 'pong', stderr: '', exitCode: 0 }),
};

describe('isInternalAddress — 内网闸判定 [BEHAVIOR]', () => {
  it('放行 loopback / 内网 / Tailscale CGNAT', () => {
    expect(isInternalAddress('127.0.0.1')).toBe(true);
    expect(isInternalAddress('::1')).toBe(true);
    expect(isInternalAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isInternalAddress('192.168.1.10')).toBe(true);
    expect(isInternalAddress('10.0.0.5')).toBe(true);
    expect(isInternalAddress('100.86.118.99')).toBe(true); // Tailscale 100.64/10
    expect(isInternalAddress('fd12:3456::1')).toBe(true); // IPv6 ULA fd00::/8
    expect(isInternalAddress('fe80::1')).toBe(true); // IPv6 link-local
  });
  it('拒公网地址', () => {
    expect(isInternalAddress('8.8.8.8')).toBe(false);
    expect(isInternalAddress('38.23.47.81')).toBe(false);
    expect(isInternalAddress('')).toBe(false);
    expect(isInternalAddress(undefined)).toBe(false);
  });
});

describe('handleDevVerifyHttp — HTTP 层合同 [BEHAVIOR]', () => {
  it('公网来源 → 403 forbidden,绝不执行', async () => {
    let executed = false;
    const r = await handleDevVerifyHttp(
      { action: 'wechat_private_chat_send', params: {} },
      '8.8.8.8',
      { isDevMachine: true, runAction: async () => { executed = true; return { stdout: '', stderr: '', exitCode: 0 }; } },
    );
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe('external_source_forbidden');
    expect(executed).toBe(false);
  });

  it('内网 + 白名单动作 → 200,字段映射为设计稿契约 exit_code/elapsed_ms', async () => {
    const r = await handleDevVerifyHttp(
      { line: 'wechat', action: 'health_check', params: {} },
      '127.0.0.1',
      okDeps,
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.exit_code).toBe(0);
    expect(typeof r.body.stdout).toBe('string');
    expect(typeof r.body.elapsed_ms).toBe('number');
  });

  it('生产机(isDevMachine=false) → 403 rejected=not_dev_machine', async () => {
    const r = await handleDevVerifyHttp(
      { action: 'health_check', params: {} },
      '127.0.0.1',
      { ...okDeps, isDevMachine: false },
    );
    expect(r.status).toBe(403);
    expect(r.body.ok).toBe(false);
    expect(r.body.rejected).toBe('not_dev_machine');
  });

  it('白名单外动作 → 400 rejected=not_whitelisted', async () => {
    const r = await handleDevVerifyHttp(
      { action: 'rm -rf /', params: {} },
      '127.0.0.1',
      okDeps,
    );
    expect(r.status).toBe(400);
    expect(r.body.rejected).toBe('not_whitelisted');
  });

  it('params 非纯对象 → 400 invalid_params,绝不执行', async () => {
    let executed = false;
    for (const bad of ['string', 42, [1, 2], null]) {
      const r = await handleDevVerifyHttp(
        { action: 'health_check', params: bad as never },
        '127.0.0.1',
        { isDevMachine: true, runAction: async () => { executed = true; return { stdout: '', stderr: '', exitCode: 0 }; } },
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_params');
    }
    expect(executed).toBe(false);
  });

  it('超时 → 504 rejected=timeout', async () => {
    const r = await handleDevVerifyHttp(
      { action: 'health_check', params: {}, timeout_ms: 50 },
      '127.0.0.1',
      { isDevMachine: true, runAction: () => new Promise(() => {}) },
    );
    expect(r.status).toBe(504);
    expect(r.body.rejected).toBe('timeout');
  });

  it('timeout_ms 超上限被截断到 60s(不放大)', async () => {
    // 通过契约暴露:请求 timeout_ms=999999 时 handler 仍正常返回(用即时 runAction,只验不抛)
    const r = await handleDevVerifyHttp(
      { action: 'health_check', params: {}, timeout_ms: 999999 },
      '127.0.0.1',
      okDeps,
    );
    expect(r.status).toBe(200);
    expect(r.body.applied_timeout_ms).toBe(60000);
  });
});
