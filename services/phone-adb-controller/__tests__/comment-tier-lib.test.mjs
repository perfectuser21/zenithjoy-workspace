import { test } from "node:test";
import assert from "node:assert/strict";
import { commentTier, commentDedupKey, shouldKeepScrolling } from "../comment-tier-lib.js";

test("commentTier: 边界值9/10/11条(0/10/11三个关键边界)", () => {
  assert.equal(commentTier(0).tier, "small");
  assert.equal(commentTier(9).tier, "small");
  assert.equal(commentTier(10).tier, "small");
  assert.equal(commentTier(11).tier, "medium");
});

test("commentTier: 边界值99/100/101条", () => {
  assert.equal(commentTier(99).tier, "medium");
  assert.equal(commentTier(100).tier, "medium");
  assert.equal(commentTier(101).tier, "large");
});

test("commentTier: small/medium没有cap,large有cap(默认50,可调)", () => {
  assert.equal(commentTier(5).cap, null);
  assert.equal(commentTier(50).cap, null);
  assert.equal(commentTier(500).cap, 50);
  assert.equal(commentTier(500, 30).cap, 30);
});

test("commentTier: 非数字/负数按0处理,不崩", () => {
  assert.equal(commentTier(undefined).tier, "small");
  assert.equal(commentTier("abc").tier, "small");
  assert.equal(commentTier(null).tier, "small");
});

test("commentDedupKey: 跟push-raw-comments.js现有rid逻辑一致", () => {
  assert.equal(commentDedupKey("沉", "LHJ20001024", "怎么报名"), "沉|LHJ20001024|怎么报名");
  assert.equal(commentDedupKey("沉", "", "x"), "沉|noid|x");
});

test("shouldKeepScrolling: exhausted=true立即停", () => {
  assert.equal(shouldKeepScrolling({ exhausted: true, totalCollected: 5, cap: null, consecutiveEmptyRounds: 0 }), false);
});

test("shouldKeepScrolling: 大户攒够cap数就停,不管exhausted", () => {
  assert.equal(shouldKeepScrolling({ exhausted: false, totalCollected: 50, cap: 50, consecutiveEmptyRounds: 0 }), false);
  assert.equal(shouldKeepScrolling({ exhausted: false, totalCollected: 49, cap: 50, consecutiveEmptyRounds: 0 }), true);
});

test("shouldKeepScrolling: 连续2次没有新增(滑动可能卡住了)就停,防死循环", () => {
  assert.equal(shouldKeepScrolling({ exhausted: false, totalCollected: 10, cap: null, consecutiveEmptyRounds: 1 }), true);
  assert.equal(shouldKeepScrolling({ exhausted: false, totalCollected: 10, cap: null, consecutiveEmptyRounds: 2 }), false);
});

test("shouldKeepScrolling: medium档(cap=null)正常情况下继续滑", () => {
  assert.equal(shouldKeepScrolling({ exhausted: false, totalCollected: 20, cap: null, consecutiveEmptyRounds: 0 }), true);
});
