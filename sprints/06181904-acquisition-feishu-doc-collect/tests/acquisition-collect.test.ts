import { describe, it, expect } from 'vitest';
// 目标模块尚未实现 → import 失败 = TDD Red。generator 实现后转绿。
// 纯逻辑单测（去重 / 残缺标记 / 扩词条数 / 主页链接）；端到端行为以 contract-dod.md [BEHAVIOR] manual:bash 为 evaluator oracle。
import {
  dedupCommenters,
  profileUrlForSecUid,
  EMPTY_DOC_MIN_CHARS,
} from '../../../apps/api/src/services/acquisition-collect.js';

describe('acquisition-collect 去重落库 [BEHAVIOR]', () => {
  it('同 sec_uid 跨视频去重：仅累加 source_video_ids，不新增行', () => {
    const existing = [
      { sec_uid: 'MS4wDUP', nickname: '张三', profile_url: profileUrlForSecUid('MS4wDUP'), partial: false, source_video_ids: ['vA'] },
    ];
    const batch = [{ sec_uid: 'MS4wDUP', nickname: '张三' }];
    const r = dedupCommenters(existing, batch, 'vB');
    expect(r.inserted).toBe(0);
    expect(r.deduped).toBe(1);
    expect(r.rows.find((x) => x.sec_uid === 'MS4wDUP')!.source_video_ids).toEqual(['vA', 'vB']);
  });

  it('sec_uid 缺失：昵称兜底入库，partial=true，profile_url=null', () => {
    const r = dedupCommenters([], [{ nickname: '匿名李四' }], 'vC');
    expect(r.inserted).toBe(1);
    const row = r.rows[0];
    expect(row.sec_uid).toBeNull();
    expect(row.partial).toBe(true);
    expect(row.profile_url).toBeNull();
  });

  it('同昵称无 sec_uid 弱去重：第二次不新增', () => {
    const existing = [{ sec_uid: null, nickname: '匿名李四', profile_url: null, partial: true, source_video_ids: ['vC'] }];
    const r = dedupCommenters(existing, [{ nickname: '匿名李四' }], 'vD');
    expect(r.inserted).toBe(0);
    expect(r.deduped).toBe(1);
  });

  it('profile_url 规则：sec_uid → douyin 主页链接', () => {
    expect(profileUrlForSecUid('MS4wNORMAL')).toBe('https://www.douyin.com/user/MS4wNORMAL');
    expect(profileUrlForSecUid(null)).toBeNull();
  });

  it('空文档阈值常量存在且为正（EMPTY_DOC 判定下限）', () => {
    expect(typeof EMPTY_DOC_MIN_CHARS).toBe('number');
    expect(EMPTY_DOC_MIN_CHARS).toBeGreaterThan(0);
  });
});
