import { describe, it, expect } from 'vitest';
import { handleDevQuickVerify, DEV_VERIFY_WHITELIST } from '../dev-quick-verify';

// T1 RPA 开发快验通道 [BEHAVIOR]
// 合同点(Alex 2026-07-13 拍板):①只跑已注册动作 ②只在研发机开、生产机拒 ③超时60s可配 ④仅内网触发
// 这四条里前三条是可机检的行为，本测试锁死它们。

const okRunner = async () => ({ stdout: 'sent ok', stderr: '', exitCode: 0 });

describe('handleDevQuickVerify — 安全闸 + 结果契约 [BEHAVIOR]', () => {
  it('闸2红线：action 不在白名单 → 拒绝且绝不执行', async () => {
    let executed = false;
    const r = await handleDevQuickVerify(
      { type: 'dev_quick_verify', payload: { action: 'rm -rf /', params: {} } },
      { isDevMachine: true, runAction: async () => { executed = true; return { stdout: '', stderr: '', exitCode: 0 }; } },
    );
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe('not_whitelisted');
    expect(executed).toBe(false); // 关键：拒绝的动作绝不能真跑
  });

  it('闸1：生产机(isDevMachine=false) → 拒绝，任何 action 都不执行', async () => {
    let executed = false;
    const r = await handleDevQuickVerify(
      { type: 'dev_quick_verify', payload: { action: 'wechat_private_chat_send', params: {} } },
      { isDevMachine: false, runAction: async () => { executed = true; return { stdout: '', stderr: '', exitCode: 0 }; } },
    );
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe('not_dev_machine');
    expect(executed).toBe(false); // 生产机绝不能被快验通道驱动
  });

  it('白名单动作 + 研发机 → 同步返回完整 stdout/exitCode/durationMs', async () => {
    const r = await handleDevQuickVerify(
      { type: 'dev_quick_verify', payload: { action: 'wechat_private_chat_send', params: { to: 'X', msg: 'hi' } } },
      { isDevMachine: true, runAction: okRunner },
    );
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe('sent ok');
    expect(r.exitCode).toBe(0);
    expect(typeof r.durationMs).toBe('number');
  });

  it('闸3：动作超时 → 返回 rejected=timeout，不挂进程', async () => {
    const hang = () => new Promise<{ stdout: string; stderr: string; exitCode: number }>(() => { /* 永不 resolve */ });
    const r = await handleDevQuickVerify(
      { type: 'dev_quick_verify', payload: { action: 'wechat_private_chat_send', params: {} } },
      { isDevMachine: true, timeoutMs: 50, runAction: hang },
    );
    expect(r.ok).toBe(false);
    expect(r.rejected).toBe('timeout');
  });

  it('白名单只含已注册受控动作，禁包含任意命令', () => {
    expect(DEV_VERIFY_WHITELIST.has('wechat_private_chat_send')).toBe(true);
    expect(DEV_VERIFY_WHITELIST.has('rm -rf /')).toBe(false);
    expect(DEV_VERIFY_WHITELIST.has('')).toBe(false);
  });
});
