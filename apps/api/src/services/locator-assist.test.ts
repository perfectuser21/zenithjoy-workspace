/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI on-call 横切件 · 刀2a：定位求助（树→候选 node）纯逻辑测试。
 *
 * 机型×安卓版本×抖音版本的 UI 漂移是 RPA 不稳定的主体（0822 主理人拍板的靶子）——
 * 代码枚举不完，AI 看一眼树就能裁决。本 service 把刀1 攒的病历（树快照）变成答案：
 * 失败步骤把树发上来问"应该点哪个"，answer 过验证闸（刀2b 安卓侧）后继续跑。
 *
 * 铁律（全部来自已踩实的教训）：
 *  - fail-open：求助通道自身故障绝不阻塞 RPA 主流程（返回 unavailable，走原失败路径）
 *  - 截断守卫：finish_reason==='length' 的输出是残缺的，绝不当答案（PR#1684 教训）
 *  - 关思考：deepseek 用 reasoning_effort:'none'（thinking 吃光输出预算的根因修法）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('axios', () => ({
  default: { post: vi.fn(), isAxiosError: (e: any) => !!e?.isAxiosError },
}));

import pool from '../db/connection';
import axios from 'axios';
import {
  buildLocatorPrompt,
  parseLineAnswer,
  selectorFromTreeLine,
  requestLocatorAssist,
  buildExtractPrompt,
  parseExtractAnswer,
  type LocatorAssistRequest,
} from './locator-assist';

const TREE = [
  'd0 android.widget.FrameLayout id=- text="-" desc="-" bounds=[0,0][1080,2388]',
  'd1 android.widget.EditText id=com.ss.android.ugc.aweme:id/et_search_kw text="-" desc="搜索输入框" bounds=[100,80][900,160]',
  'd1 android.widget.Button id=com.ss.android.ugc.aweme:id/search_btn text="搜索" desc="-" click bounds=[900,80][1060,160]',
].join('\n');

function baseReq(over: Partial<LocatorAssistRequest> = {}): LocatorAssistRequest {
  return {
    tenantId: 't1',
    step: 'dm_search_input',
    targetDesc: '搜索输入框',
    uiTree: TREE,
    deviceModel: 'HONOR ANY-AN00',
    osVersion: 'Android 12 (API 31)',
    douyinVersion: '28.5.0',
    appVersion: '2.1.36',
    errorCode: 'NO_SEARCH_INPUT',
    ...over,
  };
}

describe('buildLocatorPrompt', () => {
  it('prompt 必须带目标描述、步骤上下文与整棵树（行号可引用）', () => {
    const p = buildLocatorPrompt(baseReq());
    expect(p).toContain('搜索输入框');
    expect(p).toContain('dm_search_input');
    expect(p).toContain('et_search_kw');
    expect(p, 'prompt 必须要求模型只回行号 JSON').toMatch(/"line"/);
  });
});

describe('parseLineAnswer', () => {
  it('合法 JSON 行号解析成功', () => {
    expect(parseLineAnswer('{"line": 1}', 3)).toBe(1);
  });
  it('答案裹在废话里也能抠出 JSON', () => {
    expect(parseLineAnswer('好的，答案是：{"line": 2}，理由略', 3)).toBe(2);
  });
  it('行号越界返回 null——绝不拿越界行当答案', () => {
    expect(parseLineAnswer('{"line": 99}', 3)).toBeNull();
    expect(parseLineAnswer('{"line": -1}', 3)).toBeNull();
  });
  it('非 JSON 胡言乱语返回 null', () => {
    expect(parseLineAnswer('我不知道', 3)).toBeNull();
  });
});

describe('selectorFromTreeLine', () => {
  it('从树行提取 view_id/text/desc/bounds 组装候选', () => {
    const s = selectorFromTreeLine(TREE, 1)!;
    expect(s.view_id).toBe('com.ss.android.ugc.aweme:id/et_search_kw');
    expect(s.content_desc).toBe('搜索输入框');
    expect(s.bounds).toBe('[100,80][900,160]');
    expect(s.line).toBe(1);
  });
  it('id 与 text 为占位符 - 时置 null', () => {
    const s = selectorFromTreeLine(TREE, 0)!;
    expect(s.view_id).toBeNull();
    expect(s.text).toBeNull();
  });
});

describe('requestLocatorAssist（后端调度 + fail-open + 截断守卫）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOAPIS_API_KEY = 'test-key';
    (pool.query as any).mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('缓存命中直接返回，不调模型', async () => {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/SELECT/i.test(sql) && /rpa_locator_assist/i.test(sql)) {
        return {
          rows: [{ answer_line: 1, answer_selector: { view_id: 'cached-id', line: 1 } }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const r = await requestLocatorAssist(baseReq());
    expect(r.status).toBe('ok');
    expect(r.cacheHit).toBe(true);
    expect(r.candidates![0].view_id).toBe('cached-id');
    expect((axios.post as any).mock.calls.length, '缓存命中绝不该烧模型钱').toBe(0);
  });

  it('缓存 miss 走 tree-llm 后端，deepseek 必须关思考且带截断守卫参数', async () => {
    (axios.post as any).mockResolvedValue({
      data: { choices: [{ message: { content: '{"line": 2}' }, finish_reason: 'stop' }] },
    });
    const r = await requestLocatorAssist(baseReq());
    expect(r.status).toBe('ok');
    expect(r.candidates![0].view_id).toBe('com.ss.android.ugc.aweme:id/search_btn');
    const body = (axios.post as any).mock.calls[0][1];
    expect(body.reasoning_effort, 'deepseek 必须 reasoning_effort=none（PR#1684 教训）').toBe('none');
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('finish_reason=length 的残缺输出绝不当答案——fail-open 返回 unavailable', async () => {
    (axios.post as any).mockResolvedValue({
      data: { choices: [{ message: { content: '{"li' }, finish_reason: 'length' }] },
    });
    const r = await requestLocatorAssist(baseReq());
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('truncated_output');
  });

  it('模型超时 fail-open，不抛异常', async () => {
    (axios.post as any).mockRejectedValue(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' }));
    const r = await requestLocatorAssist(baseReq());
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('llm_timeout');
  });

  it('vision 后端未配置时显式降级（插座已定义未通电）', async () => {
    delete process.env.UITARS_BASE_URL;
    const r = await requestLocatorAssist(baseReq({ backend: 'vision' }));
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('vision_not_configured');
    expect((axios.post as any).mock.calls.length).toBe(0);
  });

  it('出诊返回 assistId（INSERT RETURNING id）——安卓端回执 verified 靠它', async () => {
    (pool.query as any).mockImplementation(async (sql: string) => {
      if (/INSERT INTO zenithjoy\.rpa_locator_assist/i.test(sql)) {
        return { rows: [{ id: 'aid-returning-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    (axios.post as any).mockResolvedValue({
      data: { choices: [{ message: { content: '{"line": 1}' }, finish_reason: 'stop' }] },
    });
    const r = await requestLocatorAssist(baseReq());
    expect(r.status).toBe('ok');
    expect(r.assistId).toBe('aid-returning-1');
  });

  it('无论成败都落出诊病历（INSERT rpa_locator_assist）', async () => {
    (axios.post as any).mockResolvedValue({
      data: { choices: [{ message: { content: '{"line": 1}' }, finish_reason: 'stop' }] },
    });
    await requestLocatorAssist(baseReq());
    const calls = (pool.query as any).mock.calls as Array<[string, unknown[]?]>;
    const ins = calls.find(([sql]) => /INSERT INTO zenithjoy\.rpa_locator_assist/i.test(sql));
    expect(ins, '出诊必须留病历——这是刀3周报固化的原材料').toBeTruthy();
    const [, params] = ins!;
    expect(params).toEqual(expect.arrayContaining(['dm_search_input', 'HONOR ANY-AN00', '28.5.0']));
  });
});

// ── 铺满刀A：extract 模式（树→AI 抽取文本，如抖音号）──────────────────────
describe('requestLocatorAssist mode=extract（读取类保底）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOAPIS_API_KEY = 'test-key';
    (pool.query as any).mockResolvedValue({ rows: [{ id: 'aid-x' }], rowCount: 1 });
  });

  it('extract prompt 要求抽取目标值而非行号', () => {
    const p = buildExtractPrompt({ ...baseReq(), targetDesc: '这个人的抖音号' });
    expect(p).toContain('抖音号');
    expect(p, 'extract 应要 extracted 字段').toMatch(/extracted/i);
  });

  it('extract 解析 AI 返回的文本值', () => {
    expect(parseExtractAnswer('{"extracted":"zhang_san_88"}')).toBe('zhang_san_88');
    expect(parseExtractAnswer('答案：{"extracted": "abc.123"}啰嗦')).toBe('abc.123');
    expect(parseExtractAnswer('{"extracted":null}')).toBeNull();
    expect(parseExtractAnswer('胡说')).toBeNull();
  });

  it('extract 模式返回 extractedValue 且不查缓存（读取值每条不同）', async () => {
    (axios.post as any).mockResolvedValue({
      data: { choices: [{ message: { content: '{"extracted":"dy_88"}' }, finish_reason: 'stop' }] },
    });
    const r = await requestLocatorAssist({ ...baseReq(), mode: 'extract', targetDesc: '抖音号' });
    expect(r.status).toBe('ok');
    expect(r.extractedValue).toBe('dy_88');
    // 不应有 SELECT 缓存查询
    const calls = (pool.query as any).mock.calls as Array<[string]>;
    const cacheSelect = calls.find(([sql]) => /^\s*SELECT/i.test(sql) && /answer_selector/i.test(sql));
    expect(cacheSelect, 'extract 模式不该查缓存').toBeUndefined();
  });

  it('extract 截断守卫同样生效', async () => {
    (axios.post as any).mockResolvedValue({
      data: { choices: [{ message: { content: '{"extr' }, finish_reason: 'length' }] },
    });
    const r = await requestLocatorAssist({ ...baseReq(), mode: 'extract' });
    expect(r.status).toBe('unavailable');
    expect(r.reason).toBe('truncated_output');
  });
});
