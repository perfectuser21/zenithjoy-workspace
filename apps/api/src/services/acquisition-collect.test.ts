import { describe, it, expect } from 'vitest';
import {
  dedupCommenters,
  profileUrlForSecUid,
  resolveTerminalStatus,
  shouldSweepToTerminal,
  seedKeywordsFromDoc,
  settleCollectTask,
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

  it('terminal=partial→status=partial；stage_1→stage_1_done；done→done（第二阶段评论采集完成）', () => {
    expect(resolveTerminalStatus({ terminal: 'partial', partial_reason: 'video_insufficient' })).toEqual({ status: 'partial', error_code: 'video_insufficient' });
    expect(resolveTerminalStatus({ terminal: 'stage_1' })).toEqual({ status: 'stage_1_done', error_code: null });
    expect(resolveTerminalStatus({ terminal: 'done' })).toEqual({ status: 'done', error_code: null });
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

describe('settleCollectTask — 服务端终态结算 [BEHAVIOR]', () => {
  it('已终态 → changed=false 原样返回（终态守卫）', () => {
    for (const s of ['done', 'partial', 'failed', 'cancelled']) {
      const r = settleCollectTask({ currentStatus: s, videoTotal: 3, videoDone: 3, leadCount: 5 });
      expect(r).toEqual({ status: s, error_code: null, changed: false });
    }
  });

  it('cancelling → cancelled 落章（修 cancelled 永不落章 bug）', () => {
    const r = settleCollectTask({ currentStatus: 'cancelling', agentTerminal: { terminal: 'done' }, videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'cancelled', error_code: null, changed: true });
  });

  it('agent 报 failed → failed + error_code 字面落库', () => {
    const r = settleCollectTask({ currentStatus: 'running', agentTerminal: { terminal: 'failed', error_code: 'DOUYIN_RISK' }, videoTotal: 3, videoDone: 1, leadCount: 0 });
    expect(r).toEqual({ status: 'failed', error_code: 'DOUYIN_RISK', changed: true });
  });

  it('agent 报 done 且全部视频完成 → done', () => {
    const r = settleCollectTask({ currentStatus: 'stage_1_done', agentTerminal: { terminal: 'done' }, videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'done', error_code: null, changed: true });
  });

  it('agent 报 done 但视频未收全 → 诚实结算 partial', () => {
    const r = settleCollectTask({ currentStatus: 'stage_1_done', agentTerminal: { terminal: 'done' }, videoTotal: 3, videoDone: 1, leadCount: 5 });
    expect(r.status).toBe('partial');
    expect(r.error_code).toBe('videos_incomplete');
    expect(r.changed).toBe(true);
  });

  it('agent 报 partial → partial + partial_reason 优先', () => {
    const r = settleCollectTask({ currentStatus: 'running', agentTerminal: { terminal: 'partial', partial_reason: 'comments_closed' }, videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'partial', error_code: 'comments_closed', changed: true });
  });

  it('无 terminal 且 stage_1_done 全部视频完成 → 服务端自动 done', () => {
    const r = settleCollectTask({ currentStatus: 'stage_1_done', videoTotal: 3, videoDone: 3, leadCount: 5 });
    expect(r).toEqual({ status: 'done', error_code: null, changed: true });
  });

  it('无 terminal 且 running（Stage1 清单未报，逐视频自然 total==done）→ 不自动结算', () => {
    const r = settleCollectTask({ currentStatus: 'running', videoTotal: 1, videoDone: 1, leadCount: 2 });
    expect(r.changed).toBe(false);
    expect(r.status).toBe('running');
  });

  it("旧 agent 报 terminal:'stage_1'（非标准值）→ stage_1_done（向后兼容）", () => {
    const r = settleCollectTask({ currentStatus: 'running', agentTerminal: { terminal: 'stage_1' }, videoTotal: 1, videoDone: 0, leadCount: 0 });
    expect(r).toEqual({ status: 'stage_1_done', error_code: null, changed: true });
  });
});
