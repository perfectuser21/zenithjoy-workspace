import { describe, it, expect, vi } from 'vitest';
import {
  defaultConfig,
  AcquisitionConfig,
  computeRelevanceScore,
  rescoreLead,
  heuristicScore,
  QueryablePool,
  buildAssignments,
  dispatchDue,
} from './acquisition-dispatch';

// 配套 unit（lint-test-pairing）— dispatchDue 真派单到 publish_tasks 的核心契约。
// 端到端行为由 staging DB 验证：dm_assignments.status='dispatched' + publish_tasks 有记录。

describe('acquisition-dispatch defaultConfig', () => {
  it('dm_message 有默认话术', () => {
    const cfg: AcquisitionConfig = defaultConfig('t1');
    expect(cfg.dm_message).toBeTruthy();
    expect(cfg.dm_message.length).toBeGreaterThan(0);
  });

  it('dm_per_hour / dm_per_day 有合理默认值', () => {
    const cfg = defaultConfig('t2');
    expect(cfg.dm_per_hour).toBeGreaterThan(0);
    expect(cfg.dm_per_day).toBeGreaterThanOrEqual(cfg.dm_per_hour);
  });

  it('dm_active_start < dm_active_end（时段合法）', () => {
    const cfg = defaultConfig('t3');
    expect(cfg.dm_active_start < cfg.dm_active_end).toBe(true);
  });

  it('dm_interval_min_sec <= dm_interval_max_sec', () => {
    const cfg = defaultConfig('t4');
    expect(cfg.dm_interval_min_sec).toBeLessThanOrEqual(cfg.dm_interval_max_sec);
  });
});

describe('computeRelevanceScore', () => {
  const now = new Date('2026-07-04T12:00:00Z');

  it('单条「高意向」24h 内 → 100×1.0 + 10 频次，封顶 100', () => {
    const score = computeRelevanceScore(
      [{ grade: '高意向', commented_at: new Date('2026-07-04T06:00:00Z') }],
      now
    );
    expect(score).toBe(100);
  });

  it('3 条「感兴趣」都在 24h 内 → 40×1.0 + 30 = 70', () => {
    const score = computeRelevanceScore(
      [
        { grade: '感兴趣', commented_at: new Date('2026-07-04T02:00:00Z') },
        { grade: '感兴趣', commented_at: new Date('2026-07-04T05:00:00Z') },
        { grade: '感兴趣', commented_at: new Date('2026-07-04T08:00:00Z') },
      ],
      now
    );
    expect(score).toBe(70);
  });

  it('1 条「精准」10 天前 → 70×0.5 + 10 = 45', () => {
    const score = computeRelevanceScore(
      [{ grade: '精准', commented_at: new Date('2026-06-24T12:00:00Z') }],
      now
    );
    expect(score).toBe(45);
  });

  it('空数组 → 回落 heuristicScore 兜底', () => {
    expect(computeRelevanceScore([], now)).toBe(heuristicScore({}));
  });

  it('40 天前评论 → 衰减系数封顶 0.3，不会更低', () => {
    // 高意向 100 × 0.3 = 30 + 10 频次 = 40；若无封顶则 100×(1-2)=负数
    const score = computeRelevanceScore(
      [{ grade: '高意向', commented_at: new Date('2026-05-25T12:00:00Z') }],
      now
    );
    expect(score).toBe(40);
  });

  it('取历史里最高档权重（混合档位）', () => {
    // 最高档=精准 70，频次 2 条 +20，24h 内 → 70 + 20 = 90
    const score = computeRelevanceScore(
      [
        { grade: '感兴趣', commented_at: new Date('2026-07-04T03:00:00Z') },
        { grade: '精准', commented_at: new Date('2026-07-04T09:00:00Z') },
      ],
      now
    );
    expect(score).toBe(90);
  });
});

describe('rescoreLead', () => {
  it('查 acquisition_lead_comments 表并 UPDATE acquisition_leads.relevance_score', async () => {
    const now = new Date('2026-07-04T12:00:00Z');
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/acquisition_lead_comments/.test(text)) {
          return {
            rows: [
              { grade: '高意向', commented_at: new Date('2026-07-04T06:00:00Z') },
              { grade: '感兴趣', commented_at: new Date('2026-07-04T09:00:00Z') },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const result = await rescoreLead(pool, 'tenant-1', 'lead-abc', now);

    const selectCall = calls.find((c) => /SELECT/i.test(c.text) && /acquisition_lead_comments/.test(c.text));
    expect(selectCall).toBeTruthy();
    expect(selectCall?.params).toEqual(['tenant-1', 'lead-abc']);

    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.acquisition_leads/i.test(c.text));
    expect(updateCall).toBeTruthy();
    expect(/relevance_score/.test(updateCall!.text)).toBe(true);
    // 最高档=高意向 100，2 条 +20 → 120 封顶 100
    expect(result.score).toBe(100);
    expect(result.comment_count).toBe(2);
    expect(updateCall?.params?.[2]).toBe(100);
    expect(updateCall?.params?.[3]).toBe(2);
  });

  it('先对该 lead 行 SELECT...FOR UPDATE 加锁，再读评论历史（防并发上报互相覆盖）', async () => {
    const calls: { text: string }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string) => {
        calls.push({ text });
        if (/acquisition_lead_comments/.test(text)) {
          return { rows: [{ grade: '精准', commented_at: new Date('2026-07-04T06:00:00Z') }] };
        }
        return { rows: [] };
      }),
    };

    await rescoreLead(pool, 'tenant-1', 'lead-lock-test', new Date('2026-07-04T12:00:00Z'));

    const lockIdx = calls.findIndex(
      (c) => /FROM\s+zenithjoy\.acquisition_leads/i.test(c.text) && /FOR UPDATE/i.test(c.text)
    );
    const commentsIdx = calls.findIndex((c) => /acquisition_lead_comments/.test(c.text));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(commentsIdx);
  });

  it('UPDATE acquisition_leads 时同步回写顶层 grade 字段为历史最高档', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/acquisition_lead_comments/.test(text)) {
          return {
            rows: [
              { grade: '感兴趣', commented_at: new Date('2026-07-04T03:00:00Z') },
              { grade: '精准', commented_at: new Date('2026-07-04T09:00:00Z') },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await rescoreLead(pool, 'tenant-1', 'lead-grade-test', new Date('2026-07-04T12:00:00Z'));

    const updateCall = calls.find(
      (c) => /UPDATE\s+zenithjoy\.acquisition_leads/i.test(c.text) && !/FOR UPDATE/i.test(c.text)
    );
    expect(updateCall).toBeTruthy();
    expect(/\bgrade\s*=/.test(updateCall!.text)).toBe(true);
    expect(updateCall!.params).toContain('精准'); // 两条评论里的最高档
  });
});

describe('acquisition-dispatch outreach_eligible gate', () => {
  it('dm_assignments cancelled when outreach_eligible turns false', async () => {
    // FR-8: when rescoreLead sets outreach_eligible=false,
    // pending dm_assignments for that lead should be cancelled.
    //
    // This test will FAIL until commit-5 implements:
    //   1. rescoreLead updating outreach_eligible boolean in acquisition_leads
    //   2. Cancelling pending dm_assignments when outreach_eligible=false
    //
    // Setup: lead with only '感兴趣' grade → outreach_eligible=false
    const cancelledIds: string[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        // Return '感兴趣' comments only → should set outreach_eligible=false
        if (/acquisition_lead_comments/.test(text)) {
          return {
            rows: [
              { grade: '感兴趣', commented_at: new Date('2026-07-12T10:00:00Z') },
            ],
          };
        }
        // Capture dm_assignments cancellation
        if (/UPDATE.*dm_assignments.*cancelled/i.test(text)) {
          const assignmentId = params?.[0] as string;
          if (assignmentId) cancelledIds.push(assignmentId);
          return { rows: [], rowCount: 1 };
        }
        // Return pending dm_assignments for the lead
        if (/SELECT.*dm_assignments.*pending/i.test(text)) {
          return {
            rows: [{ id: 'assignment-pending-001', lead_id: 'lead-test-fr8', status: 'queued' }],
          };
        }
        return { rows: [] };
      }),
    };

    await rescoreLead(pool, 'tenant-test', 'lead-test-fr8');

    // After rescoreLead with only '感兴趣' comments:
    // 1. outreach_eligible should be set to false in the UPDATE
    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateLeadCall = mockQuery.mock.calls.find(([text]: [string]) =>
      /UPDATE.*acquisition_leads/i.test(text) && /outreach_eligible/i.test(text)
    );
    expect(updateLeadCall, 'rescoreLead should UPDATE outreach_eligible on acquisition_leads').toBeTruthy();

    // 2. The UPDATE should set outreach_eligible=false for '感兴趣'-only lead
    const outreachEligibleParam = updateLeadCall?.[1]?.find(
      (p: unknown) => p === false
    );
    expect(outreachEligibleParam, 'outreach_eligible should be false for 感兴趣-only lead').toBe(false);
  });
});

// ── P0 修复：串台/重复触达（sprints/07212205-fix-dispatch-dedup-crosstenant）──
// staging 实锤：同一条线索被 2-3 个不同小号各派单一次，部分已真实 sent。
// 三个 fix 各配一个 RED→GREEN 用例，mock pool 沿用本文件既有的「按 SQL 文本路由」风格
// （见上方 rescoreLead describe 块），而非引入新的 mock 方式。

// buildAssignments 内部还有一次 defaultConfig 时段闸判定，用与既有 douyin-id 测试文件
// 同款「UTC/上海双时区都在 09:00-22:00 窗口内」的时间点，避免因本地时区不同而误判。
const DISPATCH_TEST_NOW = new Date('2026-07-21T10:00:00Z'); // UTC 10:00 / 上海 18:00

describe('acquisition-dispatch buildAssignments 线索级去重（Fix 1，P0 串台修复）', () => {
  it('线索已被其它小号非终态指派后，重跑 buildAssignments 不应再给它派发新的 account_label', async () => {
    const insertedAssignments: { params: unknown[] }[] = [];

    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        // getConfig：走默认配置
        if (/FROM zenithjoy\.acquisition_config/i.test(text)) return { rows: [] };
        // Step B：在线 burner —— 只有 burner-b 在线（跟已指派的 burner-a 不同）
        if (/FROM\s+zenithjoy\.agent_platform_sessions/i.test(text)) {
          return { rows: [{ account_label: 'burner-b', day_count: 0 }] };
        }
        // Step A：待重标 queued 行 —— 无
        if (/status = 'queued' AND scheduled_for >/i.test(text)) {
          return { rows: [] };
        }
        // Step C：pending_dispatch 积压 —— 无
        if (/status = 'pending_dispatch'/i.test(text) && /SELECT/i.test(text)) {
          return { rows: [] };
        }
        // 频控预算查询（day_res，含 AS used 聚合列）
        if (/AS used/i.test(text)) {
          return { rows: [{ used: 0 }] };
        }
        // Step E 候选线索查询（leadsRes）——
        // 修复后的 SQL 会显式 NOT EXISTS 掉已有非终态指派/已发送记录的线索 L1；
        // 未修复的旧 SQL 没有这个子句，仍会把 L1 当候选交给下面的循环。
        if (/FROM\s+zenithjoy\.acquisition_leads/i.test(text) && /relevance_score/i.test(text) && !/UPDATE/i.test(text)) {
          if (/NOT EXISTS/i.test(text) && /dm_assignments/i.test(text)) {
            return { rows: [] };
          }
          return { rows: [{ id: 'L1', profile_url: 'https://www.douyin.com/user/L1', relevance_score: 80 }] };
        }
        // 每次尝试派单前 (tenant,lead,account_label) 粒度去重检查 —— L1/burner-b 尚无记录
        if (/UNION ALL/i.test(text)) {
          return { rows: [] };
        }
        // 真正写入指派
        if (/INSERT INTO zenithjoy\.dm_assignments/i.test(text)) {
          insertedAssignments.push({ params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    await buildAssignments(pool, 'tenant-dedup-1', DISPATCH_TEST_NOW);

    // L1 在真实数据里已经被 burner-a 指派过（dispatched/sent），这一轮绝不应该再给它
    // 插一条 account_label='burner-b' 的新记录 —— 这正是 staging 复现的"串小号重复触达"bug。
    const l1Inserts = insertedAssignments.filter((c) => c.params[1] === 'L1');
    expect(l1Inserts.length, 'L1 已有非终态指派，不应再被派给另一个小号产生新 INSERT').toBe(0);
  });
});

describe('acquisition-dispatch dispatchDue 账号会话租户隔离（Fix 2，P0 跨租户串号修复）', () => {
  it('两个租户存在同名 account_label 时，只能查到自己租户的 agent，不会拿到别的租户的', async () => {
    // 同一个 account_label 'burner-x' 在两个不同租户下各绑了一个 agent —— 现实中理论上可能撞名。
    const AGENTS_BY_LABEL: Record<string, { tenantId: string; agentId: string }[]> = {
      'burner-x': [
        { tenantId: 'tenant-A', agentId: 'agent-A1' },
        { tenantId: 'tenant-B', agentId: 'agent-B1' },
      ],
    };
    const publishTaskInserts: { params: unknown[] }[] = [];

    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        if (/FROM zenithjoy\.acquisition_config/i.test(text)) return { rows: [] };
        if (/FROM zenithjoy\.dm_assignments\s+WHERE tenant_id = \$1 AND status = 'queued'/i.test(text)) {
          return { rows: [{ id: 'assign-1', lead_id: 'lead-1', account_label: 'burner-x' }] };
        }
        if (/dm_outreach_log\s+WHERE tenant_id/i.test(text)) return { rows: [{ hour: 0, day: 0 }] };
        if (/FROM zenithjoy\.acquisition_leads l/i.test(text)) {
          const label = params?.[1] as string;
          const tenantParam = params?.[2] as string | undefined;
          const candidates = AGENTS_BY_LABEL[label] ?? [];
          // 修复后：查询带第 3 个 bind param（调用方自己的 tenantId），只能匹配同租户的 agent。
          // 未修复：查询完全不带 tenant 过滤，模拟"拿到别的租户 agent"这个最坏场景来证伪。
          const match = tenantParam !== undefined
            ? candidates.find((c) => c.tenantId === tenantParam)
            : candidates.find((c) => c.tenantId !== 'tenant-A'); // 未过滤时命中别的租户
          return {
            rows: [{
              profile_url: 'https://www.douyin.com/user/lead-1',
              douyin_id: '1689210742',
              agent_id: match?.agentId ?? null,
              capabilities: ['windows'],
            }],
          };
        }
        if (/INSERT INTO zenithjoy\.publish_tasks/i.test(text)) {
          publishTaskInserts.push({ params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const res = await dispatchDue(pool, 'tenant-A', DISPATCH_TEST_NOW);
    expect(res.dispatched).toBe(1);

    const payload = JSON.parse(publishTaskInserts[0].params[1] as string) as Record<string, unknown>;
    expect(payload.agent_id, '必须拿到 tenant-A 自己的 agent，不能串到 tenant-B').toBe('agent-A1');
  });
});

describe('acquisition-dispatch Step A 重标离线小号保留审计轨迹（Fix 3，P0 附带修复）', () => {
  it('小号掉线重标 pending_dispatch 时，dispatch_reason 应记录原账号，不能被清空成 NULL', async () => {
    const pendingDispatchUpdates: { params: unknown[] }[] = [];

    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        if (/FROM zenithjoy\.acquisition_config/i.test(text)) return { rows: [] };
        // Step B：在线小号只有 burner-online —— burner-offline 不在线
        if (/FROM\s+zenithjoy\.agent_platform_sessions/i.test(text)) {
          return { rows: [{ account_label: 'burner-online', day_count: 0 }] };
        }
        // Step A：一条 queued 行，指派给已掉线的 burner-offline
        if (/status = 'queued' AND scheduled_for >/i.test(text)) {
          return { rows: [{ id: 'qa-1', lead_id: 'L9', account_label: 'burner-offline' }] };
        }
        if (/UPDATE zenithjoy\.dm_assignments/i.test(text) && /pending_dispatch/i.test(text)) {
          pendingDispatchUpdates.push({ params: params ?? [] });
          return { rows: [], rowCount: 1 };
        }
        if (/status = 'pending_dispatch'/i.test(text) && /SELECT/i.test(text)) {
          return { rows: [] };
        }
        if (/AS used/i.test(text)) return { rows: [{ used: 0 }] };
        if (/FROM\s+zenithjoy\.acquisition_leads/i.test(text) && /relevance_score/i.test(text) && !/UPDATE/i.test(text)) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    await buildAssignments(pool, 'tenant-audit-1', DISPATCH_TEST_NOW);

    expect(pendingDispatchUpdates.length).toBe(1);
    const reasonParam = pendingDispatchUpdates[0].params.find(
      (p) => typeof p === 'string' && /offline_reassign_from/i.test(p)
    );
    expect(reasonParam, 'dispatch_reason 应携带 offline_reassign_from:<原账号> 而不是被清空成 NULL').toBeTruthy();
    expect(String(reasonParam)).toMatch(/offline_reassign_from:.*burner-offline/);
  });
});
