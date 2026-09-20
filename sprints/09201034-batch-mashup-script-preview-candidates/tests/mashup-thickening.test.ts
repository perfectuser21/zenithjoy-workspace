// 批量混剪加厚 — 纯逻辑 TDD Red（无需 Postgres）
//
// 覆盖三个方向的核心新纯函数（RED：模块尚未实现，import 即失败）：
//   1. mashup-script-segment.ts —— 文案角色→ai_tags 映射（命中/兜底映射）+ 分段解析
//   2. mashup-thumbnail.ts       —— 候选缩略图拼贴 URL 确定性构造
//   3. render-concurrency.ts     —— 渲染并发闸（上限=1，第二个排队，释放后晋级）
//
// 禁 mock 边说明：这些是「被改的 DB 边」的上游纯函数，不触 DB，允许纯单测；
// DB 写路径 / 渲染状态机的真验在 mashup-thickening.integration.test.ts（真 PG）与
// contract-draft.md 的 ## E2E 验收（真 ffmpeg + 真 PG）里。

import { describe, it, expect } from 'vitest';

import {
  mapRoleToTags,
  parseScriptSegments,
} from '../../../apps/api/src/services/mashup-script-segment';
import { buildThumbnailCollageUrl } from '../../../apps/api/src/services/mashup-thumbnail';
import { RenderConcurrencyGate } from '../../../apps/api/src/services/render-concurrency';

// 现有 S1 标准四槽位 match_tags 的一个代表子集（真实枚举以 ai_tags 生产数据为准）
const AI_TAGS_ENUM = ['开场', '悬念', '特写', '产品特写', '细节', '主体', '行动号召', '下单', '结尾'];

describe('mashup-script-segment 角色→标签映射 [BEHAVIOR]', () => {
  it('命中角色 roleMatched 为 true', () => {
    const r = mapRoleToTags('开场', AI_TAGS_ENUM);
    expect(r.roleMatched).toBe(true);
    expect(Array.isArray(r.match_tags)).toBe(true);
    expect(r.match_tags.length).toBeGreaterThan(0);
  });

  it('未命中角色 兜底映射 roleMatched 为 false', () => {
    const r = mapRoleToTags('完全不存在的怪角色xyz', AI_TAGS_ENUM);
    expect(r.roleMatched).toBe(false);
    // 兜底映射：仍给出可用 match_tags，不返回空（否则该槽位永远匹配不到素材）
    expect(r.match_tags.length).toBeGreaterThan(0);
  });

  it('解析文案得到至少一段 每段建议素材数至少1', () => {
    const aiText = [
      '段1 角色：钩子 建议素材数：2',
      '段2 角色：产品 建议素材数：3',
      '段3 角色：行动号召 建议素材数：1',
    ].join('\n');
    const segs = parseScriptSegments(aiText);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    for (const s of segs) {
      expect(typeof s.key).toBe('string');
      expect(s.suggestedMaterialCount).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('mashup-thumbnail 缩略图拼贴 URL [BEHAVIOR]', () => {
  it('拼贴 URL 是确定性非空字符串', () => {
    const url1 = buildThumbnailCollageUrl('cand-1', ['m1', 'm2', 'm3']);
    const url2 = buildThumbnailCollageUrl('cand-1', ['m1', 'm2', 'm3']);
    expect(typeof url1).toBe('string');
    expect(url1.length).toBeGreaterThan(0);
    // 同输入 → 同 URL（确定性，便于缓存与去重）
    expect(url1).toBe(url2);
  });
});

describe('render-concurrency 渲染并发闸（上限=1）[BEHAVIOR]', () => {
  it('并发上限1 第二次进入排队 queuePosition 至少1', () => {
    const gate = new RenderConcurrencyGate({ max: 1 });
    const a = gate.acquire('job-a');
    const b = gate.acquire('job-b');
    expect(a.status).toBe('rendering');
    expect(a.queuePosition).toBe(0);
    expect(b.status).toBe('queued');
    expect(b.queuePosition).toBeGreaterThanOrEqual(1);
  });

  it('释放后队首晋级为 rendering', () => {
    const gate = new RenderConcurrencyGate({ max: 1 });
    gate.acquire('job-a');
    gate.acquire('job-b');
    const res = gate.release('job-a');
    // 队首 job-b 被晋级为正在渲染
    expect(res.promoted).toBe('job-b');
    const status = gate.statusOf('job-b');
    expect(status).toBe('rendering');
  });
});
