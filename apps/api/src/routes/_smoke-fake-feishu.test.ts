/**
 * 假上游的 code → 身份解析。纯函数 + env，不发任何请求。
 *
 * 重点是本刀新增的那条 fallback：分组名查不到时按成员 open_id 精确寻址。
 * 它是「同组织两个人」这类断言的最小前提 —— `pickGroupMembers` 只返分组里第一个成员，
 * 甲乙会解析成同一个人，可见性反向/正向就没有第二个身份可用。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveFakeFeishuIdentity } from './_smoke-fake-feishu';

const SNAPSHOT_KEYS = [
  'STAFF_FEISHU_OPENIDS',
  'STAFF_FEISHU_OPENIDS__ORGA',
  'STAFF_FEISHU_OPENIDS__ORGB',
  'STAFF_ORG_MAP',
];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of SNAPSHOT_KEYS) saved[k] = process.env[k];
  process.env.STAFF_FEISHU_OPENIDS = 'ou_alice_1,ou_bob_1';
  process.env.STAFF_FEISHU_OPENIDS__ORGA = 'ou_alice_1,ou_bob_1';
  process.env.STAFF_FEISHU_OPENIDS__ORGB = 'ou_carol_1';
  process.env.STAFF_ORG_MAP = 'ORGA:11111111-1111-4111-8111-111111111111,ORGB:22222222-2222-4222-8222-222222222222';
});

afterEach(() => {
  for (const k of SNAPSHOT_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveFakeFeishuIdentity', () => {
  it('分组名命中时返回该组第一个成员（既有语义，本刀一字不改）', () => {
    expect(resolveFakeFeishuIdentity('smoke-code-orga')?.open_id).toBe('ou_alice_1');
    expect(resolveFakeFeishuIdentity('smoke-code-orgb')?.open_id).toBe('ou_carol_1');
  });

  it('分组名查不到时按 open_id 精确寻址 —— 同组织的第二个人才拿得到自己的身份', () => {
    expect(resolveFakeFeishuIdentity('wb-code-ou_bob_1')?.open_id).toBe('ou_bob_1');
    expect(resolveFakeFeishuIdentity('wb-code-ou_alice_1')?.open_id).toBe('ou_alice_1');
    // 甲乙必须是两个不同的人，否则可见性断言没有第二个身份可用
    expect(resolveFakeFeishuIdentity('wb-code-ou_alice_1')?.open_id).not.toBe(
      resolveFakeFeishuIdentity('wb-code-ou_bob_1')?.open_id
    );
  });

  it('没被任何分组声明过的 open_id 返回 null —— 不凭空造身份', () => {
    expect(resolveFakeFeishuIdentity('wb-code-ou_ghost_9')).toBeNull();
  });

  it('key 里带连字符的 code 解析不出来（既有正则约定，调用方按 code-<open_id> 构造）', () => {
    expect(resolveFakeFeishuIdentity('wb-code-alice-1')?.open_id).not.toBe('ou_alice_1');
  });

  it('压根不含 code- 的串返回 null', () => {
    expect(resolveFakeFeishuIdentity('')).toBeNull();
    expect(resolveFakeFeishuIdentity('random-string')).toBeNull();
  });
});
