import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const gate = createRequire(import.meta.url)('../../../build-modules/line04/cs-config-gate.js');
describe('shared packaged CS config compatibility', () => {
  it('requires successful pull and explicit true before real mode; stale cached config never authorizes real mode', () => {
    const cached = { auto_agent_enabled: true, whitelist: ['客户甲'] };
    expect(gate.resolveSendMode(cached, true)).toBe('real');
    for (const cfg of [null, {}, { auto_agent_enabled: false }, { auto_agent_enabled: 'true' }]) expect(gate.resolveSendMode(cfg, true)).toBe('dryrun');
    expect(gate.resolveSendMode(cached, false)).toBe('dryrun');
    expect(gate.resolveActiveConfig(null, cached, false)).toBe(cached);
    expect(gate.shouldReply(cached, '客户甲')).toBe(true);
    expect(gate.shouldReply(cached, '路人')).toBe(false);
  });
  it('retains blacklist and legacy whitelist distinction without broadening a legacy account', () => {
    expect(gate.shouldReply({ takeover_mode: 'blacklist', blacklist: ['测试号'] }, '测试号')).toBe(false);
    expect(gate.shouldReply({ takeover_mode: 'blacklist', blacklist: [] }, '客户')).toBe(true);
    expect(gate.shouldReply({ whitelist: [] }, '客户')).toBe(false);
    expect(gate.shouldReply(null, '客户')).toBe(false);
  });
});
