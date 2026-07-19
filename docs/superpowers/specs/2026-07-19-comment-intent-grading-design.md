# Path2 评论区留言 AI 意向分档判定 — 设计

## 背景

见 `sprints/07191822-comment-intent-grading/prep-prd.md`。核心问题：`acquisition_lead_comments.grade` / `acquisition_leads.outreach_eligible` 的打分公式（`computeRelevanceScore`/`rescoreLead`，`acquisition-dispatch.ts`）早已写好，但没有任何地方真正产生 `grade` 值——安卓端上报评论从不带这个字段，服务端也没有 AI 判定环节。本次补上这个"第二个 AI"环节。

## 架构

```
Seg2 判定（content-judgment.ts callGemini，audio分支）
  → 【改】Gemini prompt 新增指令：先转写、再判定，最后一行输出"转写：<文字>"
  → 【改】parseGeminiResponse 额外提取转写文本
  → 【改】writeJudgment 新增 transcript 参数，一并写入 acquisition_collect_videos.transcript（新列）

Seg3 上报评论（acquisition.ts /collect/report 路由）
  → 【新增】在处理 batch(commenters) 之前，先查这个 video_id 的 title + transcript
  → 【新增】调用 gradeComments(pool, targetProfileDesc, videoTitle, videoTranscript, batch)
     → 单次 Gemini 调用，批量对 batch 里所有评论文本判档
     → 返回 grade[]（与 batch 顺序一一对应，解析失败的位置为 null）
  → 原有落库循环里 c.grade 改为 gradedResult[i]（不再用客户端传的 c.grade，AI 判定结果覆盖）
  → 其余逻辑不变（rescoreLead 已经会用这个 grade 算 outreach_eligible）
```

## 组件

### 1. `apps/api/db/migrations/<timestamp>_acquisition_collect_videos_transcript.sql`（新建）

```sql
ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS transcript text;

COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.transcript IS
  'Seg2音频判定时Gemini转写出的文案（仅audio分支产出），供Seg3评论意向分档判定用完整视频文案而不只是标题';
```

### 2. `content-judgment.ts` 改动

- `buildPrompt()`：audio 分支 prompt 追加最后一行输出要求：
  ```
  第三行（如果第一行是MATCHED；REJECTED时可省略）：转写：<音频转写出的完整文字内容>
  ```
  完整改法见实施计划。

- `parseGeminiResponse()`：新增从 text 里提取"转写："那一行的逻辑（`lines.find(l => l.includes('转写：') || l.includes('转写:'))`），提取出的 transcript 传给 `writeJudgment`。

- `writeJudgment()` / `markPending()`：新增可选 `transcript?: string | null` 参数，UPDATE 语句新增 `transcript = COALESCE($N, transcript)` 字段（`COALESCE` 避免 REJECTED/screenshot 分支覆盖已有值为 null）。

- `JudgeVideoResult` 类型：不需要新增字段（transcript 是落库副作用，不需要透传回 API 响应体——`/judge-video` 调用方是 Android，Android 不需要转写文本）。

### 3. 新文件：`apps/api/src/services/comment-grading.ts`

镜像 `content-judgment.ts` 的组织方式：

```ts
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

- 空画像（`targetProfileDesc` 为空）→ 直接全部返回 `null`（不调用 Gemini，省钱；对应 Seg2 INV-6 的"空画像=全部matched"哲学的镜像：这里"空画像=无法判断意向，不触发私信"，选择保守）
- 空 `comments` 数组 → 直接返回 `[]`，不调用 Gemini
- 单次批量 Gemini 调用（走 TOAPIS `/chat/completions`，纯文本，不带多模态 part），prompt 见下方
- 解析响应：按行提取每条评论对应档位，解析失败的位置填 `null`
- 调用失败/超时（复用 `JUDGMENT_TIMEOUT_MS` 同等超时）→ 整批返回全 `null` 数组，不抛异常（调用方 `/collect/report` 不能因为这个失败而 500）

**Prompt 设计**：

```
你是一个客户意向分级助手。这是一个抖音视频的信息：

视频标题：{videoTitle || '（无标题）'}
视频文案（转写）：{videoTranscript || '（无转写文案）'}

目标客户画像：
{targetProfileDesc}

以下是这个视频下的 {N} 条评论区留言，请逐条判断留言者的购买意向档位。

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
1. {comment_1}
2. {comment_2}
...
```

解析：对响应文本按行匹配 `^\s*(\d+)\.\s*(高意向|精准|感兴趣|其他)`，按捕获的序号回填对应位置；序号缺失或档位文字不在四选一里的行 → 该位置留 `null`（保守：宁可漏判为"不发"，不可误判为"高意向"去真实打扰陌生人——这个不对称在 PrepPRD 判定点里已登记）。

### 4. `acquisition.ts` 的 `/collect/report` 路由改动

在事务开始、处理 `batch` 循环之前（获取 `task`/`videoTitle` 等信息之后），新增：

```ts
// 拿这个 video 已存的 title/transcript（Stage1 report-videos 或 Seg2 判定时可能已写入）
const videoInfoRes = await client.query<{ title: string | null; transcript: string | null }>(
  `SELECT title, transcript FROM zenithjoy.acquisition_collect_videos WHERE task_id = $1 AND video_id = $2`,
  [taskId, videoId]
);
const videoTitleForGrading = videoInfoRes.rows[0]?.title ?? videoTitle ?? null;
const videoTranscript = videoInfoRes.rows[0]?.transcript ?? null;

const configRes = await client.query<{ target_profile_desc: string | null }>(
  `SELECT target_profile_desc FROM zenithjoy.acquisition_config WHERE tenant_id = $1 LIMIT 1`,
  [tenantId]
);
const targetProfileDesc = configRes.rows[0]?.target_profile_desc ?? '';

const grades = await gradeComments(
  targetProfileDesc,
  videoTitleForGrading,
  videoTranscript,
  batch.map((c) => ({ commentText: c.comment_text })),
);
```

原有落库循环里两处 `c.grade ?? null`（新建 lead 和追加评论历史两处）改为 `grades[index] ?? c.grade ?? null`（AI 判定优先，客户端传值仅作 fallback——理论上客户端永远不传，但不删这个兼容分支，YAGNI 之外的最小改动原则：不删无害的向后兼容代码）。

`for (const c of batch)` 循环需要改成 `for (const [index, c] of batch.entries())` 以拿到下标对齐 `grades[index]`。

## 判定点

已在 PrepPRD 登记表列出，不重复。

## 测试策略

**Unit（vitest，mock axios，镜像 content-judgment.test.ts 模式）**：
- `comment-grading.test.ts`：
  - 空画像 → 不调用 axios，全部返回 null
  - 空评论数组 → 不调用 axios，返回 `[]`
  - 正常批量解析：mock Gemini 返回 3 行"1. 高意向\n2. 其他\n3. 精准"，断言返回 `['高意向','其他','精准']`
  - 解析失败行（格式不对/档位不在四选一）→ 该位置为 null，不影响其它行
  - 调用超时/异常 → 整批返回全 null，不抛异常
- `content-judgment.test.ts` 新增用例：audio 分支 matched 时 `writeJudgment` 被调用时带上从响应文本解析出的 transcript

**Integration（真连 zenithjoy_test，vitest --config vitest.integration.config.ts）**：
- `/collect/report` 端到端：mock axios 让 Gemini 对某条评论返回"精准"，真实 POST 这个端点，断言 `acquisition_lead_comments.grade` 落库为"精准"，且 `acquisition_leads.outreach_eligible` 变为 true（验证 `rescoreLead` 真的吃到了新 grade）

**Trivial**：migration 文件本身走既有 migration 测试基础设施（如果有的话，没有则跳过，纯 DDL 风险低）。

**E2E**：留给下次真机 session，尽力而为，不阻塞本次 CI（PrepPRD 已注明）。

## 不包含
- 不改 Android 端
- 不做 per-comment 独立 Gemini 调用
- 不新增 grade 相关列
