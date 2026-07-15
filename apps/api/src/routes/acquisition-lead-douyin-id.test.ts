/**
 * Seg3 方案 B′ — /comment-score-result 收 douyin_id 落库（TDD Red 先行）。
 *
 * 设备端抓评论时点头像进主页读出真实抖音号，随 comments[].douyin_id 上行。
 * 服务端必须把它落进 acquisition_leads.douyin_id，派单段才有号可发。
 *
 * 落库 SQL 本体裹在 `if (!process.env.VITEST)` 里（无真 PG 不可达），故拆成两层守：
 *   1) `buildLeadFieldsFromComment` 纯映射 —— 单测覆盖「宁可空，不可猜」的全部归一规则
 *   2) 源码静态守 —— SQL 真的把 douyin_id 写进 INSERT 且在 UPDATE 路径回填
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildLeadFieldsFromComment } from './acquisition';

describe('buildLeadFieldsFromComment — 评论 → lead 字段映射', () => {
  it('带 douyin_id 的评论 → 原样取号', () => {
    const f = buildLeadFieldsFromComment({
      commenter_id: '小叶子',
      text: '怎么联系你们',
      douyin_id: '1689210742',
    });
    expect(f.douyinId).toBe('1689210742');
    expect(f.nickname).toBe('小叶子');
    expect(f.commentText).toBe('怎么联系你们');
  });

  it('没 douyin_id（老版本 agent / 没读到）→ null，绝不编一个', () => {
    const f = buildLeadFieldsFromComment({ commenter_id: '小叶子', text: '多少钱' });
    expect(f.douyinId).toBeNull();
  });

  it('douyin_id 是空白串 → 归一成 null（空白不是号）', () => {
    const f = buildLeadFieldsFromComment({ commenter_id: '小叶子', text: 'x', douyin_id: '  ' });
    expect(f.douyinId).toBeNull();
  });

  it('绝不拿昵称或 URL 冒充抖音号', () => {
    const f = buildLeadFieldsFromComment({
      commenter_id: 'https://www.douyin.com/user/MS4wLjABAAAA',
      text: 'x',
    });
    // 读不到号就是 null——回退成 nickname/URL 正是设备端 NO_MATCH 的根源
    expect(f.douyinId).toBeNull();
  });

  it('sec_uid 仍从 commenter_id 里的 /user/<id> 解析（既有行为不回归）', () => {
    const f = buildLeadFieldsFromComment({
      commenter_id: 'https://www.douyin.com/user/MS4wLjABAAAA',
      text: 'x',
    });
    expect(f.secUid).toBe('MS4wLjABAAAA');
    expect(f.profileUrl).toBe('https://www.douyin.com/user/MS4wLjABAAAA');
  });

  it('纯昵称（无 /user/）→ sec_uid=null，profile_url=null', () => {
    const f = buildLeadFieldsFromComment({ commenter_id: '小叶子', text: 'x' });
    expect(f.secUid).toBeNull();
    expect(f.profileUrl).toBeNull();
  });

  it('空 commenter_id → nickname 兜底「未知」（既有行为不回归）', () => {
    const f = buildLeadFieldsFromComment({ commenter_id: '', text: 'x' });
    expect(f.nickname).toBe('未知');
  });
});

describe('/comment-score-result 落库 SQL 真用了 douyin_id（源码静态守）', () => {
  const SRC = readFileSync(path.join(__dirname, 'acquisition.ts'), 'utf-8');

  it('INSERT acquisition_leads 的列表里有 douyin_id', () => {
    const insert = SRC.match(/INSERT INTO zenithjoy\.acquisition_leads[\s\S]{0,400}?RETURNING id/i);
    expect(insert, '找不到 lead INSERT 语句').not.toBeNull();
    expect(/douyin_id/i.test(insert![0]), 'INSERT 列表必须含 douyin_id').toBe(true);
  });

  it('命中既有 lead 的 UPDATE 路径也回填 douyin_id（老 lead 补号，否则永远派不出去）', () => {
    // 存量 lead 是在没有 douyin_id 列的年代采的，douyin_id 全 NULL。
    // 只在 INSERT 写号 → 这些老 lead 再采到也补不上号 → 永远 limited。
    const update = SRC.match(/UPDATE zenithjoy\.acquisition_leads[\s\S]{0,500}?WHERE id = \$1/i);
    expect(update, '找不到 lead UPDATE 语句').not.toBeNull();
    expect(/douyin_id/i.test(update![0]), 'UPDATE 必须回填 douyin_id').toBe(true);
  });

  it('UPDATE 回填用 COALESCE 保号——不能把已有的号覆盖成 NULL', () => {
    const update = SRC.match(/UPDATE zenithjoy\.acquisition_leads[\s\S]{0,500}?WHERE id = \$1/i);
    expect(/COALESCE[\s\S]{0,40}douyin_id|douyin_id[\s\S]{0,40}COALESCE/i.test(update![0])).toBe(true);
  });
});
