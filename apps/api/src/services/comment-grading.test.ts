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

  it('空画像 → 不调用Gemini，全部返回null，且打印 warn 日志说明跳过原因', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mockedPost = vi.mocked(axios.post);
    const result = await gradeComments('', '标题', null, [{ commentText: '预算10万求推荐' }]);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(result).toEqual([null]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('target_profile_desc 为空'));
    warnSpy.mockRestore();
  });

  it('判定模型默认 gpt-5.6-terra（0823 deepseek-v4-flash 渠道#58欠费临时切走，env GRADING_MODEL 可覆盖）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向' } }] },
    } as never);

    await gradeComments('家装目标客户', '标题', null, [{ commentText: '预算10万求推荐' }]);

    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.model).toBe('gpt-5.6-terra');
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

  /**
   * 回归：deepseek-v4-flash 的思考链把 max_tokens 预算吃光，评论分档整批全丢
   *
   * 真机 0820（decision fa247355）：v4-flash 是 thinking 模型，reasoning_tokens 算在
   * max_tokens 里。线上 max_tokens=500，实测 25 条评论时 reasoning 直接顶到 500 封顶、
   * content 是**空字符串**、finish_reason=length —— 整批 0/25 全变 null。
   * 更毒的是消耗是随机的：同样 8 条评论两次跑分别烧 863 / 213 tokens，
   * 所以任何固定预算都可能被坏运气击穿（实测 12 条 @2000 连续两次全丢）。
   *
   * 真正的解法不是加预算而是**关掉思考**：这个任务是 4 选 1 的短文本分类，不需要思考链。
   * 实测 reasoning_effort='none' 后，42 条评论用现有的 max_tokens=500 就是 42/42，
   * 耗时 5.9s → 2.3s。（注：该参数只对 deepseek 生效，gemini-2.5 不认，见 content-judgment.ts）
   *
   * 这条断言就是守卫本体——把 reasoning_effort 去掉，本测试必须报红。
   */
  it('必须关闭思考链（reasoning_effort=none）——否则 reasoning 吃光预算整批返 null', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ finish_reason: 'stop', message: { content: '1. 高意向' } }] },
    } as never);

    await gradeComments('健身减脂目标客户', '标题', null, [{ commentText: '多少钱一份' }]);

    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.reasoning_effort).toBe('none');
  });

  /**
   * 守卫：万一网关哪天不认 reasoning_effort（参数被忽略 → 思考回来 → 预算被吃光），
   * 表现就是 finish_reason=length + content 空。这种情况必须留下**可检索的 error 日志**，
   * 不能只是静默返回一批 null 让人以为"这些评论就是没意向"。
   */
  it('截断守卫：finish_reason=length 时打 error 日志点名截断，而非静默全 null', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ finish_reason: 'length', message: { content: '' } }] },
    } as never);

    const result = await gradeComments('健身减脂目标客户', '标题', null, [
      { commentText: '多少钱一份' },
      { commentText: '求链接' },
    ]);

    expect(result).toEqual([null, null]);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('截断'));
    errSpy.mockRestore();
  });

});
