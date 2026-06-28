import { describe, it, expect } from 'vitest';
import {
  dedupCommenters,
  profileUrlForSecUid,
  resolveTerminalStatus,
  shouldSweepToTerminal,
  seedKeywordsFromDoc,
  EMPTY_DOC_MIN_CHARS,
  SWEEP_TIMEOUT_MS,
} from './acquisition-collect';

// 配套 unit（lint-test-pairing）— 与 sprints/06181904-.../tests/acquisition-collect.test.ts 同源契约。
// 端到端行为由 contract-dod.md [BEHAVIOR] manual:bash 为 evaluator oracle。
describe('acquisition-collect 去重落库', () => {
  it('同 sec_uid 跨视频去重：仅累加 source_video_ids', () => {
    const existing = [
      { sec_uid: 'MS4wA', nickname: '甲', profile_url: profileUrlForSecUid('MS4wA'), partial: false, source_video_ids: ['vA'] },
    ];
    const r = dedupCommenters(existing, [{ sec_uid: 'MS4wA', nickname: '甲' }], 'vB');
    expect(r.inserted).toBe(0);
    expect(r.deduped).toBe(1);
    expect(r.rows.find((x) => x.sec_uid === 'MS4wA')!.source_video_ids).toEqual(['vA', 'vB']);
  });

  it('sec_uid 缺失：昵称兜底入库 partial=true profile_url=null + 同昵称弱去重', () => {
    const r1 = dedupCommenters([], [{ nickname: '匿名' }], 'vC');
    expect(r1.inserted).toBe(1);
    expect(r1.rows[0].sec_uid).toBeNull();
    expect(r1.rows[0].partial).toBe(true);
    expect(r1.rows[0].profile_url).toBeNull();
    const r2 = dedupCommenters(r1.rows, [{ nickname: '匿名' }], 'vD');
    expect(r2.inserted).toBe(0);
    expect(r2.deduped).toBe(1);
  });

  it('profile_url：sec_uid→主页链接，残缺号→null', () => {
    expect(profileUrlForSecUid('MS4wX')).toBe('https://www.douyin.com/user/MS4wX');
    expect(profileUrlForSecUid(null)).toBeNull();
  });
});

describe('acquisition-collect 失败兜底状态机', () => {
  it('terminal=failed 携 error_code 区分原因', () => {
    expect(resolveTerminalStatus({ terminal: 'failed', error_code: 'DOUYIN_RISK' })).toEqual({ status: 'failed', error_code: 'DOUYIN_RISK' });
    expect(resolveTerminalStatus({ terminal: 'failed', error_code: 'DOUYIN_CAPTCHA' }).error_code).toBe('DOUYIN_CAPTCHA');
  });

  it('terminal=partial→status=partial error_code=partial_reason；done→null', () => {
    expect(resolveTerminalStatus({ terminal: 'partial', partial_reason: 'video_insufficient' })).toEqual({ status: 'partial', error_code: 'video_insufficient' });
    expect(resolveTerminalStatus({ terminal: 'done' })).toEqual({ status: 'stage_1_done', error_code: null });
  });

  it('sweep：stale running 转终态，pending 永不转', () => {
    expect(shouldSweepToTerminal({ status: 'running', ageMs: SWEEP_TIMEOUT_MS + 1 })).toBe(true);
    expect(shouldSweepToTerminal({ status: 'pending', ageMs: SWEEP_TIMEOUT_MS + 1 })).toBe(false);
    expect(shouldSweepToTerminal({ status: 'running', ageMs: 1000 })).toBe(false);
  });
});

describe('acquisition-collect 扩词种子兜底 + 空文档阈值', () => {
  it('seedKeywordsFromDoc 恰好 3 词', () => {
    const seeds = seedKeywordsFromDoc('行业:家装全屋定制 受众:新房业主 卖点:环保板材 钩子:免费量房');
    expect(seeds).toHaveLength(3);
    expect(seeds.every((s) => s.length >= 2)).toBe(true);
  });

  it('EMPTY_DOC_MIN_CHARS 为正整数', () => {
    expect(EMPTY_DOC_MIN_CHARS).toBeGreaterThan(0);
    expect(Number.isInteger(EMPTY_DOC_MIN_CHARS)).toBe(true);
  });
});
