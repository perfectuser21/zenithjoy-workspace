/**
 * comment-grading.ts — 评论区留言AI意向分档判定
 *
 * 职责：
 *   1. 批量对一个视频下的评论区留言做意向分档（高意向/精准/感兴趣/其他）
 *   2. 空画像/空评论 → 直接返回全 null，不调用 LLM（省钱；空画像时无法判断意向，保守不发）
 *   3. 调用失败/超时 → 整批返回全 null，不抛异常（不能拖垮 /collect/report 主流程）
 *
 * LLM 调用：通过 TOAPIS_API_KEY 走 ToAPIs 代理（与 content-judgment.ts 同一网关）。
 * 2026-07-21 用户拍板从 gemini-2.5-flash-official 换成 deepseek-v4-flash 降低成本
 * （decision 4346c90f）；2026-08-23 TOAPIS 侧 deepseek-v4-flash 所在渠道 #58 上游账户
 * 欠费（402 Insufficient Balance，无备用渠道），临时切 gpt-5.6-terra（用户 0823 现场
 * 拍板）——真机受控失败验证时发现该渠道本身不稳定（同一 prompt 连续调用 prompt_tokens
 * 从几百跳到 8000+、偶发整段格式错乱/超时，疑似后端多副本缓存串号），改切 gpt-5.4-mini
 * （同日真调对照：8/8 正确、token 数全程稳定，且是 TOAPIS 上使用量最高的模型之一）。
 * 渠道 #58 修好后可考虑换回 deepseek，模型名走 env 可覆盖，不必再改代码。
 *
 * 判定点（decision 4e421ae8）：解析失败/无法判断时一律归入"其他"档（本函数里体现为 null，
 * 落库后 gradeWeight(null) 也会落进最低档）——宁可漏判高意向客户，不可误判陌生人为高意向
 * 去真实打扰。跟 content-judgment.ts 的"无法判断保守 matched"哲学方向相反，因为这里误判
 * 的后果是"真实发送私信"，比"多截一段视频"重得多。
 */
import axios from 'axios';

const GRADING_TIMEOUT_MS = 20_000;
const TOAPIS_BASE = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
const GRADING_MODEL = process.env.GRADING_MODEL || 'gpt-5.4-mini';

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
    console.warn('[comment-grading] target_profile_desc 为空，跳过判定（保守返回 null，不代表系统故障——请检查该租户是否已在 dashboard 配置获客画像）');
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
        // 关掉思考链——这一行是这个功能能不能工作的开关，别删。
        //
        // deepseek-v4-flash 是 thinking 模型，TOAPIS 的 max_tokens 是**含 reasoning_tokens
        // 的 completion 总预算**。真机 0820 实测（decision fa247355）：25 条评论时
        // reasoning 直接顶到 500 封顶、content 是空字符串、finish_reason=length，
        // 整批 0/25 全变 null。而且消耗是随机的——同样 8 条评论两次跑分别烧 863/213 tokens，
        // 所以"再加点预算"救不了（12 条 @2000 连续两次照样全丢）。
        //
        // 这是 4 选 1 的短文本分类，本来就不需要思考链。关掉后：42 条评论用现有的
        // max_tokens=500 就是 42/42，耗时 5.9s → 2.3s，且三次复跑完全稳定。
        // 判准影响：与开思考的基准答案一致率 22/25，分歧的 3 条都是**关思考给得更低**
        //（精准→感兴趣、精准→其他、感兴趣→其他），与本文件头部那条已拍板的原则同向
        //（宁可漏判高意向，不可误判陌生人为高意向去真实打扰）。
        //
        // ⚠️ 该参数 deepseek/gpt-5.4-mini 都认（0823 真调实测 gpt-5.4-mini reasoning_tokens=0）；
        // gemini-2.5 收到后照样思考（实测 reasoning 仍是 189/577/572），
        // content-judgment.ts/locator-assist.ts 用 gemini 的地方只能靠给够 max_tokens，别照抄这行。
        reasoning_effort: 'none',
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: GRADING_TIMEOUT_MS,
      }
    );
    const choice = resp.data?.choices?.[0];
    const text: string = choice?.message?.content ?? '';

    // 截断守卫：万一网关哪天不认 reasoning_effort（参数被忽略 → 思考回来 → 预算被吃光），
    // 表现就是 finish_reason=length + content 空。这种情况必须留下可检索的 error 日志，
    // 不能只静默返回一批 null 让人以为"这些评论就是没意向"——真机就是这么瞒了一个多月。
    if (choice?.finish_reason === 'length') {
      console.error(
        `[comment-grading] 输出被 max_tokens 截断（finish_reason=length），${comments.length} 条留言整批未分档。` +
        '大概率是 reasoning_effort=none 没生效导致思考吃光预算，请查网关是否仍支持该参数。'
      );
      return comments.map(() => null);
    }

    return parseGrades(text, comments.length);
  } catch (err) {
    console.error('[comment-grading] LLM 调用失败:', (err as Error).message);
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
  // 真机验证 2026-07-19（decision 26d518fc）：Gemini 中文回复经常用全角句号"。"/顿号"、"
  // 而不是半角句号，只认半角会整批解析失败——13条真实留言里2/3视频批次全军覆没返回null。
  const lineRe = /^\s*(\d+)[.。、]\s*(高意向|精准|感兴趣|其他)/;
  let matched = 0;
  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;
    const idx = parseInt(m[1], 10) - 1;
    const grade = m[2];
    if (idx >= 0 && idx < count && (VALID_GRADES as readonly string[]).includes(grade)) {
      grades[idx] = grade;
      matched += 1;
    }
  }
  if (matched < count) {
    console.warn(
      `[comment-grading] 解析不完整：${count}条留言只解析出${matched}条档位，原始响应：`,
      text.slice(0, 500),
    );
  }
  return grades;
}
