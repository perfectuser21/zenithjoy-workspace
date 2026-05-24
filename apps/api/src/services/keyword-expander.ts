import { callOpenRouter } from '../llm/openrouter';

function makeFallback(keyword: string): string[] {
  return [keyword, `${keyword}设计`, `${keyword}攻略`, `${keyword}价格`, `${keyword}推荐`];
}

export async function expandKeywords(keyword: string): Promise<string[]> {
  if (process.env.VITEST || !process.env.OPENROUTER_API_KEY) {
    return makeFallback(keyword);
  }

  try {
    const result = await callOpenRouter({
      prompt: `给"${keyword}"生成4个相关搜索关键词变体，不重复，每行一个，只输出关键词，不加序号或标点。`,
      purpose: 'keyword-expand',
      maxTokens: 100,
      model: 'deepseek/deepseek-chat',
    });

    const variants = result.content
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== keyword)
      .slice(0, 4);

    const keywords = [keyword, ...variants];
    if (keywords.length === 5) return keywords;
    return makeFallback(keyword);
  } catch {
    return makeFallback(keyword);
  }
}
