// 回归测试：line02 模块 config 解析 bug
//
// 根因：process.on('message', (msg) => { config = msg.config || {} })
// 但 agent 发的是 {type:'config', apiBase, agentId, machineId}（顶层字段，非嵌套 msg.config）
// 导致 config.apiBase 永远 undefined → 轮询 http://localhost:3000 → 静默失败，任务永不被拿走。
//
// 修法：config = msg.config ?? { apiBase: msg.apiBase }，与 line04 保持一致。

import { describe, it, expect } from 'vitest';

// 模拟 agent 发出的 config 消息格式（顶层字段，非嵌套）
interface AgentConfigMsg {
  type: 'config';
  agentId: string;
  apiBase: string;
  machineId: string;
  config?: { apiBase?: string; pollIntervalMs?: number };
}

// 复现模块的 config 解析逻辑（两种版本）
function parseConfigBuggy(msg: AgentConfigMsg) {
  // 旧的 buggy 实现：忽略顶层 apiBase
  return msg.config || {};
}

function parseConfigFixed(msg: AgentConfigMsg) {
  // 修复后：优先 msg.config，fallback 到顶层字段
  return msg.config ?? { apiBase: msg.apiBase };
}

describe('line02 config parsing regression', () => {
  const agentMsg: AgentConfigMsg = {
    type: 'config',
    agentId: 'agent-abc',
    apiBase: 'https://staging-autopilot.zenjoymedia.media',
    machineId: 'machine-xyz',
    // config 字段不存在（agent 不发嵌套 config）
  };

  it('buggy 版本: msg.config 为 undefined → config.apiBase 丢失', () => {
    const cfg = parseConfigBuggy(agentMsg);
    expect((cfg as { apiBase?: string }).apiBase).toBeUndefined();
  });

  it('修复版本: 从顶层 msg.apiBase 正确读取 apiBase', () => {
    const cfg = parseConfigFixed(agentMsg);
    expect(cfg.apiBase).toBe('https://staging-autopilot.zenjoymedia.media');
  });

  it('修复版本: 当 msg.config 存在时优先使用 msg.config', () => {
    const msgWithNestedConfig: AgentConfigMsg = {
      ...agentMsg,
      config: { apiBase: 'http://custom-api', pollIntervalMs: 10000 },
    };
    const cfg = parseConfigFixed(msgWithNestedConfig);
    expect(cfg.apiBase).toBe('http://custom-api');
    expect((cfg as { pollIntervalMs?: number }).pollIntervalMs).toBe(10000);
  });
});
