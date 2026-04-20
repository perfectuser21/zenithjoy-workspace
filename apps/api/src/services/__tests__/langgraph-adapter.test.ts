import { describe, it, expect } from 'vitest';
import { buildStagesFromEvents, type PipelineEvent } from '../langgraph-adapter';

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
