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

  /**
   * 回归（2026-07-19，decision 26d518fc）：真机验证 PR#1412 时发现，Gemini 用全角标点
   * （。/、）回复时，parseGrades 的正则只认半角句号，整批解析全部失败——13条真实留言里
   * 2/3视频批次的Gemini响应全军覆没返回null，含明显高意向留言"预算20w内能不能包入住？
   * 能不能给我做一下预算？"也被漏判。真机复现证实这是高频问题，不是理论边界情况。
   */
  it('回归: Gemini响应整体使用全角句号，仍须正确解析（真机实测复现格式）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1。高意向\n2。精准' } }] },
    } as never);

    const result = await gradeComments('家装目标客户', '标题', null, [
      { commentText: '预算20w内能不能包入住？能不能给我做一下预算？' },
      { commentText: '这个多少钱' },
    ]);
    expect(result).toEqual(['高意向', '精准']);
  });

  it('回归: Gemini响应混用全角句号/顿号/半角句号，全部须正确解析', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向\n2、精准\n3。感兴趣' } }] },
    } as never);

    const result = await gradeComments('家装目标客户', '标题', null, [
      { commentText: 'a' },
      { commentText: 'b' },
      { commentText: 'c' },
    ]);
    expect(result).toEqual(['高意向', '精准', '感兴趣']);
  });

  it('回归: 部分解析失败时须打印诊断日志带上原始响应文本', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向\n乱七八糟' } }] },
    } as never);

    await gradeComments('家装目标客户', '标题', null, [
      { commentText: 'a' },
      { commentText: 'b' },
    ]);

    expect(warnSpy).toHaveBeenCalled();
    const loggedText = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(loggedText).toContain('乱七八糟');
    warnSpy.mockRestore();
  });
});
