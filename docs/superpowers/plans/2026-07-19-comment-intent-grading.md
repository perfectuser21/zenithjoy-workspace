# Path2 评论区留言 AI 意向分档判定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补上 Path2 Seg3→Seg4 之间缺失的"第二个 AI 判定"——对评论区留言做意向分档（高意向/精准/感兴趣/其他），让 `outreach_eligible` 真正有机会变 true，Seg4 私信派单从结构性不可能变成可能。

**Architecture:** Seg2 音频判定（`content-judgment.ts`）顺带把 Gemini 转写出的文案落库；新建 `comment-grading.ts` 服务（镜像 `content-judgment.ts` 的组织方式），在 `/collect/report` 处理评论批次前，用"标题+转写文案+目标客户画像"批量调 Gemini 给每条评论打档，写进已存在的 `acquisition_lead_comments.grade` 列。

**Tech Stack:** TypeScript, Express, PostgreSQL, axios（走 TOAPIS/Gemini 代理），vitest。

## Global Constraints

- 不改 Android 端代码
- 不做 per-comment 独立 Gemini 调用，必须批量（一个视频的评论一次 Gemini 调用）
- grade 复用 `acquisition_lead_comments.grade` 已有列，不新建列
- 判定失败/超时 → 整批返回 null，不抛异常，不阻塞 `/collect/report` 主流程
- 空画像 → 不调用 Gemini，全部返回 null（对齐 Seg2 INV-6 的保守哲学，但方向相反：Seg2 空画像默认"全部放行"，这里空画像默认"全部不发"——因为误判后果不对称，见 PrepPRD 判定点登记表）

---

### Task 1: 新增 migration，`acquisition_collect_videos` 加 `transcript` 列

**Files:**
- Create: `apps/api/db/migrations/20260719_180000_acquisition_collect_videos_transcript.sql`

**Interfaces:**
- Produces: `zenithjoy.acquisition_collect_videos.transcript`（text，nullable）供 Task 2/Task 4 使用

- [ ] **Step 1: 写 migration 文件**

```sql
-- apps/api/db/migrations/20260719_180000_acquisition_collect_videos_transcript.sql
-- Path2 评论区留言AI意向分档判定（decision 4e421ae8）：Seg2 音频判定时 Gemini 内部转写出的
-- 文案此前从不落库，只用于当次判定、判完即弃。本列把转写文案存下来，供 Seg3→Seg4 之间新增的
-- "评论意向分档"判定使用完整"标题+转写文案"，而不只是标题。

ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS transcript text;

COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.transcript IS
  'Seg2音频判定时Gemini转写出的文案（仅capture_type=audio时产出），供评论意向分档判定使用完整视频文案';
```

- [ ] **Step 2: 本地跑一次 migration 确认无报错**

Run: `cd apps/api && npx ts-node db/migrations/run-migration.ts`
Expected: 输出包含这个新文件名，无报错退出

- [ ] **Step 3: 验证列真的存在**

Run: `psql "$DATABASE_URL" -c "\d zenithjoy.acquisition_collect_videos" | grep transcript`（或用 `zenithjoy_test` 连接串，取决于本机 `DATABASE_URL` 指向哪个库；至少要在本地跑单测/集成测试用的库上验证过一次）
Expected: 输出含 `transcript | text`

- [ ] **Step 4: commit**

```bash
git add apps/api/db/migrations/20260719_180000_acquisition_collect_videos_transcript.sql
git commit -m "feat(api): acquisition_collect_videos加transcript列，供评论意向分档判定用完整视频文案"
```

---

### Task 2: `content-judgment.ts` — Seg2 音频判定顺带落库转写文案

**Files:**
- Modify: `apps/api/src/services/content-judgment.ts`
- Test: `apps/api/src/services/content-judgment.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 1 的 `acquisition_collect_videos.transcript` 列
- Produces: 无新导出接口（纯内部落库副作用，`judgeVideo`/`JudgeVideoResult` 对外签名不变）

- [ ] **Step 1: 在现有 content-judgment.test.ts 里追加失败用例**

在文件末尾（最后一个 `it(...)` 之后、`describe` 块收尾 `});` 之前）追加：

```typescript

  /**
   * 回归（2026-07-19，decision 4e421ae8）：audio分支判定matched时，Gemini响应里的
   * "转写：..."那一行必须被解析出来，作为transcript参数传给写库（UPDATE语句参数列表里
   * 能找到这段转写文字）——供后续新增的评论意向分档判定使用完整视频文案。
   */
  it('回归: audio分支判定matched时转写文案被解析并传入UPDATE写库', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED\n转写：这是测试转写文案内容' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-transcript-001',
      'video-transcript-001',
      'audio',
      btoa('fake-pcm-wav-data'),
      undefined,
      undefined,
      '装修视频标题',
    );

    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) => /UPDATE.*collect_videos/i.test(text));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = updateCalls[updateCalls.length - 1] as [string, unknown[]];
    expect(params).toContain('这是测试转写文案内容');
  });

  it('回归: screenshot分支不要求转写，UPDATE参数里transcript传null', async () => {
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: 'MATCHED' } }] },
    } as never);

    const pool = makePool({ targetProfileDesc: '家装/室内设计目标客户' });
    await judgeVideo(
      pool,
      'tenant-transcript-002',
      'video-transcript-002',
      'screenshot',
      btoa('fake-screenshot'),
    );

    const mockQuery = pool.query as ReturnType<typeof vi.fn>;
    const updateCalls = mockQuery.mock.calls.filter(([text]: [string]) => /UPDATE.*collect_videos/i.test(text));
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = updateCalls[updateCalls.length - 1] as [string, unknown[]];
    expect(params).not.toContain('这是测试转写文案内容');
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npm test -- content-judgment.test.ts`
Expected: 新增的第一条用例 FAIL（`params` 里找不到转写文字，因为解析逻辑还没写）；第二条用例大概率也 FAIL 或碰巧过（取决于当前 UPDATE 参数个数），不用纠结，先看 RED 状态整体符合预期即可

- [ ] **Step 3: commit（commit-1 RED）**

```bash
git add apps/api/src/services/content-judgment.test.ts
git commit -m "test(api): Seg2音频判定须解析并落库转写文案（RED，decision 4e421ae8）"
```

- [ ] **Step 4: 实现 — 修改 `buildPrompt`**

把 `apps/api/src/services/content-judgment.ts` 里的：

```typescript
function buildPrompt(targetProfileDesc: string, captureType: string, title?: string): string {
  // 用户2026-07-17拍板（判定点1d078987，decision f3dbc2ce）：video 类型走音频转写判定——
  // 先转写这段音频内容，再结合视频标题和转写文案共同判断，单次多模态调用内完成
  // 转写+判定两步，不新增独立转写API调用（避免过度设计成两阶段架构）。
  const mediaInstruction =
    captureType === 'audio'
      ? title
        ? `这是一段视频开头20秒的音频片段，视频标题是《${title}》。请先在心里转写这段音频的内容，再结合标题和转写内容共同判断`
        : `这是一段视频开头20秒的音频片段。请先在心里转写这段音频的内容，再结合转写内容判断`
      : '判断这段屏幕截图中的内容';
  return `你是一个内容判决助手。根据以下目标客户画像，${mediaInstruction}是否匹配目标客户群体。

目标客户画像：
${targetProfileDesc}

判断规则：
1. 如果视频内容与目标客户画像高度相关（评论区可能有潜在客户），回复：MATCHED
2. 如果视频内容与目标客户画像明显不相关，回复：REJECTED，并简短说明原因（不超过 30 字）
3. 如果无法判断，回复：MATCHED（保守策略，不漏过潜在客户）

请严格按格式回复，第一行必须是 MATCHED 或 REJECTED，如果是 REJECTED 则第二行说明原因：
MATCHED
或
REJECTED
原因：...`;
}
```

改为（`在心里转写` 改成明确要求输出转写文字，新增 `transcriptInstruction`）：

```typescript
function buildPrompt(targetProfileDesc: string, captureType: string, title?: string): string {
  // 用户2026-07-17拍板（判定点1d078987，decision f3dbc2ce）：video 类型走音频转写判定——
  // 先转写这段音频内容，再结合视频标题和转写文案共同判断，单次多模态调用内完成
  // 转写+判定两步，不新增独立转写API调用（避免过度设计成两阶段架构）。
  // 2026-07-19（decision 4e421ae8）：转写文字现在要求 Gemini 明确输出（不再只在"心里"转写），
  // 落库供 Seg3→Seg4 之间新增的评论意向分档判定使用完整视频文案。
  const mediaInstruction =
    captureType === 'audio'
      ? title
        ? `这是一段视频开头20秒的音频片段，视频标题是《${title}》。请先转写这段音频的内容，再结合标题和转写内容共同判断`
        : `这是一段视频开头20秒的音频片段。请先转写这段音频的内容，再结合转写内容判断`
      : '判断这段屏幕截图中的内容';
  const transcriptInstruction = captureType === 'audio' ? '\n最后一行：转写：<音频转写出的完整文字内容>' : '';
  return `你是一个内容判决助手。根据以下目标客户画像，${mediaInstruction}是否匹配目标客户群体。

目标客户画像：
${targetProfileDesc}

判断规则：
1. 如果视频内容与目标客户画像高度相关（评论区可能有潜在客户），回复：MATCHED
2. 如果视频内容与目标客户画像明显不相关，回复：REJECTED，并简短说明原因（不超过 30 字）
3. 如果无法判断，回复：MATCHED（保守策略，不漏过潜在客户）

请严格按格式回复：
第一行：MATCHED 或 REJECTED
如果是 REJECTED，第二行：原因：...${transcriptInstruction}`;
}
```

- [ ] **Step 5: 实现 — 修改 `parseGeminiResponse` 新增转写提取 + 新增 `extractTranscript` 辅助函数**

把：

```typescript
function parseGeminiResponse(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  text: string,
): Promise<JudgeVideoResult> {
  const upper = text.trim().toUpperCase();
  if (upper.startsWith('MATCHED')) {
    return writeJudgment(pool, tenantId, videoId, captureType, 'matched', null).then(() => ({
      judgment_status: 'matched' as const,
    }));
  }
  if (upper.startsWith('REJECTED')) {
    // 提取原因（第二行）
    const lines = text.trim().split('\n');
    const reasonLine = lines.find(l => l.includes('原因：') || l.includes('原因:'));
    const reason = reasonLine?.replace(/^原因[：:]/, '').trim() ?? null;
    return writeJudgment(pool, tenantId, videoId, captureType, 'rejected', reason).then(() => ({
      judgment_status: 'rejected' as const,
      judgment_reason: reason,
    }));
  }
  // 无法解析 → 保守 matched
  return writeJudgment(pool, tenantId, videoId, captureType, 'matched', 'parse_fallback').then(() => ({
    judgment_status: 'matched' as const,
    judgment_reason: 'parse_fallback',
  }));
}
```

改为：

```typescript
function extractTranscript(text: string): string | null {
  const lines = text.trim().split('\n');
  const transcriptLine = lines.find(l => l.includes('转写：') || l.includes('转写:'));
  const extracted = transcriptLine?.replace(/^转写[：:]/, '').trim();
  return extracted || null;
}

function parseGeminiResponse(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  text: string,
): Promise<JudgeVideoResult> {
  const upper = text.trim().toUpperCase();
  const transcript = extractTranscript(text);
  if (upper.startsWith('MATCHED')) {
    return writeJudgment(pool, tenantId, videoId, captureType, 'matched', null, transcript).then(() => ({
      judgment_status: 'matched' as const,
    }));
  }
  if (upper.startsWith('REJECTED')) {
    // 提取原因（第二行）
    const lines = text.trim().split('\n');
    const reasonLine = lines.find(l => l.includes('原因：') || l.includes('原因:'));
    const reason = reasonLine?.replace(/^原因[：:]/, '').trim() ?? null;
    return writeJudgment(pool, tenantId, videoId, captureType, 'rejected', reason, transcript).then(() => ({
      judgment_status: 'rejected' as const,
      judgment_reason: reason,
    }));
  }
  // 无法解析 → 保守 matched
  return writeJudgment(pool, tenantId, videoId, captureType, 'matched', 'parse_fallback', transcript).then(() => ({
    judgment_status: 'matched' as const,
    judgment_reason: 'parse_fallback',
  }));
}
```

- [ ] **Step 6: 实现 — 修改 `writeJudgment` 新增 transcript 参数**

把：

```typescript
async function writeJudgment(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  status: string,
  reason: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_videos
        SET judgment_status = $3, judgment_reason = $4, capture_type = $5, updated_at = now()
      WHERE tenant_id = $1 AND video_id = $2`,
    [tenantId, videoId, status, reason, captureType]
  );
}
```

改为：

```typescript
async function writeJudgment(
  pool: QueryablePool,
  tenantId: string,
  videoId: string,
  captureType: string,
  status: string,
  reason: string | null,
  transcript?: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE zenithjoy.acquisition_collect_videos
        SET judgment_status = $3, judgment_reason = $4, capture_type = $5,
            transcript = COALESCE($6, transcript), updated_at = now()
      WHERE tenant_id = $1 AND video_id = $2`,
    [tenantId, videoId, status, reason, captureType, transcript ?? null]
  );
}
```

（`COALESCE($6, transcript)` 是关键：`transcript` 参数缺省/null 时保留数据库里已有值，不会被 screenshot 分支或缓存命中分支意外清空。）

- [ ] **Step 7: 运行测试确认通过**

Run: `cd apps/api && npm test -- content-judgment.test.ts`
Expected: 全部用例 PASS（含 Task 2 新增的 2 条）

- [ ] **Step 8: commit（commit-2 GREEN）**

```bash
git add apps/api/src/services/content-judgment.ts
git commit -m "fix(api): Seg2音频判定Gemini响应新增转写文案解析，落库供评论意向分档判定使用"
```

---

### Task 3: 新增 `comment-grading.ts` 服务 + 单测

**Files:**
- Create: `apps/api/src/services/comment-grading.ts`
- Test: `apps/api/src/services/comment-grading.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface GradeCommentsInput {
    commentText: string | null | undefined;
  }
  export async function gradeComments(
    targetProfileDesc: string,
    videoTitle: string | null,
    videoTranscript: string | null,
    comments: GradeCommentsInput[],
  ): Promise<(string | null)[]>
  ```
  返回数组长度、顺序与入参 `comments` 一一对应。Task 4 会 import 并调用这个函数。

- [ ] **Step 1: 写失败的单测**

新建 `apps/api/src/services/comment-grading.test.ts`：

```typescript
/**
 * comment-grading.test.ts — commit-1 Red
 *
 * 评论区留言AI意向分档判定（decision 4e421ae8）：补齐Path2 Seg3→Seg4之间缺失的判定环节。
 * acquisition_lead_comments.grade / acquisition_leads.outreach_eligible 的打分公式
 * （computeRelevanceScore/rescoreLead）早已写好，但没有任何地方真正产生grade值——本文件
 * 测的就是"产生grade值"这一步。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gradeComments } from './comment-grading';
import axios from 'axios';

vi.mock('axios');

describe('comment-grading gradeComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOAPIS_API_KEY = 'test-toapis-key';
  });

  it('空画像 → 不调用Gemini，全部返回null', async () => {
    const mockedPost = vi.mocked(axios.post);
    const result = await gradeComments('', '标题', null, [{ commentText: '预算10万求推荐' }]);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result).toEqual([null]);
  });

  it('空评论数组 → 不调用Gemini，返回空数组', async () => {
    const mockedPost = vi.mocked(axios.post);
    const result = await gradeComments('家装目标客户', '标题', null, []);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('正常批量解析：3条评论对应3个档位，顺序一一对应', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向\n2. 其他\n3. 精准' } }] },
    } as never);

    const result = await gradeComments('家装目标客户', '标题', '转写文案', [
      { commentText: '预算10万求推荐' },
      { commentText: '哈哈哈' },
      { commentText: '这个多少钱' },
    ]);
    expect(result).toEqual(['高意向', '其他', '精准']);
  });

  it('解析失败的行不影响其它行，该位置为null', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向\n乱七八糟\n3. 精准' } }] },
    } as never);

    const result = await gradeComments('家装目标客户', '标题', null, [
      { commentText: 'a' },
      { commentText: 'b' },
      { commentText: 'c' },
    ]);
    expect(result).toEqual(['高意向', null, '精准']);
  });

  it('Gemini调用异常 → 整批返回全null，不抛异常', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockRejectedValue(new Error('timeout'));

    const result = await gradeComments('家装目标客户', '标题', null, [
      { commentText: 'a' },
      { commentText: 'b' },
    ]);
    expect(result).toEqual([null, null]);
  });

  it('TOAPIS_API_KEY未配置 → 不调用Gemini，全部返回null', async () => {
    delete process.env.TOAPIS_API_KEY;
    const mockedPost = vi.mocked(axios.post);
    const result = await gradeComments('家装目标客户', '标题', null, [{ commentText: 'a' }]);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result).toEqual([null]);
  });

  it('批量请求走OpenAI式chat/completions（与content-judgment.ts同一通道）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向' } }] },
    } as never);

    await gradeComments('家装目标客户', '标题', null, [{ commentText: '预算10万求推荐' }]);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toContain('/chat/completions');
    const messages = body.messages as Array<{ content: string }>;
    expect(messages[0].content).toContain('预算10万求推荐');
    expect(messages[0].content).toContain('标题');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/api && npm test -- comment-grading.test.ts`
Expected: FAIL（`Cannot find module './comment-grading'`）

- [ ] **Step 3: 注册进 test-registry.yaml + commit（commit-1 RED）**

先照 `content-judgment.test.ts` 在 `test-registry.yaml` 里的现有条目格式抄一条（`grep -n "content-judgment.test.ts" test-registry.yaml` 找到那条参考格式），新增一条 `comment-grading.test.ts` 的注册项。

```bash
git add apps/api/src/services/comment-grading.test.ts test-registry.yaml
git commit -m "test(api): 评论意向分档判定gradeComments（RED，decision 4e421ae8）"
```

- [ ] **Step 4: 实现 `comment-grading.ts`**

```typescript
/**
 * comment-grading.ts — 评论区留言AI意向分档判定
 *
 * 职责：
 *   1. 批量对一个视频下的评论区留言做意向分档（高意向/精准/感兴趣/其他）
 *   2. 空画像/空评论 → 直接返回全 null，不调用 Gemini（省钱；空画像时无法判断意向，保守不发）
 *   3. 调用失败/超时 → 整批返回全 null，不抛异常（不能拖垮 /collect/report 主流程）
 *
 * Gemini 调用：通过 TOAPIS_API_KEY 走 ToAPIs 代理，与 content-judgment.ts 同一通道。
 *
 * 判定点（decision 4e421ae8）：解析失败/无法判断时一律归入"其他"档（本函数里体现为 null，
 * 落库后 gradeWeight(null) 也会落进最低档）——宁可漏判高意向客户，不可误判陌生人为高意向
 * 去真实打扰。跟 content-judgment.ts 的"无法判断保守 matched"哲学方向相反，因为这里误判
 * 的后果是"真实发送私信"，比"多截一段视频"重得多。
 */
import axios from 'axios';

const GRADING_TIMEOUT_MS = 20_000;
const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
const GRADING_MODEL = 'gemini-2.5-flash-official';

const VALID_GRADES = ['高意向', '精准', '感兴趣', '其他'] as const;

export interface GradeCommentsInput {
  commentText: string | null | undefined;
}

export async function gradeComments(
  targetProfileDesc: string,
  videoTitle: string | null,
  videoTranscript: string | null,
  comments: GradeCommentsInput[],
): Promise<(string | null)[]> {
  if (!targetProfileDesc || targetProfileDesc.trim() === '') {
    return comments.map(() => null);
  }
  if (comments.length === 0) {
    return [];
  }
  const apiKey = process.env.TOAPIS_API_KEY;
  if (!apiKey) {
    console.error('[comment-grading] TOAPIS_API_KEY 未配置，跳过判定');
    return comments.map(() => null);
  }

  const prompt = buildPrompt(targetProfileDesc, videoTitle, videoTranscript, comments);

  try {
    const resp = await axios.post(
      `${TOAPIS_BASE}/chat/completions`,
      {
        model: GRADING_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: GRADING_TIMEOUT_MS,
      }
    );
    const text: string = resp.data?.choices?.[0]?.message?.content ?? '';
    return parseGrades(text, comments.length);
  } catch (err) {
    console.error('[comment-grading] Gemini 调用失败:', (err as Error).message);
    return comments.map(() => null);
  }
}

function buildPrompt(
  targetProfileDesc: string,
  videoTitle: string | null,
  videoTranscript: string | null,
  comments: GradeCommentsInput[],
): string {
  const commentLines = comments
    .map((c, i) => `${i + 1}. ${c.commentText ?? '（空评论）'}`)
    .join('\n');
  return `你是一个客户意向分级助手。这是一个抖音视频的信息：

视频标题：${videoTitle || '（无标题）'}
视频文案（转写）：${videoTranscript || '（无转写文案）'}

目标客户画像：
${targetProfileDesc}

以下是这个视频下的 ${comments.length} 条评论区留言，请逐条判断留言者的购买意向档位。

档位定义（四选一）：
- 高意向：留言明确表达购买/预约/咨询价格/求推荐等强购买信号
- 精准：留言内容与目标客户画像高度吻合，但没有直接购买信号
- 感兴趣：留言与视频/画像有关联但意向较弱
- 其他：无关评论、灌水、纯表情、无法判断

请严格按以下格式逐行回复，每条留言一行，不要合并、不要跳过、不要加多余说明：
1. <档位>
2. <档位>
...

留言列表：
${commentLines}`;
}

function parseGrades(text: string, count: number): (string | null)[] {
  const grades: (string | null)[] = new Array(count).fill(null);
  const lines = text.trim().split('\n');
  const lineRe = /^\s*(\d+)\.\s*(高意向|精准|感兴趣|其他)/;
  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;
    const idx = parseInt(m[1], 10) - 1;
    const grade = m[2];
    if (idx >= 0 && idx < count && (VALID_GRADES as readonly string[]).includes(grade)) {
      grades[idx] = grade;
    }
  }
  return grades;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd apps/api && npm test -- comment-grading.test.ts`
Expected: 7/7 PASS

- [ ] **Step 6: commit（commit-2 GREEN）**

```bash
git add apps/api/src/services/comment-grading.ts
git commit -m "feat(api): 新增评论意向分档判定gradeComments，补齐Seg3→Seg4缺失环节"
```

---

### Task 4: 接入 `/collect/report` 路由

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`
- Test: `apps/api/tests/integration/p2-line02-content-judgment/collect-report-comment-grading.integration.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `gradeComments(targetProfileDesc, videoTitle, videoTranscript, comments): Promise<(string|null)[]>`

- [ ] **Step 1: 先确认 `testPool`/`createTestTenant` helper 用法**

`grep -n "createTestTenant\|testPool" apps/api/tests/integration/helpers.ts`，确认签名与 `apps/api/tests/integration/p2-line02-content-judgment/` 目录下现有测试（如 `pending-collect-tasks-video-titles.integration.test.ts`）的 beforeAll/afterAll 清理模式一致，照抄格式。

**Step 2: 写失败的集成测试**

新建 `apps/api/tests/integration/p2-line02-content-judgment/collect-report-comment-grading.integration.test.ts`：

```typescript
/**
 * /collect/report 评论意向分档真实落库 — [REGRESSION]
 *
 * 2026-07-19 真机验证音频判定fix全链路时发现：acquisition_leads.outreach_eligible 永远
 * false，Seg4 私信从未真实触发——根因是 grade 字段从来没有任何地方真正产生过值（安卓端
 * 上报评论从不带grade，服务端也没有AI判定环节）。本测试验证接入 gradeComments 之后，
 * /collect/report 真实落库的 grade 能驱动 rescoreLead 算出 outreach_eligible=true。
 *
 * commit-1 时 RED（gradeComments 还没接入路由，grade 落库为 null，outreach_eligible 恒 false）；
 * commit-2 GREEN。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import app from '../../../src/app';
import { testPool, createTestTenant } from '../helpers';

vi.mock('axios');

let tenantId: string;
let taskId: string;
const RND = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const VIDEO_ID = `grading-vid-${RND}`;

beforeAll(async () => {
  const tenant = await createTestTenant(`comment-grading-test-${RND}`);
  tenantId = tenant.id;

  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_config (tenant_id, target_profile_desc)
     VALUES ($1, $2)
     ON CONFLICT (tenant_id) DO UPDATE SET target_profile_desc = EXCLUDED.target_profile_desc`,
    [tenantId, '装修行业目标客户，准备装修的业主']
  );

  const tRes = await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_tasks (tenant_id, keywords, status)
     VALUES ($1, $2::jsonb, 'running')
     RETURNING id`,
    [tenantId, JSON.stringify(['装修'])]
  );
  taskId = tRes.rows[0].id;

  await testPool.query(
    `INSERT INTO zenithjoy.acquisition_collect_videos (video_id, task_id, tenant_id, title)
     VALUES ($1, $2, $3, $4)`,
    [VIDEO_ID, taskId, tenantId, '装修保姆级教学']
  );
});

afterAll(async () => {
  await testPool.query('DELETE FROM zenithjoy.acquisition_lead_comments WHERE video_id = $1', [VIDEO_ID]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_leads WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_collect_tasks WHERE id = $1', [taskId]);
  await testPool.query('DELETE FROM zenithjoy.acquisition_config WHERE tenant_id = $1', [tenantId]);
  await testPool.query('DELETE FROM zenithjoy.tenants WHERE id = $1', [tenantId]);
});

describe('POST /collect/report 评论意向分档真实落库 [REGRESSION]', () => {
  it('Gemini判定"精准"时grade真实落库且outreach_eligible变true', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 精准' } }] },
    } as never);

    const res = await request(app)
      .post('/api/acquisition/collect/report')
      .send({
        task_id: taskId,
        video_id: VIDEO_ID,
        commenters: [
          { nickname: `grading-nick-${RND}`, comment_text: '预算10万求推荐', douyin_id: `grading-douyin-${RND}` },
        ],
        terminal: false,
      });

    expect(res.status).toBe(200);

    const leadRes = await testPool.query(
      `SELECT id, outreach_eligible FROM zenithjoy.acquisition_leads WHERE tenant_id = $1 AND nickname = $2`,
      [tenantId, `grading-nick-${RND}`]
    );
    expect(leadRes.rows.length).toBe(1);
    expect(leadRes.rows[0].outreach_eligible).toBe(true);

    const commentRes = await testPool.query(
      `SELECT grade FROM zenithjoy.acquisition_lead_comments WHERE lead_id = $1`,
      [leadRes.rows[0].id]
    );
    expect(commentRes.rows[0].grade).toBe('精准');
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd apps/api && npm run test:integration -- collect-report-comment-grading.integration.test.ts`
Expected: FAIL（`leadRes.rows[0].outreach_eligible` 是 `null`/`false`，`commentRes.rows[0].grade` 是 `null`，因为路由还没接 gradeComments）

- [ ] **Step 4: 注册进 test-registry.yaml + commit（commit-1 RED）**

照同目录其它 integration test 条目格式（`grep -n "pending-collect-tasks-video-titles" test-registry.yaml` 找参考格式），新增一条。

```bash
git add apps/api/tests/integration/p2-line02-content-judgment/collect-report-comment-grading.integration.test.ts test-registry.yaml
git commit -m "test(api): collect/report须接评论意向分档判定（RED，decision 4e421ae8）"
```

- [ ] **Step 5: 实现 — 修改 `acquisition.ts`**

先在文件顶部 import 区（跟其它 service import 放一起，例如紧挨着 `import { judgeVideo } from '../services/content-judgment';` 那一行）新增：

```typescript
import { gradeComments } from '../services/comment-grading';
```

在 `/collect/report` 路由里，找到（大致原文，`cancelling` 分支之后、"去重落库"注释之前）：

```typescript
    // ── 去重落库：先处理 commenters（已抓先落库不丢，即使本次是终态回报）──
    let inserted = 0;
    let deduped = 0;
    const seenSec = new Set<string>();
    const seenNick = new Set<string>();

    for (const c of batch) {
```

改为：

```typescript
    // ── 评论意向分档判定（decision 4e421ae8）：批量对这一批评论调 Gemini 判档，
    // 结果覆盖 c.grade（客户端从不传这个字段，见 CommentEntry.toCollectReportMap）。
    const videoInfoRes = await client.query<{ title: string | null; transcript: string | null }>(
      `SELECT title, transcript FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1 AND video_id = $2`,
      [taskId, videoId]
    );
    const videoTitleForGrading = videoInfoRes.rows[0]?.title ?? videoTitle ?? null;
    const videoTranscript = videoInfoRes.rows[0]?.transcript ?? null;
    const gradingConfigRes = await client.query<{ target_profile_desc: string | null }>(
      `SELECT target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );
    const targetProfileDescForGrading = gradingConfigRes.rows[0]?.target_profile_desc ?? '';
    const grades = await gradeComments(
      targetProfileDescForGrading,
      videoTitleForGrading,
      videoTranscript,
      batch.map((c) => ({ commentText: c.comment_text })),
    );

    // ── 去重落库：先处理 commenters（已抓先落库不丢，即使本次是终态回报）──
    let inserted = 0;
    let deduped = 0;
    const seenSec = new Set<string>();
    const seenNick = new Set<string>();

    for (const [index, c] of batch.entries()) {
```

然后在循环体内，找到（去重/matched 分支，大致原文）：

```typescript
          await client.query(
            `INSERT INTO zenithjoy.acquisition_lead_comments
               (lead_id, video_id, comment_text, grade, commented_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [matchId, videoId, c.comment_text ?? null, c.grade ?? null]
          );
```

改为：

```typescript
          await client.query(
            `INSERT INTO zenithjoy.acquisition_lead_comments
               (lead_id, video_id, comment_text, grade, commented_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [matchId, videoId, c.comment_text ?? null, grades[index] ?? c.grade ?? null]
          );
```

找到（新建 lead 分支的 `acquisition_leads` INSERT，大致原文）：

```typescript
      const insRes = await client.query(
        `INSERT INTO zenithjoy.acquisition_leads
           (tenant_id, collect_task_id, sec_uid, nickname, profile_url, partial, source_video_ids,
            comment_text, grade, keyword, douyin_id, feishu_write_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, 'local_only')
         RETURNING id`,
        [tenantId, taskId, secUid, c.nickname, secUid ? profileUrlForSecUid(secUid) : c.nickname, false,
         JSON.stringify([videoId]), c.comment_text ?? null, c.grade ?? null, c.keyword ?? keyword ?? null, douyinId]
      );
```

改为：

```typescript
      const insRes = await client.query(
        `INSERT INTO zenithjoy.acquisition_leads
           (tenant_id, collect_task_id, sec_uid, nickname, profile_url, partial, source_video_ids,
            comment_text, grade, keyword, douyin_id, feishu_write_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, 'local_only')
         RETURNING id`,
        [tenantId, taskId, secUid, c.nickname, secUid ? profileUrlForSecUid(secUid) : c.nickname, false,
         JSON.stringify([videoId]), c.comment_text ?? null, grades[index] ?? c.grade ?? null, c.keyword ?? keyword ?? null, douyinId]
      );
```

找到（新建 lead 分支的 `acquisition_lead_comments` INSERT，大致原文——注意这段跟去重分支那段文字几乎一样，靠上下文的 `newLeadId` 区分）：

```typescript
      await client.query(
        `INSERT INTO zenithjoy.acquisition_lead_comments
           (lead_id, video_id, comment_text, grade, commented_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [newLeadId, videoId, c.comment_text ?? null, c.grade ?? null]
      );
```

改为：

```typescript
      await client.query(
        `INSERT INTO zenithjoy.acquisition_lead_comments
           (lead_id, video_id, comment_text, grade, commented_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [newLeadId, videoId, c.comment_text ?? null, grades[index] ?? c.grade ?? null]
      );
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd apps/api && npm run test:integration -- collect-report-comment-grading.integration.test.ts`
Expected: PASS

- [ ] **Step 7: 全量回归**

Run:
```bash
cd apps/api
npm test
npm run test:integration
npx tsc --noEmit
```
Expected: 单测/集成测试全部通过（除已知的 2 个预置无关失败：`simple-rate-limit`/`voice-outreach` 缺包问题如果本机 node_modules 又缺了、以及 `tenant-memory.integration.test.ts` 2 条无关失败——如果这次环境里这两个包已经装好，应该全绿，不用特意去复现旧问题）；`tsc --noEmit` 无新增类型错误

- [ ] **Step 8: commit（commit-2 GREEN）**

```bash
git add apps/api/src/routes/acquisition.ts
git commit -m "feat(api): /collect/report接入评论意向分档判定，outreach_eligible终于有机会真变true"
```

---

## 收尾

- [ ] 用 `superpowers:finishing-a-development-branch` 收尾（Tier-1 自主默认 Option 2：push + PR）
- [ ] PR 描述里明确写清楚：这是补齐 Path2 Seg3→Seg4 之间的真实功能缺口，附上 PrepPRD 里的根因说明
