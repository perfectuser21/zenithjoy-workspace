'use strict';

const { describe, it: test } = require('node:test');
const assert = require('node:assert/strict');

const { parseUserItem, applySecondaryFilter, formatFollowers, SECONDARY_FILTER } =
  require('../sop-account-search');

// ─── parseUserItem ────────────────────────────────────────────────

describe('parseUserItem', () => {
  const base = {
    user_info: {
      uid: 'u123',
      unique_id: 'abc',
      nickname: '一人公司老板',
      signature: '帮你做私域训练营',
      follower_count: 12000,
      following_count: 300,
      aweme_count: 80,
    },
  };

  test('正确映射所有字段', () => {
    const acc = parseUserItem(base, 1, '一人公司');
    assert.equal(acc.creatorName, '一人公司老板');
    assert.equal(acc.douyinId, 'abc');
    assert.equal(acc.followers, 12000);
    assert.equal(acc.bio, '帮你做私域训练营');
    assert.equal(acc.profileUrl, 'https://www.douyin.com/user/u123');
    assert.equal(acc.round, 1);
    assert.equal(acc.keyword, '一人公司');
  });

  test('uid 缺失时 profileUrl 为空字符串', () => {
    const item = { user_info: { ...base.user_info, uid: '', sec_uid: '' } };
    const acc = parseUserItem(item, 1, 'kw');
    assert.equal(acc.profileUrl, '');
  });

  test('字段缺失时使用默认值', () => {
    const acc = parseUserItem({ user_info: {} }, 2, 'kw');
    assert.equal(acc.followers, 0);
    assert.equal(acc.creatorName, '');
    assert.equal(acc.bio, '');
  });

  test('直接传 user 对象（无 user_info 包装）也能解析', () => {
    const acc = parseUserItem({ uid: 'u999', nickname: '直传', follower_count: 5000 }, 1, 'kw');
    assert.equal(acc.creatorName, '直传');
    assert.equal(acc.followers, 5000);
  });
});

// ─── applySecondaryFilter ─────────────────────────────────────────

describe('applySecondaryFilter', () => {
  const makeAcc = (overrides = {}) => ({
    creatorName: '默认账号',
    bio: '私域变现训练营，加微咨询',
    followers: 10000,
    profileUrl: 'https://www.douyin.com/user/x',
    douyinId: 'x',
    round: 1,
    keyword: 'kw',
    ...overrides,
  });

  test('粉丝在范围内 + 包含变现词 → 通过', () => {
    const result = applySecondaryFilter([makeAcc()], '一人公司');
    assert.equal(result.length, 1);
  });

  test('粉丝低于下限 → 过滤掉', () => {
    const result = applySecondaryFilter(
      [makeAcc({ followers: SECONDARY_FILTER.followersMin - 1 })],
      '一人公司'
    );
    assert.equal(result.length, 0);
  });

  test('粉丝高于上限 → 过滤掉', () => {
    const result = applySecondaryFilter(
      [makeAcc({ followers: SECONDARY_FILTER.followersMax + 1 })],
      '一人公司'
    );
    assert.equal(result.length, 0);
  });

  test('bio 匹配 topic 关键词也能通过（即使无变现词）', () => {
    const acc = makeAcc({ bio: '一人公司创始人', followers: 8000 });
    const result = applySecondaryFilter([acc], '一人公司');
    assert.equal(result.length, 1);
  });

  test('followers 为 0 → 过滤掉', () => {
    const result = applySecondaryFilter([makeAcc({ followers: 0 })], '一人公司');
    assert.equal(result.length, 0);
  });

  test('多个账号混合 → 只返回符合的', () => {
    const accounts = [
      makeAcc({ followers: 10000 }),            // 通过
      makeAcc({ followers: 1000 }),             // 粉丝不足
      makeAcc({ followers: 50000 }),            // 粉丝过多
      makeAcc({ followers: 15000, bio: '私域' }), // 通过
    ];
    const result = applySecondaryFilter(accounts, '一人公司');
    assert.equal(result.length, 2);
  });
});

// ─── formatFollowers ──────────────────────────────────────────────

describe('formatFollowers', () => {
  test('1万以上显示万', () => {
    assert.equal(formatFollowers(12000), '1.2万');
    assert.equal(formatFollowers(100000), '10.0万');
  });

  test('1万以下显示数字', () => {
    assert.equal(formatFollowers(9999), '9999');
    assert.equal(formatFollowers(0), '0');
  });
});
