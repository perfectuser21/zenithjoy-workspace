import { describe, it, expect } from 'vitest';
import { mapRawCommenters } from '../utils/comment-mapper';

/**
 * 评论文本映射 regression test
 *
 * 守卫：crawl 结果映射成 comment-score-result 格式时，
 * text 字段必须来自 comment_text，不能用 nickname
 */

describe('评论文本映射守卫', () => {
  it('comment_text 存在时 text 必须等于 comment_text，不能用 nickname', () => {
    const raw = [
      { sec_uid: 'MS4w_abc', nickname: '张三', comment_text: '这个产品真的好用！' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('这个产品真的好用！');
    expect(result[0].text).not.toBe('张三');
  });

  it('comment_text 为空字符串时 text 也是空字符串，不 fallback 到 nickname', () => {
    const raw = [
      { sec_uid: 'MS4w_def', nickname: '李四', comment_text: '' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('');
    expect(result[0].text).not.toBe('李四');
  });

  it('comment_text 缺失（undefined）时 text 是空字符串，不崩溃', () => {
    const raw = [
      { sec_uid: 'MS4w_xyz', nickname: '王五' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('');
  });

  it('commenter_id 用 sec_uid 路径，格式 /user/<sec_uid>', () => {
    const raw = [
      { sec_uid: 'MS4w_abc', nickname: '张三', comment_text: '好' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].commenter_id).toBe('/user/MS4w_abc');
  });

  it('sec_uid 为 null 时 commenter_id fallback 到 nickname', () => {
    const raw = [
      { sec_uid: undefined, nickname: '赵六', comment_text: '不错' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].commenter_id).toBe('赵六');
  });

  it('多条评论各自映射 text 正确', () => {
    const raw = [
      { sec_uid: 'uid1', nickname: 'A', comment_text: '第一条评论' },
      { sec_uid: 'uid2', nickname: 'B', comment_text: '第二条评论' },
      { sec_uid: 'uid3', nickname: 'C', comment_text: '' },
    ];
    const result = mapRawCommenters(raw);
    expect(result[0].text).toBe('第一条评论');
    expect(result[1].text).toBe('第二条评论');
    expect(result[2].text).toBe('');
  });
});
