/**
 * comment-grading.test.ts — commit-1 Red
 *
 * 评论区留言AI意向分档判定（decision 4e421ae8）：补齐Path2 Seg3→Seg4之间缺失的判定环节。
 * acquisition_lead_comments.grade / acquisition_leads.outreach_eligible 的打分公式
 * （computeRelevanceScore/rescoreLead）早已写好，但没有任何地方真正产生grade值——本文件
 * 测的就是"产生grade值"这一步。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gradeComments, thinkingOffParam } from './comment-grading';
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

  it('判定链默认走 OpenRouter + openai/gpt-4o-mini（0922 ToAPIs 侧无一模型能同时过「不被内容过滤/批量不超时/全出档」三关;OpenRouter 两种 prompt 各 5 轮 10/10 全过;env 可覆盖）', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向' } }] },
    } as never);

    await gradeComments('家装目标客户', '标题', null, [{ commentText: '预算10万求推荐' }]);

    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.model).toBe('openai/gpt-4o-mini');
    // 网关也一起迁了——只改模型名不改 base 会打到 ToAPIs 上去，那边没有这个模型
    const [url] = mockedPost.mock.calls[0] as [string, unknown];
    expect(url).toContain('openrouter.ai');
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
   * 0820 用 reasoning_effort='none'；0915 TOAPIS 上游变更把 none 从合法值里移除
   *（400 invalid_parameter_error，合法值只剩 low..max，而 low 实测照样吃光预算），
   * 关思考的开关换成 enable_thinking:false（0915 真调实测 gpt-5.6-terra 与
   * deepseek-v4-flash 都零思考出正文）。
   *
   * 这条断言就是守卫本体——把 enable_thinking 去掉，本测试必须报红。
   */
  it('必须关闭思考链（开关随模型走）——否则 reasoning 吃光预算整批返 null', async () => {
    const mockedPost = vi.mocked(axios.post);
    mockedPost.mockResolvedValue({
      data: { choices: [{ finish_reason: 'stop', message: { content: '1. 高意向' } }] },
    } as never);

    await gradeComments('健身减脂目标客户', '标题', null, [{ commentText: '多少钱一份' }]);

    const [, body] = mockedPost.mock.calls[0] as [string, Record<string, unknown>];
    // 开关名随模型而不同，不能写死任何一个（0922：gpt-5.4-mini 收到 enable_thinking
    // 直接 400 Unknown parameter；deepseek/terra 反过来不认 reasoning_effort）。
    // 这里只认一件事：请求体里必须带上**当前模型对应的那个**关思考开关。
    expect(body).toMatchObject(thinkingOffParam(body.model as string));
    // 而且只带一个——两个都塞会在不认的那一侧 400
    const switches = ['enable_thinking', 'reasoning_effort'].filter((k) => k in body);
    // OpenRouter 侧一个都不带；ToAPIs 侧必须恰好带一个（两个都塞会在不认的那侧 400）
    expect(switches).toHaveLength((body.model as string).includes('/') ? 0 : 1);
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

/**
 * 关思考的开关名随模型而不同 —— 0922 生产故障的第二层。
 *
 * 当天 deepseek-v4-flash 渠道欠费（403 SUBSCRIPTION_INACTIVE，无备用渠道），整条判定链死透。
 * 切 gpt-5.4-mini 时才发现：它收到 enable_thinking 直接 400 "Unknown parameter"——
 * 也就是说，光换模型名会把"渠道欠费"换成"参数不认"，一样全 null，还更难看出原因。
 *
 * 这条链已经换了五次模型（0823/0904/0909/0915/0922），每次都在这个开关上绊一跤。
 * 锁住它：开关必须跟着模型走。
 */
describe('thinkingOffParam — 关思考开关按模型分派', () => {
  it('OpenRouter 风格模型名（vendor/model）不带任何关思考开关', async () => {
    const { thinkingOffParam } = await import('./comment-grading');
    expect(thinkingOffParam('openai/gpt-4o-mini')).toEqual({});
    expect(thinkingOffParam('deepseek/deepseek-chat-v3.1')).toEqual({});
  });

  it('ToAPIs 侧 gpt 系列用 reasoning_effort，绝不能发 enable_thinking（会 400）', async () => {
    const { thinkingOffParam } = await import('./comment-grading');
    expect(thinkingOffParam('gpt-5.4-mini')).toEqual({ reasoning_effort: 'none' });
    expect(thinkingOffParam('gpt-5.4-mini')).not.toHaveProperty('enable_thinking');
    expect(thinkingOffParam('gpt-5.6-terra')).not.toHaveProperty('enable_thinking');
  });

  it('非 gpt 系列（deepseek 等）用 enable_thinking', async () => {
    const { thinkingOffParam } = await import('./comment-grading');
    expect(thinkingOffParam('deepseek-v4-flash')).toEqual({ enable_thinking: false });
  });

  it('实际请求体里带的开关必须与当前模型匹配', async () => {
    // 真正要防的不是函数本身，而是"请求体里写死一个开关"——那才是 0922 踩的形状。
    const { thinkingOffParam } = await import('./comment-grading');
    const mockedAxios = vi.mocked(axios);
    vi.mocked(axios.post).mockResolvedValue({
      data: { choices: [{ message: { content: '1. 高意向' }, finish_reason: 'stop' }] },
    } as never);
    await gradeComments('想考证的在职人员', 't', null, [{ commentText: '怎么报名' }]);
    const [, body] = vi.mocked(axios.post).mock.calls[0] as [string, Record<string, unknown>];
    const model = body.model as string;
    expect(body).toMatchObject(thinkingOffParam(model));
    if (model.startsWith('gpt-')) expect(body).not.toHaveProperty('enable_thinking');
  });

  it('env 把模型换成非 gpt 时，请求体的开关必须跟着换（否则那一侧 400 整批 null）', async () => {
    // 本文件头部写着"模型名走 env 可覆盖，不必再改代码"——那这条路径就必须有人守。
    // 只测默认模型的话，请求体里写死 reasoning_effort 也能全绿（默认恰好是 gpt），
    // 等哪天 env 切回 deepseek 才在生产上炸。
    vi.resetModules();
    const prev = process.env.GRADING_MODEL;
    process.env.GRADING_MODEL = 'deepseek-v4-flash';
    try {
      const axiosMod = (await import('axios')).default;
      vi.mocked(axiosMod.post).mockResolvedValue({
        data: { choices: [{ message: { content: '1. 高意向' }, finish_reason: 'stop' }] },
      } as never);
      const mod = await import('./comment-grading');
      await mod.gradeComments('想考证的在职人员', 't', null, [{ commentText: '怎么报名' }]);
      const [, body] = vi.mocked(axiosMod.post).mock.calls.at(-1) as [string, Record<string, unknown>];
      expect(body.model).toBe('deepseek-v4-flash');
      expect(body.enable_thinking).toBe(false);
      expect(body).not.toHaveProperty('reasoning_effort');
    } finally {
      if (prev === undefined) delete process.env.GRADING_MODEL;
      else process.env.GRADING_MODEL = prev;
      vi.resetModules();
    }
  });

  it('只配 OPENROUTER_API_KEY（没有 TOAPIS_API_KEY）也必须能调——迁网关就得连凭据一起迁', async () => {
    // 迁到 OpenRouter 之后，新环境不会再配 TOAPIS_API_KEY。凭据读取要是还只认旧变量，
    // 就会走到"未配置 → 跳过判定 → 整批 null"那条静默分支上，症状跟渠道欠费一模一样。
    vi.resetModules();
    const prevT = process.env.TOAPIS_API_KEY;
    const prevO = process.env.OPENROUTER_API_KEY;
    delete process.env.TOAPIS_API_KEY;
    process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
    try {
      const axiosMod = (await import('axios')).default;
      vi.mocked(axiosMod.post).mockResolvedValue({
        data: { choices: [{ message: { content: '1. 高意向' }, finish_reason: 'stop' }] },
      } as never);
      const mod = await import('./comment-grading');
      const out = await mod.gradeComments('想考证的在职人员', 't', null, [{ commentText: '怎么报名' }]);
      expect(out).toEqual(['高意向']);
      const call = vi.mocked(axiosMod.post).mock.calls.at(-1) as [string, unknown, { headers: Record<string, string> }];
      expect(call[2].headers.Authorization).toBe('Bearer test-openrouter-key');
    } finally {
      if (prevT === undefined) delete process.env.TOAPIS_API_KEY; else process.env.TOAPIS_API_KEY = prevT;
      if (prevO === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevO;
      vi.resetModules();
    }
  });
});
