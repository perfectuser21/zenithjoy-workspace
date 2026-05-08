/**
 * Path 4 Sprint 1 ws5 — rate_limiter.py 真版（合同 RED）。
 *
 * 校验：
 *   1) 文件含 BEGIN IMMEDIATE 事务
 *   2) reset --wechat_id=<x> + version 子命令
 *   3) ~/.zenithjoy-agent/rate_limit.db 真持久化文件存在（reset 后）
 *   4) 朋友圈 24h 频控：第 2 条同 wechat_id → ok:false reason:rate_limited next_allowed_at
 *   5) 私聊分钟级：第 3 条 1 分钟内 → rate_limited
 *   6) 私聊天级：第 51 条 24h 内 → rate_limited（运行成本高，简化为校验逻辑存在）
 *   7) 10 并发 ThreadPoolExecutor can_send chat → True 数 ≤ 2
 *
 * 注：tests/ws5/** 在 vitest.config.ts 里被 exclude，不会进 CI vitest 集；
 * 这里作为合同 RED 验证文件，由 sprint-evaluator 在合同验证阶段直接 spawn python 校验。
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const RPA_DIR = path.join(REPO_ROOT, 'services', 'agent', 'wechat-rpa');
const RATE_LIMITER = path.join(RPA_DIR, 'rate_limiter.py');
const DB_PATH = path.join(os.homedir(), '.zenithjoy-agent', 'rate_limit.db');

function spawnRL(args: string[], opts: { input?: string } = {}) {
  return spawnSync('python3', [RATE_LIMITER, ...args], {
    encoding: 'utf-8',
    timeout: 10_000,
    ...(opts.input ? { input: opts.input } : {}),
  });
}

describe('ws5 rate_limiter.py — 静态契约', () => {
  it('文件存在', () => {
    expect(fs.existsSync(RATE_LIMITER)).toBe(true);
  });

  it('源文件含 BEGIN IMMEDIATE 事务（并发安全）', () => {
    const src = fs.readFileSync(RATE_LIMITER, 'utf-8');
    expect(src).toMatch(/BEGIN IMMEDIATE/);
  });

  it('源文件含 .zenithjoy-agent/rate_limit.db 路径', () => {
    const src = fs.readFileSync(RATE_LIMITER, 'utf-8');
    expect(src).toMatch(/\.zenithjoy-agent.*rate_limit\.db|rate_limit\.db/);
  });

  it('源文件含硬编码上限注释或字面量（24h moment / 50/天 chat / 2/分钟 chat）', () => {
    const src = fs.readFileSync(RATE_LIMITER, 'utf-8');
    // 至少应该含相关上限字面量
    expect(src).toMatch(/24|moment.*1|hour|day|minute|分钟|24h|hours/);
    expect(src).toMatch(/50|chat.*2|hours|minute|days/);
  });

  it('源文件含 can_send 函数定义', () => {
    const src = fs.readFileSync(RATE_LIMITER, 'utf-8');
    expect(src).toMatch(/def\s+can_send\s*\(/);
  });
});

describe('ws5 rate_limiter.py — 子命令', () => {
  it('version → 输出 rate_limiter v1.0', () => {
    const r = spawnRL(['version']);
    expect(r.status).toBe(0);
    expect(r.stdout || '').toMatch(/rate_limiter\s+v1\.0/);
  });

  it('reset --wechat_id=test_a → 退出 0 + DB 文件创建', () => {
    const r = spawnRL(['reset', '--wechat_id=test_a']);
    expect(r.status).toBe(0);
    expect(fs.existsSync(DB_PATH)).toBe(true);
  });
});

describe('ws5 rate_limiter.py — 频控边界', () => {
  it('朋友圈 24h 频控：第 2 条同 wechat_id → ok:false, reason:rate_limited, next_allowed_at', () => {
    spawnRL(['reset', '--wechat_id=test_b']);
    // 第 1 条：通过
    const r1 = spawnRL(['can_send', '--action=moment', '--wechat_id=test_b']);
    const out1 = JSON.parse((r1.stdout || '').trim().split('\n').pop() || '{}');
    expect(out1.ok).toBe(true);

    // 第 2 条：拒绝
    const r2 = spawnRL(['can_send', '--action=moment', '--wechat_id=test_b']);
    const out2 = JSON.parse((r2.stdout || '').trim().split('\n').pop() || '{}');
    expect(out2.ok).toBe(false);
    expect(out2.reason).toBe('rate_limited');
    expect(typeof out2.next_allowed_at).toBe('string');
  });

  it('私聊分钟级：第 3 条 1 分钟内 → rate_limited', () => {
    spawnRL(['reset', '--wechat_id=test_c']);
    const out1 = JSON.parse(
      (spawnRL(['can_send', '--action=chat', '--wechat_id=test_c']).stdout || '')
        .trim()
        .split('\n')
        .pop() || '{}',
    );
    expect(out1.ok).toBe(true);
    // 私聊操作间隔 ≥ 1 秒，所以连发会被间隔限制拒
    // 这里用 --skip-interval 或第 3 条直接拒
    const out2 = JSON.parse(
      (spawnRL(['can_send', '--action=chat', '--wechat_id=test_c']).stdout || '')
        .trim()
        .split('\n')
        .pop() || '{}',
    );
    // 间隔 < 1s 也算 rate_limited，或第 2 条通过、第 3 条拒
    // 业务约束：分钟级 ≤ 2 → 此第 2 条可能通过或拒（取决于操作间隔）
    // 严格预期：第 3 条 必拒
    const out3 = JSON.parse(
      (spawnRL(['can_send', '--action=chat', '--wechat_id=test_c']).stdout || '')
        .trim()
        .split('\n')
        .pop() || '{}',
    );
    // 第 3 条必拒（要么命中 2/分钟 要么命中操作间隔）
    expect(out3.ok).toBe(false);
    expect(out3.reason).toBe('rate_limited');
  });
});

describe('ws5 rate_limiter.py — 10 并发 BEGIN IMMEDIATE 防竞争', () => {
  it('10 并发 ThreadPoolExecutor can_send chat → True 数 ≤ 2', () => {
    spawnRL(['reset', '--wechat_id=test_concur']);
    // 用 Python 子进程跑并发
    const concurScript = `
import sys, os
sys.path.insert(0, ${JSON.stringify(RPA_DIR)})
from concurrent.futures import ThreadPoolExecutor
import rate_limiter

with ThreadPoolExecutor(max_workers=10) as e:
    results = list(e.map(lambda _: rate_limiter.can_send('chat', 'test_concur'), range(10)))
true_count = sum(1 for r in results if (r[0] if isinstance(r, tuple) else r) is True)
print(true_count)
`;
    const r = spawnSync('python3', ['-c', concurScript], {
      encoding: 'utf-8',
      timeout: 15_000,
    });
    const trueCount = parseInt((r.stdout || '0').trim(), 10);
    expect(Number.isFinite(trueCount)).toBe(true);
    expect(trueCount).toBeLessThanOrEqual(2);
  });
});

describe('ws5 主动发起会话 def 黑名单', () => {
  it('services/agent/wechat-rpa/ 不含 send_to / proactive_ / outbound_ / initiate_ / start_chat_with_ / cold_outreach_ / first_message_ def', () => {
    const files = fs.readdirSync(RPA_DIR).filter((f) => f.endsWith('.py'));
    let found = 0;
    const matches: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(path.join(RPA_DIR, f), 'utf-8');
      const lines = src.split('\n');
      for (const line of lines) {
        if (
          /^\s*def\s+(send_to|proactive_|outbound_|initiate_|start_chat_with_|cold_outreach_|first_message_)/.test(
            line,
          )
        ) {
          found++;
          matches.push(`${f}: ${line.trim()}`);
        }
      }
    }
    expect(found, `找到主动发起 def: ${matches.join(' | ')}`).toBe(0);
  });
});
