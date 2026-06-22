import { describe, it, expect } from 'vitest';

// TDD Red：客户机真发 gate 决策模块尚未实现。
// Generator 须新建 services/agent/build-modules/line04/cs-config-gate.js，
// 导出：
//   resolveSendMode(config, pullOk) → 'real' | 'dryrun'
//     - auto_agent_enabled=true  且 pullOk=true  → 'real'
//     - auto_agent_enabled=false               → 'dryrun'
//     - pullOk=false（拉配置失败/中台不可达）  → 'dryrun'（强制演练，绝不误真发）
//   resolveActiveConfig(fresh, cached, pullOk) → config（断网期用上次缓存的自己那份继续判定）
//     - pullOk=true  → fresh（拉到的新配置）
//     - pullOk=false（中台不可达）→ cached（上次缓存的自己那份，下游强制 dryrun；恢复后自动重拉）
//   shouldReply(config, senderName) → boolean（senderName 在 config.whitelist 内才回）
// @ts-expect-error JS 模块尚未实现
import { resolveSendMode, resolveActiveConfig, shouldReply } from '../../../services/agent/build-modules/line04/cs-config-gate.js';

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

describe('断网期缓存继续判定 resolveActiveConfig [BEHAVIOR]', () => {
  const fresh = { auto_agent_enabled: true, whitelist: ['客户甲'], persona: { self_name: '萌萌' } };
  const cached = { auto_agent_enabled: true, whitelist: ['客户乙'], persona: { self_name: '缓存萌萌' } };

  it('拉成功 → 用拉到的新配置', () => {
    expect(resolveActiveConfig(fresh, cached, true)).toEqual(fresh);
  });

  it('拉失败（中台不可达）→ 用上次缓存的自己那份继续判定（不丢配置）', () => {
    const active = resolveActiveConfig(null, cached, false);
    expect(active).toEqual(cached);
    // 缓存继续判定：白名单仍可工作；下游真发 gate 由 resolveSendMode(active, pullOk=false) 强制 dryrun
    expect(shouldReply(active, '客户乙')).toBe(true);
    expect(resolveSendMode(active, false)).toBe('dryrun');
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
