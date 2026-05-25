import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../llm/openrouter', () => ({
  callOpenRouter: vi.fn(),
}));

describe('gradeComment', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for empty text', async () => {
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('')).toBeNull();
  });

  it('returns null for single-char text', async () => {
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('好')).toBeNull();
  });

  it('returns 高意向 when LLM returns 高意向', async () => {
    const { callOpenRouter } = await import('../llm/openrouter');
    vi.mocked(callOpenRouter).mockResolvedValueOnce({ content: '高意向' } as never);
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('请问怎么联系你们？')).toBe('高意向');
  });

  it('returns 精准 when LLM returns 精准', async () => {
    const { callOpenRouter } = await import('../llm/openrouter');
    vi.mocked(callOpenRouter).mockResolvedValueOnce({ content: '精准' } as never);
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('我很想买这个产品')).toBe('精准');
  });

  it('returns 感兴趣 when LLM returns 感兴趣', async () => {
    const { callOpenRouter } = await import('../llm/openrouter');
    vi.mocked(callOpenRouter).mockResolvedValueOnce({ content: '感兴趣' } as never);
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('看起来不错哦')).toBe('感兴趣');
  });

  it('returns null when LLM returns 其他', async () => {
    const { callOpenRouter } = await import('../llm/openrouter');
    vi.mocked(callOpenRouter).mockResolvedValueOnce({ content: '其他' } as never);
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('今天天气真好')).toBeNull();
  });

  it('strips quotes from LLM response', async () => {
    const { callOpenRouter } = await import('../llm/openrouter');
    vi.mocked(callOpenRouter).mockResolvedValueOnce({ content: '"高意向"' } as never);
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('微信多少？')).toBe('高意向');
  });

  it('returns null when LLM throws', async () => {
    const { callOpenRouter } = await import('../llm/openrouter');
    vi.mocked(callOpenRouter).mockRejectedValueOnce(new Error('API timeout'));
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('测试评论内容')).toBeNull();
  });

  it('trims whitespace before checking length', async () => {
    const { gradeComment } = await import('./comment-grader');
    expect(await gradeComment('  ')).toBeNull();
  });
});
