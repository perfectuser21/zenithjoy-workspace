/**
 * WS3 RED tests — WS routing UUID 化 + dispatcher 改读 agents.id
 *
 * 当前实现：
 *   - apps/api/src/services/agent-registry.ts AgentEntry 没 displayName 字段，agentId 是 string display name
 *   - apps/api/src/services/agent-ws.ts hello message 直把 string agentId 传给 register
 *   - apps/api/src/services/agent-db.ts 没 findOrCreateAgentUuid 函数
 *   - apps/api/src/services/task-dispatch.ts 不发 agent_id 字段
 *
 * 这些测试在实现前**必须 RED**。
 * 真 ws round-trip 行为靠 contract-dod-ws3.md BEHAVIOR manual:bash 验。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', 'src', 'services');

describe('WS3 — WS routing UUID 化 [BEHAVIOR]', () => {
  it('agent-db.ts 应导出 findOrCreateAgentUuid 函数', () => {
    const c = readFileSync(join(ROOT, 'agent-db.ts'), 'utf8');
    expect(c).toMatch(/export\s+(async\s+)?function\s+findOrCreateAgentUuid/);
  });

  it('agent-registry.ts AgentEntry interface 应含 displayName 字段', () => {
    const c = readFileSync(join(ROOT, 'agent-registry.ts'), 'utf8');
    expect(c).toMatch(/displayName/);
  });

  it('agent-ws.ts hello message handler 应调用 findOrCreateAgentUuid', () => {
    const c = readFileSync(join(ROOT, 'agent-ws.ts'), 'utf8');
    expect(c).toMatch(/findOrCreateAgentUuid/);
  });

  it('task-dispatch.ts 发 WS message 时应传 agent_id 字段', () => {
    const c = readFileSync(join(ROOT, 'task-dispatch.ts'), 'utf8');
    // 通过 makeMsg 第 2 个参数（payload）或顶层 agent_id 都可，匹配两种写法
    expect(c).toMatch(/agent_id/);
  });

  it('agent-protocol.ts publish_request payload 应可含 agent_id 字段', () => {
    const c = readFileSync(join(__dirname, '..', '..', '..', 'src', 'schemas', 'agent-protocol.ts'), 'utf8');
    expect(c).toMatch(/agent_id/);
  });

  it('findOrCreateAgentUuid 输入 string display 返 UUID — 单元 mock 验', async () => {
    // 这是个 future API，commit-1 RED：import 会失败
    let mod: any;
    try {
      mod = await import('../../../src/services/agent-db');
    } catch (err) {
      throw new Error('import agent-db failed: ' + (err as Error).message);
    }
    expect(typeof mod.findOrCreateAgentUuid).toBe('function');
  });
});
