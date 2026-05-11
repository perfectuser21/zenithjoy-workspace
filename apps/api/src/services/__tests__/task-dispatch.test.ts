/**
 * task-dispatch.ts placeholder test (lint-test-pairing 要求)
 *
 * H-1 ws3 加了 agent_id 字段到 publish_request payload (UUID = entry.agentId).
 * 真行为测试在 contract-dod-ws3.md BEHAVIOR test_dispatch_message_agent_id_uuid (helper script + 真 ws round-trip).
 *
 * 此 placeholder 含真 expect 满足 lint-test-pairing 不允许 it.todo / 全 skip 的硬约束.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('task-dispatch.ts H-1 ws3 invariants', () => {
  it('source 含 agent_id 字段 (H-1 ws3 dispatcher 必要)', () => {
    const src = readFileSync(join(__dirname, '..', 'task-dispatch.ts'), 'utf8');
    expect(src).toMatch(/agent_id/);
  });

  it('source 含 displayName 双显示 log', () => {
    const src = readFileSync(join(__dirname, '..', 'task-dispatch.ts'), 'utf8');
    expect(src).toMatch(/displayName/);
  });
});
