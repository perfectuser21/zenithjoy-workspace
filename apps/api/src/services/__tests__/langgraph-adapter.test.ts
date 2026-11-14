import { describe, it, expect } from 'vitest';
import {
  buildStagesFromEvents,
  extractArticlePath,
  extractCopyPath,
  extractImageFiles,
  type PipelineEvent,
} from '../langgraph-adapter';

function mkEvent(id: number, node: string, extra: Record<string, unknown> = {}): PipelineEvent {
  return {
    id,
    created_at: new Date(2026, 3, 19, 11, id).toISOString(),
    payload: { node, step_index: id, ...extra } as PipelineEvent['payload'],
  };
}

describe('buildStagesFromEvents — rule_details 映射到 StageInfo.rule_scores', () => {
  it('copy_review 带 rule_details 时生成 rule_scores（id/label/score/pass/comment）', () => {
    const events: PipelineEvent[] = [
      mkEvent(1, 'research', { findings_path: '/x/findings.json' }),
      mkEvent(2, 'copywrite', { copy_path: '/x/cards/copy.md' }),
      mkEvent(3, 'copy_review', {
        copy_review_verdict: 'REVISION',
        copy_review_round: 1,
        copy_review_rule_details: [
          { id: 'R1', label: '无禁用词', pass: false, reason: '命中: coding' },
          { id: 'R2', label: '品牌词命中≥1', pass: true, value: 3 },
          { id: 'R3', label: 'copy ≥200 字', pass: true, value: 997 },
          { id: 'R4', label: 'article ≥500 字', pass: true, value: 3113 },
          { id: 'R5', label: 'article 有 md 标题', pass: true },
        ],
      }),
    ];

    const stages = buildStagesFromEvents(events);
    const cr = stages['content-copy-review'];
    expect(cr.review_passed).toBe(false);
    expect(cr.rule_scores).toHaveLength(5);
    expect(cr.rule_scores![0]).toMatchObject({
      id: 'R1',
      label: '无禁用词',
      score: 0,
      pass: false,
      comment: '命中: coding',
    });
    expect(cr.rule_scores![1]).toMatchObject({
      id: 'R2',
      score: 1,
      pass: true,
      comment: '3',
    });
    // 第 5 条无 value 无 reason → comment undefined
    expect(cr.rule_scores![4].comment).toBeUndefined();
  });

  it('image_review 带 rule_details 时生成 rule_scores（per-image + RCOUNT）', () => {
    const events: PipelineEvent[] = [
      mkEvent(1, 'research'),
      mkEvent(2, 'copywrite'),
      mkEvent(3, 'copy_review', { copy_review_verdict: 'APPROVED' }),
      mkEvent(4, 'generate', { cards_dir: '/x/cards' }),
      mkEvent(5, 'image_review', {
        image_review_verdict: 'FAIL',
        image_review_round: 1,
        image_review_rule_details: [
          { id: 'RCOUNT', label: 'PNG ≥ 8 张', pass: false, value: 6, reason: '只有 6 张' },
          { id: 'cover.png', label: 'cover.png', pass: true, value: 657348 },
          { id: 'small.png', label: 'small.png', pass: false, value: 5000, reason: 'size 5000B < 10KB' },
        ],
      }),
    ];

    const stages = buildStagesFromEvents(events);
    const ir = stages['content-image-review'];
    expect(ir.review_passed).toBe(false);
    expect(ir.rule_scores).toHaveLength(3);
    expect(ir.rule_scores![0]).toMatchObject({ id: 'RCOUNT', score: 0 });
    expect(ir.rule_scores![1]).toMatchObject({ id: 'cover.png', score: 1 });
    expect(ir.rule_scores![2].comment).toContain('5000B < 10KB');
  });

  it('没有 rule_details 时 rule_scores 为 undefined（兼容旧数据）', () => {
    const events: PipelineEvent[] = [
      mkEvent(1, 'research'),
      mkEvent(2, 'copywrite'),
      mkEvent(3, 'copy_review', { copy_review_verdict: 'APPROVED' }),
    ];
    const stages = buildStagesFromEvents(events);
    expect(stages['content-copy-review'].rule_scores).toBeUndefined();
  });
});

describe('WF-3 观察性字段透传（API 不加工，直接给前端）', () => {
  it('PipelineEvent.payload 原样带 prompt_sent / raw_stdout / raw_stderr / exit_code / duration_ms / container_id', () => {
    const event: PipelineEvent = {
      id: 42,
      created_at: new Date().toISOString(),
      payload: {
        node: 'research',
        step_index: 1,
        findings_path: '/f.json',
        prompt_sent: 'Hello Claude, please do research',
        raw_stdout: 'findings_path: /f.json\n{"ok":true}',
        raw_stderr: 'some warning',
        exit_code: 0,
        duration_ms: 12345,
        container_id: 'abc123def456',
      } as PipelineEvent['payload'],
    };
    // 类型扩展正确 + 字段原值保留
    expect(event.payload.prompt_sent).toBe('Hello Claude, please do research');
    expect(event.payload.raw_stdout).toContain('findings_path');
    expect(event.payload.raw_stderr).toBe('some warning');
    expect(event.payload.exit_code).toBe(0);
    expect(event.payload.duration_ms).toBe(12345);
    expect(event.payload.container_id).toBe('abc123def456');
  });

  it('buildStagesFromEvents 不会吞掉或篡改 WF-3 元数据字段（只读取 rule_details）', () => {
    const events: PipelineEvent[] = [
      mkEvent(1, 'research', {
        findings_path: '/f.json',
        prompt_sent: 'p1',
        raw_stdout: 'o1',
        exit_code: 0,
        duration_ms: 111,
        container_id: 'c1',
      }),
      mkEvent(2, 'copywrite', {
        copy_path: '/c.md',
        prompt_sent: 'p2',
        raw_stdout: 'o2',
        exit_code: 0,
        duration_ms: 222,
        container_id: 'c2',
      }),
    ];
    const stages = buildStagesFromEvents(events);
    // 现有 stage 构造逻辑不消费 meta 字段（meta 由前端直接从 events 读）
    expect(stages['content-research'].status).toBe('completed');
    expect(stages['content-copywriting'].status).toBe('in_progress');
    // events 依然保留 meta（引用一致，未被 adapter 修改）
    expect(events[0].payload.prompt_sent).toBe('p1');
    expect(events[0].payload.container_id).toBe('c1');
    expect(events[1].payload.exit_code).toBe(0);
    expect(events[1].payload.duration_ms).toBe(222);
  });

  it('exit_code = null（容器没跑起来）应保留 null 传给前端', () => {
    const events: PipelineEvent[] = [
      mkEvent(1, 'research', {
        error: 'spawn error',
        prompt_sent: 'x',
        raw_stderr: 'docker: ENOENT',
        exit_code: null,
        duration_ms: 100,
        container_id: null,
      }),
    ];
    expect(events[0].payload.exit_code).toBeNull();
    expect(events[0].payload.container_id).toBeNull();
    expect(events[0].payload.raw_stderr).toBe('docker: ENOENT');
    // adapter 的 stage 构造仍能识别失败
    const stages = buildStagesFromEvents(events);
    expect(stages['content-research'].status).toBe('failed');
  });
});

describe('manifest schema 三版兼容（extractArticlePath/extractCopyPath/extractImageFiles）', () => {
  it('V1 image_set.files → extractImageFiles 原样返回', () => {
    const m = { image_set: { files: ['龙虾-cover.png', '龙虾-01.png'] } };
    expect(extractImageFiles(m)).toEqual(['龙虾-cover.png', '龙虾-01.png']);
  });

  it('V2 files[{path}] → 剥 cards/ 前缀', () => {
    const m = {
      files: [
        { path: 'cards/prompt-anan-cover.png', size: 500 },
        { path: 'article/article.md', size: 100 },
        { path: 'cards/prompt-anan-01.png', size: 300 },
      ],
    };
    expect(extractImageFiles(m)).toEqual(['prompt-anan-cover.png', 'prompt-anan-01.png']);
  });

  it('V3 cards[] 字符串数组 → 剥子目录前缀', () => {
    const m = {
      cards: [
        'Notion-01-profile.png',
        'Notion-cover.png',
        'cards/Notion-lf-01.png',
      ],
    };
    expect(extractImageFiles(m)).toEqual([
      'Notion-01-profile.png',
      'Notion-cover.png',
      'Notion-lf-01.png',
    ]);
  });

  it('V3 article/copy 为字符串路径', () => {
    const m = {
      article: 'article/article.md',
      copy: 'cards/copy.md',
    };
    expect(extractArticlePath(m)).toBe('article/article.md');
    expect(extractCopyPath(m)).toBe('cards/copy.md');
  });

  it('V1 article/copy 为对象', () => {
    const m = {
      article: { path: 'article/article.md', status: 'ok' },
      copy: { path: 'cards/copy.md' },
    };
    expect(extractArticlePath(m)).toBe('article/article.md');
    expect(extractCopyPath(m)).toBe('cards/copy.md');
  });

  it('V2 files[] 里找 article/copy', () => {
    const m = {
      files: [
        { path: 'article/article.md' },
        { path: 'cards/copy.md' },
      ],
    };
    expect(extractArticlePath(m)).toBe('article/article.md');
    expect(extractCopyPath(m)).toBe('cards/copy.md');
  });

  it('空/null manifest → 返回空/undefined', () => {
    expect(extractImageFiles(null)).toEqual([]);
    expect(extractArticlePath(null)).toBeUndefined();
    expect(extractCopyPath(null)).toBeUndefined();
    expect(extractImageFiles({})).toEqual([]);
  });

  it('同时有 V1 image_set 和 V3 cards 时 V1 优先（老 pipeline 兼容）', () => {
    const m = {
      image_set: { files: ['v1-a.png'] },
      cards: ['v3-a.png'],
    };
    expect(extractImageFiles(m)).toEqual(['v1-a.png']);
  });
});
