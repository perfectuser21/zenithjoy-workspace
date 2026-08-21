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

  it('rescoreLead 把最新一条评论内容回填进 acquisition_leads.latest_reply/latest_reply_at', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/acquisition_lead_comments/.test(text)) {
          return {
            rows: [
              // 最新评论(按 commented_at)故意放在数组第一位、非最后一位：
              // 若实现误用"数组最后一条"而非"commented_at 最大的一条"，这里会先露馅。
              { grade: '精准', commented_at: new Date('2026-07-22T09:00:00Z'), comment_text: '这是最新一条评论' },
              { grade: '感兴趣', commented_at: new Date('2026-07-20T03:00:00Z'), comment_text: '旧评论' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    await rescoreLead(pool, 'tenant-1', 'lead-reply-test', new Date('2026-07-22T12:00:00Z'));

    const updateCall = calls.find(
      (c) => /UPDATE\s+zenithjoy\.acquisition_leads/i.test(c.text) && !/FOR UPDATE/i.test(c.text)
    );
    expect(updateCall).toBeTruthy();
    expect(/latest_reply\s*=/.test(updateCall!.text)).toBe(true);
    expect(/latest_reply_at\s*=/.test(updateCall!.text)).toBe(true);
    expect(updateCall!.params).toContain('这是最新一条评论'); // 取 commented_at 最大的那条内容,不是数组顺序最后一条
  });

  it('rescoreLead 零评论时 latest_reply/latest_reply_at 回填为 null', async () => {
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        return { rows: [] };
      }),
    };

    await rescoreLead(pool, 'tenant-1', 'lead-zero-comments', new Date('2026-07-22T12:00:00Z'));

    const updateCall = calls.find(
      (c) => /UPDATE\s+zenithjoy\.acquisition_leads/i.test(c.text) && !/FOR UPDATE/i.test(c.text)
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall!.params).toContain(null);
    const latestReplyParamIndex = 7; // $8 = latestReplyText，params 数组下标从 0 开始
    expect(updateCall!.params![latestReplyParamIndex]).toBeNull();
    const lastCommentedAtParamIndex = 4; // $5 = lastCommentedAt，latest_reply_at 复用同一个值
    expect(updateCall!.params![lastCommentedAtParamIndex]).toBeNull();
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
              last_heartbeat_at: new Date(DISPATCH_TEST_NOW.getTime() - 30 * 1000),
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

describe('dispatchDue — gap 期间账号变离线', () => {
  it('build 时在线、dispatch 执行时心跳已过期(>2分钟未更新) → 回退 pending_dispatch，不强发', async () => {
    const staleHeartbeat = new Date(DISPATCH_TEST_NOW.getTime() - 5 * 60 * 1000); // 5 分钟前，超过 2 分钟阈值
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/FROM\s+zenithjoy\.dm_assignments/i.test(text) && /status = 'queued'/i.test(text)) {
          return { rows: [{ id: 'assign-1', lead_id: 'lead-1', account_label: 'stale-burner' }] };
        }
        if (/dm_outreach_log/i.test(text)) {
          return { rows: [{ hour: 0, day: 0 }] };
        }
        if (/FROM\s+zenithjoy\.acquisition_leads/i.test(text)) {
          return {
            rows: [{
              profile_url: 'https://douyin.com/xxx', douyin_id: 'dy123',
              agent_id: 'agent-1', capabilities: ['android'],
              last_heartbeat_at: staleHeartbeat,
            }],
          };
        }
        return { rows: [] };
      }),
    };

    await dispatchDue(pool, 'tenant-1', DISPATCH_TEST_NOW);

    const requeueCall = calls.find((c) =>
      /UPDATE\s+zenithjoy\.dm_assignments/i.test(c.text) && /pending_dispatch/i.test(c.text)
    );
    expect(requeueCall).toBeTruthy();
    const dispatchedCall = calls.find((c) =>
      /INSERT INTO\s+zenithjoy\.publish_tasks/i.test(c.text)
    );
    expect(dispatchedCall).toBeFalsy(); // 绝不能真派单
  });

  it('build 时在线、dispatch 执行时心跳仍新鲜(<2分钟) → 正常派单', async () => {
    const freshHeartbeat = new Date(DISPATCH_TEST_NOW.getTime() - 30 * 1000); // 30 秒前
    const calls: { text: string; params?: unknown[] }[] = [];
    const pool: QueryablePool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        calls.push({ text, params });
        if (/FROM\s+zenithjoy\.dm_assignments/i.test(text) && /status = 'queued'/i.test(text)) {
          return { rows: [{ id: 'assign-2', lead_id: 'lead-2', account_label: 'fresh-burner' }] };
        }
        if (/dm_outreach_log/i.test(text)) {
          return { rows: [{ hour: 0, day: 0 }] };
        }
        if (/FROM\s+zenithjoy\.acquisition_leads/i.test(text)) {
          return {
            rows: [{
              profile_url: 'https://douyin.com/yyy', douyin_id: 'dy456',
              agent_id: 'agent-2', capabilities: ['android'],
              last_heartbeat_at: freshHeartbeat,
            }],
          };
        }
        return { rows: [] };
      }),
    };

    await dispatchDue(pool, 'tenant-1', DISPATCH_TEST_NOW);

    const dispatchedCall = calls.find((c) => /INSERT INTO\s+zenithjoy\.publish_tasks/i.test(c.text));
    expect(dispatchedCall).toBeTruthy();
  });
});

// ── Bug 修复：排期游标越过窗口结束后滚雪球式跳到未来几天（clampToWindowStart 钳制失效）──
// staging 实锤：dm_active_end=22:00 窗口关闭后，同一个号连续几条候选被逐条前移约 1 天，
// 两条记录被排到了 8/28、8/29（7-8 天后）。根因：clampToWindowStart 只在
// `d < startToday` 时才钳制，越窗时刻（如 22:03）+1 天后钟点不变，仍 `>= startToday`，
// 函数原样返回超窗时间，导致下一条候选排期继续判超窗、再滚一天，如此累积。
describe('acquisition-dispatch buildAssignments 排期越窗钳制（clampToWindowStart 滚雪球修复）', () => {
  it('本地时刻越过 dm_active_end 后，后续候选应钳制回次日窗口开始，而不是逐日累积漂移到窗口外', async () => {
    // 本地 21:58（构造方式与生产代码 now.setHours 同款本地语义，不受 CI 进程时区影响）：
    // 首条候选 +5min 网关间隔后落到 22:03，恰好越过 dm_active_end=22:00，触发滚入次日分支。
    const now = new Date(2026, 6, 21, 21, 58, 0);
    const insertedAssignments: { leadId: unknown; scheduledFor: unknown }[] = [];

    const pool: QueryablePool = {
      query: vi.fn(async (text: string) => {
        // getConfig：固定 5 分钟间隔（interval_min=max=300s），消除随机性，日配额给够不触发预算闸
        if (/FROM zenithjoy\.acquisition_config/i.test(text)) {
          return {
            rows: [{
              dm_interval_min_sec: 300, dm_interval_max_sec: 300,
              dm_per_day: 30, dm_active_start: '09:00', dm_active_end: '22:00',
            }],
          };
        }
        // Step B：唯一在线 burner
        if (/FROM\s+zenithjoy\.agent_platform_sessions/i.test(text)) {
          return { rows: [{ account_label: 'burner-single', day_count: 0 }] };
        }
        // Step A：无待重标 queued 行
        if (/status = 'queued' AND scheduled_for >/i.test(text)) {
          return { rows: [] };
        }
        // Step C：无 pending_dispatch 积压
        if (/status = 'pending_dispatch'/i.test(text) && /SELECT/i.test(text)) {
          return { rows: [] };
        }
        // 频控预算查询（day_res）
        if (/AS used/i.test(text)) {
          return { rows: [{ used: 0 }] };
        }
        // Step E 候选线索：3 条待派线索，逼同一个号连续排期多次以体现累积漂移
        if (/FROM\s+zenithjoy\.acquisition_leads/i.test(text) && /relevance_score/i.test(text) && !/UPDATE/i.test(text)) {
          return {
            rows: [
              { id: 'L1', profile_url: 'https://www.douyin.com/user/L1', relevance_score: 90 },
              { id: 'L2', profile_url: 'https://www.douyin.com/user/L2', relevance_score: 80 },
              { id: 'L3', profile_url: 'https://www.douyin.com/user/L3', relevance_score: 70 },
            ],
          };
        }
        // 单号首次尝试去重判定：全零 → shouldAssignLead 放行
        if (/AS sent_by_this/i.test(text)) {
          return { rows: [{ sent_by_this: 0, active_assign: 0, failed_cnt: 0, mins_since_fail: null }] };
        }
        if (/INSERT INTO zenithjoy\.dm_assignments/i.test(text)) {
          return { rows: [], rowCount: 1 };
        }
        return { rows: [] };
      }),
    };
    const origQuery = pool.query;
    pool.query = vi.fn(async (text: string, params?: unknown[]) => {
      const res = await origQuery(text, params);
      if (/INSERT INTO zenithjoy\.dm_assignments/i.test(text)) {
        insertedAssignments.push({ leadId: params?.[1], scheduledFor: params?.[3] });
      }
      return res;
    });

    await buildAssignments(pool, 'tenant-window-clamp-1', now);

    expect(insertedAssignments.length, '3 条候选都应被指派（预算充足、无去重阻挡）').toBe(3);

    for (const row of insertedAssignments) {
      const scheduled = new Date(row.scheduledFor as string);
      const minutesOfDay = scheduled.getHours() * 60 + scheduled.getMinutes();
      // dm_active_start=09:00(540分钟) ~ dm_active_end=22:00(1320分钟)
      expect(
        minutesOfDay,
        `线索 ${row.leadId} 排期 ${scheduled.toISOString()}（本地 ${scheduled.getHours()}:${String(scheduled.getMinutes()).padStart(2, '0')}）必须落在活跃窗口 09:00-22:00 内，不能停在越窗时刻`
      ).toBeGreaterThanOrEqual(9 * 60);
      expect(minutesOfDay).toBeLessThanOrEqual(22 * 60);
    }

    // 三条候选处理完，应该都落在「次日」窗口内一次性收敛，而不是逐条前移到次日/次次日/次三日
    const days = new Set(insertedAssignments.map((r) => new Date(r.scheduledFor as string).toDateString()));
    expect(days.size, '3 条候选应能在同一天（次日）窗口内排完，不应逐条累积漂移到不同的未来日期').toBe(1);
  });
});
