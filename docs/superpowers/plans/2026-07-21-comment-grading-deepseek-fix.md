# 评论判定 grade 全空修复 + 判定引擎换 DeepSeek Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Path2 获客评论判定（留言分析）在画像为空时静默失败无日志的问题，把判定引擎从 Gemini 换成 DeepSeek（经现有 ToAPIs 通道，不引入 OpenRouter），修复并发覆盖与顶层展示字段回写缺口，并为已知安全窗口内的历史 null-grade 数据提供一次性 backfill 脚本。

**Architecture:** 不新增服务。三处已有文件的定点修改（`comment-grading.ts` 换模型+补日志、`acquisition-dispatch.ts` 的 `rescoreLead` 加行锁+回写顶层 grade）+ 一个新增一次性脚本（`backfill-null-grade-leads.ts`，只写 `acquisition_lead_comments.grade`，不自动联动 `outreach_eligible`）。

**Tech Stack:** TypeScript / Express / node-postgres (`pg`) / vitest / 现有 axios+ToAPIs 通道（`https://toapis.com/v1/chat/completions`）

---

### Task 1: comment-grading.ts — 判定引擎换 DeepSeek + 画像为空分支补日志

**Files:**
- Modify: `apps/api/src/services/comment-grading.ts:1-20,34-36,42,68`
- Test: `apps/api/src/services/comment-grading.test.ts`

- [ ] **Step 1: 写两个失败的测试（画像为空须打日志 + 模型须为 deepseek-v4-flash）**

在 `apps/api/src/services/comment-grading.test.ts` 的 `describe('comment-grading gradeComments', ...)` 块内，紧接第 26 行（`空画像 → 不调用Gemini，全部返回null` 用例结尾的 `});`）之后插入：

```ts
  it('画像为空 → 打印 warn 日志说明跳过原因（可观测性，另两个失败分支已有日志）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockedPost = vi.mocked(axios.post);
    const result = await gradeComments('', '标题', null, [{ commentText: '预算10万求推荐' }]);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result).toEqual([null]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('target_profile_desc 为空'));
    warnSpy.mockRestore();
  });

  it('判定模型使用 deepseek-v4-flash（经 ToAPIs，成本更低，用户拍板换掉 Gemini）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向' } }] },
    } as never);

    await gradeComments('家装目标客户', '标题', null, [{ commentText: '预算10万求推荐' }]);

    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.model).toBe('deepseek-v4-flash');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npx vitest run src/services/comment-grading.test.ts`
Expected: 新增的 2 条 FAIL——"画像为空"用例报 `warnSpy` 未被调用；"deepseek-v4-flash"用例报 `body.model` 实际是 `'gemini-2.5-flash-official'`。其余既有用例仍 PASS。

- [ ] **Step 3: 实现最小修复**

编辑 `apps/api/src/services/comment-grading.ts`：

文件头注释（第 1-15 行）里把 Gemini 专属描述改成准确描述当前模型：

```ts
/**
 * comment-grading.ts — 评论区留言AI意向分档判定
 *
 * 职责：
 *   1. 批量对一个视频下的评论区留言做意向分档（高意向/精准/感兴趣/其他）
 *   2. 空画像/空评论 → 直接返回全 null，不调用 LLM（省钱；空画像时无法判断意向，保守不发）
 *   3. 调用失败/超时 → 整批返回全 null，不抛异常（不能拖垮 /collect/report 主流程）
 *
 * LLM 调用：deepseek-v4-flash，通过 TOAPIS_API_KEY 走 ToAPIs 代理（与 content-judgment.ts
 * 同一网关，不同模型——content-judgment.ts 判视频内容仍用 Gemini，未受本次改动影响）。
 * 2026-07-21 用户拍板从 gemini-2.5-flash-official 换成 deepseek-v4-flash 降低成本
 * （decision，见本次 bug-fix 记录）；沿用已验证可用的 axios+ToAPIs 通道，不引入 OpenRouter。
 *
 * 判定点（decision 4e421ae8）：解析失败/无法判断时一律归入"其他"档（本函数里体现为 null，
 * 落库后 gradeWeight(null) 也会落进最低档）——宁可漏判高意向客户，不可误判陌生人为高意向
 * 去真实打扰。跟 content-judgment.ts 的"无法判断保守 matched"哲学方向相反，因为这里误判
 * 的后果是"真实发送私信"，比"多截一段视频"重得多。
 */
```

第 20 行模型常量：

```ts
const GRADING_MODEL = 'deepseek-v4-flash';
```

第 34-36 行"画像为空"分支补日志：

```ts
  if (!targetProfileDesc || targetProfileDesc.trim() === '') {
    console.warn('[comment-grading] target_profile_desc 为空，跳过判定（保守返回 null，不代表系统故障——请检查该租户是否已在 dashboard 配置获客画像）');
    return comments.map(() => null);
  }
```

第 68 行错误日志文案去掉硬编码的 "Gemini"：

```ts
    console.error('[comment-grading] LLM 调用失败:', (err as Error).message);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run src/services/comment-grading.test.ts`
Expected: 全部用例 PASS（含新增 2 条 + 原有全角标点回归用例不受影响，因为只改了模型名和日志，没碰 `parseGrades`）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/comment-grading.ts apps/api/src/services/comment-grading.test.ts
git commit -m "fix(api): 评论判定引擎换deepseek-v4-flash+画像为空分支补诊断日志

苏彦卿真机测试(tenant 6dbea700)22条leads grade全空——根因之一是target_profile_desc
为空时静默返回null，是三个失败分支里唯一没日志的，今日(07-20~21)新真机测试(tenant
68f2ee9f)再次撞上同一无声分支。用户同时拍板判定引擎从Gemini换DeepSeek降成本，沿用
现有ToAPIs通道(deepseek-v4-flash)，不引入OpenRouter。"
```

---

### Task 2: acquisition-dispatch.ts — rescoreLead 加行锁 + 回写顶层 grade 字段

**Files:**
- Modify: `apps/api/src/services/acquisition-dispatch.ts:252-304`
- Test: `apps/api/src/services/acquisition-dispatch.test.ts`

- [ ] **Step 1: 写两个失败的测试（行锁必须先于评论查询发出 + UPDATE 须回写 grade）**

在 `apps/api/src/services/acquisition-dispatch.test.ts` 的 `describe('rescoreLead', ...)` 块内（第 95-129 行），在现有 `it(...)` 之后追加：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npx vitest run src/services/acquisition-dispatch.test.ts`
Expected: 新增 2 条 FAIL——行锁用例报 `lockIdx` 为 `-1`（找不到 FOR UPDATE 查询）；grade 回写用例报 UPDATE 语句里没有 `grade =`。其余既有用例（含 `outreach_eligible gate`）仍 PASS。

- [ ] **Step 3: 实现最小修复**

编辑 `apps/api/src/services/acquisition-dispatch.ts` 第 252-304 行的 `rescoreLead`：

```ts
export async function rescoreLead(
  pool: QueryablePool,
  tenantId: string,
  leadId: string,
  now: Date = new Date()
): Promise<{ score: number; comment_count: number; outreach_eligible: boolean }> {
  // 行锁：两个视频的评论并发上报同一 lead 时，后完成的事务不能用旧快照覆盖先完成的结果。
  // 必须在事务内调用（acquisition.ts /collect/report 传入的是事务 client），锁持续到 COMMIT。
  await pool.query(
    `SELECT id FROM zenithjoy.acquisition_leads WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
    [tenantId, leadId]
  );

  const r = await pool.query(
    `SELECT c.grade, c.commented_at
       FROM zenithjoy.acquisition_lead_comments c
       JOIN zenithjoy.acquisition_leads l ON l.id = c.lead_id AND l.tenant_id = $1
      WHERE c.lead_id = $2
      ORDER BY c.commented_at ASC`,
    [tenantId, leadId]
  );
  const comments: LeadComment[] = r.rows.map((row) => ({ grade: row.grade, commented_at: row.commented_at }));
  const score = computeRelevanceScore(comments, now);
  const commentCount = comments.length;
  const lastCommentedAt = commentCount > 0
    ? new Date(Math.max(...comments.map((c) => new Date(c.commented_at).getTime()))).toISOString()
    : null;

  // outreach_eligible：最高档是精准或高意向 → true，否则 false
  const highestGrade = commentCount > 0
    ? comments.reduce((best, c) => {
        const grades = ['高意向', '精准', '感兴趣'];
        const ci = grades.indexOf(c.grade ?? '');
        const bi = grades.indexOf(best ?? '');
        return ci >= 0 && (bi < 0 || ci < bi) ? c.grade : best;
      }, null as string | null)
    : null;
  const outreachEligible = highestGrade === '高意向' || highestGrade === '精准';

  await pool.query(
    `UPDATE zenithjoy.acquisition_leads
        SET relevance_score = $3, comment_count = $4, last_commented_at = $5,
            outreach_eligible = $6, grade = $7, updated_at = now()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, leadId, score, commentCount, lastCommentedAt, outreachEligible, highestGrade]
  );

  // FR-8：outreach_eligible 变 false → 取消该 lead 的 pending/queued dm_assignments
  if (!outreachEligible) {
    await pool.query(
      `UPDATE zenithjoy.dm_assignments
          SET status = 'cancelled', updated_at = now()
        WHERE tenant_id = $1 AND lead_id = $2
          AND status IN ('queued', 'pending_dispatch')`,
      [tenantId, leadId]
    );
  }

  return { score, comment_count: commentCount, outreach_eligible: outreachEligible };
}
```

（唯一改动：函数开头新增一条 `SELECT ... FOR UPDATE`；原 UPDATE 语句的 SET 子句里加 `grade = $7`，参数数组末尾加 `highestGrade`。其余逻辑原样不动。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run src/services/acquisition-dispatch.test.ts`
Expected: 全部用例 PASS（含 Task 2 新增 2 条 + 原有 `rescoreLead`/`outreach_eligible gate` 用例——新增的锁查询和 `grade` 参数不影响它们原有断言的参数下标）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/acquisition-dispatch.ts apps/api/src/services/acquisition-dispatch.test.ts
git commit -m "fix(api): rescoreLead加行锁防并发覆盖+回写顶层acquisition_leads.grade字段

两个视频同时上报同一lead评论时,先完成的事务可能用旧快照覆盖后完成的结果;
顶层grade字段此前只在新建lead时写一次,追加评论后从不更新,展示给用户的
这一列长期陈旧/空白。rescoreLead开头加SELECT...FOR UPDATE锁行,UPDATE
时一并回写grade=历史最高档。"
```

---

### Task 3: 一次性 backfill 脚本（历史 null-grade 数据，带安全边界）

**Files:**
- Create: `apps/api/src/scripts/backfill-null-grade-leads.ts`
- Test: `apps/api/tests/scripts/backfill-null-grade-leads.test.ts`

- [ ] **Step 1: 写失败的测试（候选筛选的安全边界逻辑）**

Create `apps/api/tests/scripts/backfill-null-grade-leads.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { selectBackfillCandidates, type CandidateRow } from '../../src/scripts/backfill-null-grade-leads';

describe('selectBackfillCandidates', () => {
  it('评论时间晚于画像创建时间 → 纳入候选（大概率是解析bug漏判，可安全backfill）', () => {
    const rows: CandidateRow[] = [
      {
        commentId: 'c1', leadId: 'l1', tenantId: 't1', commentText: '预算20w内能不能包入住？',
        commentedAt: new Date('2026-07-19T05:00:00Z'),
        configCreatedAt: new Date('2026-07-18T15:58:00Z'),
      },
    ];
    const result = selectBackfillCandidates(rows);
    expect(result).toEqual([{ commentId: 'c1', leadId: 'l1', tenantId: 't1', commentText: '预算20w内能不能包入住？' }]);
  });

  it('评论时间早于画像创建时间 → 排除（当时画像本来就是空的，本该是null，不能backfill出假意向）', () => {
    const rows: CandidateRow[] = [
      {
        commentId: 'c2', leadId: 'l2', tenantId: 't2', commentText: '随便看看',
        commentedAt: new Date('2026-07-10T00:00:00Z'),
        configCreatedAt: new Date('2026-07-18T15:58:00Z'),
      },
    ];
    expect(selectBackfillCandidates(rows)).toEqual([]);
  });

  it('该租户从未配置过画像（configCreatedAt为null）→ 排除', () => {
    const rows: CandidateRow[] = [
      {
        commentId: 'c3', leadId: 'l3', tenantId: 't3', commentText: '好看',
        commentedAt: new Date('2026-07-20T00:00:00Z'),
        configCreatedAt: null,
      },
    ];
    expect(selectBackfillCandidates(rows)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npx vitest run tests/scripts/backfill-null-grade-leads.test.ts`
Expected: FAIL with "Cannot find module '../../src/scripts/backfill-null-grade-leads'"（文件还不存在）。

- [ ] **Step 3: 实现脚本**

Create `apps/api/src/scripts/backfill-null-grade-leads.ts`：

```ts
/**
 * backfill-null-grade-leads.ts — 一次性历史数据修复脚本，不进 CI 常驻。
 *
 * 背景：PR #1416（2026-07-19）修复了 Gemini 全角标点解析失败的 bug，但修复前产生的
 * acquisition_lead_comments.grade=null 历史数据没有回补机制。直接无脑补有风险：
 * acquisition_config 没有历史时间戳/版本表，没法准确判断"某条历史评论被判定时画像
 * 是不是空的"——若不加保护，会把当时确实没画像（本该是 null）的记录也补出假意向。
 *
 * 安全边界：只处理 commented_at 晚于该租户 acquisition_config.created_at 的记录
 * （用 created_at 作为"画像最早可能非空"的保守下界）。已知局限：若租户曾经清空画像
 * 又重新填写，created_at 无法反映这段"清空期"，仍可能误纳入——所以本脚本产出结果
 * 不自动联动 outreach_eligible/派发，跑完打印候选名单，必须人工复核后再手动触发
 * /api/acquisition/rescore-lead 或改库。
 *
 * 用法：
 *   npx ts-node src/scripts/backfill-null-grade-leads.ts --dry-run   # 只打印不写库
 *   npx ts-node src/scripts/backfill-null-grade-leads.ts             # 写 grade，不动 outreach_eligible
 */
import pool from '../db/connection';
import { gradeComments } from '../services/comment-grading';

export interface CandidateRow {
  commentId: string;
  leadId: string;
  tenantId: string;
  commentText: string | null;
  commentedAt: Date;
  configCreatedAt: Date | null;
}

export interface BackfillCandidate {
  commentId: string;
  leadId: string;
  tenantId: string;
  commentText: string | null;
}

export function selectBackfillCandidates(rows: CandidateRow[]): BackfillCandidate[] {
  return rows
    .filter((r) => r.configCreatedAt !== null && r.commentedAt.getTime() > r.configCreatedAt.getTime())
    .map((r) => ({
      commentId: r.commentId,
      leadId: r.leadId,
      tenantId: r.tenantId,
      commentText: r.commentText,
    }));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const { rows } = await pool.query(`
    SELECT c.id AS comment_id, c.lead_id, l.tenant_id, c.comment_text, c.commented_at,
           cfg.created_at AS config_created_at, cfg.target_profile_desc
      FROM zenithjoy.acquisition_lead_comments c
      JOIN zenithjoy.acquisition_leads l ON l.id = c.lead_id
      LEFT JOIN zenithjoy.acquisition_config cfg ON cfg.tenant_id = l.tenant_id
     WHERE c.grade IS NULL
  `);

  const profileByTenant = new Map<string, string>();
  for (const row of rows) {
    if (row.target_profile_desc) profileByTenant.set(row.tenant_id, row.target_profile_desc);
  }

  const candidates = selectBackfillCandidates(
    rows.map((r: { comment_id: string; lead_id: string; tenant_id: string; comment_text: string | null; commented_at: string; config_created_at: string | null }) => ({
      commentId: r.comment_id,
      leadId: r.lead_id,
      tenantId: r.tenant_id,
      commentText: r.comment_text,
      commentedAt: new Date(r.commented_at),
      configCreatedAt: r.config_created_at ? new Date(r.config_created_at) : null,
    }))
  );

  console.log(`候选 ${candidates.length} 条（画像已配置之后产生、grade 仍为 null 的历史评论）`);

  for (const c of candidates) {
    const profileDesc = profileByTenant.get(c.tenantId) ?? '';
    const [grade] = await gradeComments(profileDesc, null, null, [{ commentText: c.commentText }]);
    if (!dryRun && grade) {
      await pool.query(`UPDATE zenithjoy.acquisition_lead_comments SET grade = $1 WHERE id = $2`, [grade, c.commentId]);
    }
    console.log(`lead=${c.leadId} comment=${c.commentId} → grade=${grade ?? 'null'}${dryRun ? '（dry-run，未写库）' : ''}`);
  }

  console.log('backfill 完成。注意：acquisition_leads.outreach_eligible 未自动更新——人工复核候选名单后，'
    + '对确认要放行的 lead 手动调用 POST /api/acquisition/rescore-lead 或直接改库，不要批量自动派发。');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/api && npx vitest run tests/scripts/backfill-null-grade-leads.test.ts`
Expected: 3 条用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/backfill-null-grade-leads.ts apps/api/tests/scripts/backfill-null-grade-leads.test.ts
git commit -m "feat(api): 新增一次性backfill脚本修复历史null-grade评论(带安全边界)

只处理commented_at晚于该租户acquisition_config.created_at的记录,避免把画像
当时本来就是空的记录也补出假意向。产出结果不自动联动outreach_eligible/派发,
人工复核候选名单后再手动放行,防止backfill误触发真实私信发给不该发的人。"
```

---

### Task 4: 全量测试 + staging 真机验证（收尾）

**Files:**
- 无新文件，验证收尾

- [ ] **Step 1: 跑全量 API 测试确认无回归**

Run: `cd apps/api && npx vitest run`
Expected: 全部 PASS，无既有测试因本次改动变红。

- [ ] **Step 2: staging 真机验证 DeepSeek 判定链路（人工步骤，记录结果）**

对 staging tenant `6dbea700-1954-45ee-8fa5-7a6d54170bc6`（已有 target_profile_desc）重新触发一次采集（或直接构造一条测试评论调用 `/api/acquisition/collect/report`），确认：
- API 日志出现判定请求（无 `[comment-grading] target_profile_desc 为空` 或 `TOAPIS_API_KEY 未配置` 的 warn/error）
- 新评论对应的 `acquisition_lead_comments.grade` 非 null
- 若评论内容含明确购买意向（如"多少钱""求推荐"），对应 lead 的 `outreach_eligible` 变为 `true`

记录结果到 PR 描述里，作为「已亲眼验证真实调用链路」的证据（systematic-debugging Phase 4「Verify Fix」+ ZenithJoy CLAUDE.md「真机 bug 修复须回流 smoke」的等价人工验证，真机段暂无自动化 smoke 覆盖，标 TODO）。

- [ ] **Step 3: dry-run 跑一次 backfill 脚本，人工确认候选名单**

Run: `cd apps/api && npx ts-node src/scripts/backfill-null-grade-leads.ts --dry-run`（需连 staging DB 的 env）
Expected: 打印苏彦卿那批 22 条中「画像创建时间之后」的候选子集（预期基本是全部 22 条，因为 07-18 15:58 建的画像早于 07-18 16:00~07-19 05:06 的采集窗口）。跟用户过一遍名单，确认后再去掉 `--dry-run` 正式写 `grade`。

- [ ] **Step 4: 正式跑 backfill（非 dry-run），人工复核后手动触发 rescore**

Run: `cd apps/api && npx ts-node src/scripts/backfill-null-grade-leads.ts`
对输出里 grade 为「高意向」或「精准」的 lead，人工确认要不要放行派送后，调用：
```bash
curl -s -X POST localhost:5200/api/acquisition/rescore-lead \
  -H "Content-Type: application/json" -H "X-Tenant-Id: 6dbea700-1954-45ee-8fa5-7a6d54170bc6" \
  -d '{"lead_id": "<确认放行的lead id>"}'
```
