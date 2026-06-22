import { describe, it, expect } from 'vitest';

// TDD Red：客户机真发 gate 决策模块尚未实现。
// Generator 须新建 services/agent/build-modules/line04/cs-config-gate.js，
// 导出：
//   resolveSendMode(config, pullOk) → 'real' | 'dryrun'
//     - auto_agent_enabled=true  且 pullOk=true  → 'real'
//     - auto_agent_enabled=false               → 'dryrun'
//     - pullOk=false（拉配置失败/中台不可达）  → 'dryrun'（强制演练，绝不误真发）
//   shouldReply(config, senderName) → boolean（senderName 在 config.whitelist 内才回）
// @ts-expect-error JS 模块尚未实现
import { resolveSendMode, shouldReply } from '../../../services/agent/build-modules/line04/cs-config-gate.js';

describe('客户机真发 gate 决策 [BEHAVIOR]', () => {
  it('ON + 拉成功 → real', () => {
    expect(resolveSendMode({ auto_agent_enabled: true }, true)).toBe('real');
  });

  it('OFF → dryrun（演练）', () => {
    expect(resolveSendMode({ auto_agent_enabled: false }, true)).toBe('dryrun');
  });

  it('ON + 拉失败 → 强制 dryrun（绝不误真发）', () => {
    expect(resolveSendMode({ auto_agent_enabled: true }, false)).toBe('dryrun');
  });
});

describe('白名单判定 [BEHAVIOR]', () => {
  it('名单内客户 → 回', () => {
    expect(shouldReply({ auto_agent_enabled: true, whitelist: ['客户甲'] }, '客户甲')).toBe(true);
  });

  it('名单外路人 → 不回', () => {
    expect(shouldReply({ auto_agent_enabled: true, whitelist: ['客户甲'] }, '陌生人路人')).toBe(false);
  });
});
