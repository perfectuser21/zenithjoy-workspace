import { callOpenRouter } from '../llm/openrouter';

export type CommentGrade = '感兴趣' | '精准' | '高意向';

const GRADE_PROMPT = (text: string) => `你是一个抖音评论筛选助手。判断以下抖音评论是否为潜在客户，按如下规则输出唯一标签：

高意向：评论者主动询问联系方式、价格、合作方式，或主动留下微信/手机号
精准：评论者表达明确需求或强烈兴趣，但未主动要求联系
感兴趣：评论者表达普通兴趣、赞美或转发意向
其他：与产品/服务无关的评论（广告、闲聊、骂人等）

只输出以下四个标签之一，不要加任何解释：高意向、精准、感兴趣、其他

评论内容：${text}`;

export async function gradeComment(text: string): Promise<CommentGrade | null> {
  if (!text || text.trim().length < 2) return null;

  try {
    const result = await callOpenRouter({
      prompt: GRADE_PROMPT(text.trim()),
      purpose: 'comment-grade',
      maxTokens: 10,
      model: 'deepseek/deepseek-chat',
    });
    const label = result.content.trim().replace(/["""''']/g, '');
    if (label === '高意向') return '高意向';
    if (label === '精准') return '精准';
    if (label === '感兴趣') return '感兴趣';
    return null;
  } catch (err) {
    console.warn('[comment-grader] DeepSeek call failed, skipping grade:', (err as Error).message);
    return null;
  }
}
