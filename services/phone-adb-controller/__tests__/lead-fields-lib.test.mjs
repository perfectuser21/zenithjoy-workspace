import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadCoreFields, extractSeenEntries, findByDyid } from "../lead-fields-lib.js";

test("buildLeadCoreFields: 含新字段,不含旧字段", () => {
  const f = buildLeadCoreFields({ nick: "沉", dyid: "LHJ20001024", purl: "https://www.douyin.com/user/x", comment: "怎么报名", video: "初级会计视频", vurl: "https://v.douyin.com/AbCd/" });
  assert.equal(f["抖音昵称"], "沉");
  assert.equal(f["抖音号"], "LHJ20001024");
  assert.equal(f["主页链接"], "https://www.douyin.com/user/x");
  assert.equal(f["原始评论"], "怎么报名");
  assert.equal(f["评论作品视频链接"], "https://v.douyin.com/AbCd/");
  assert.equal("抖音昵称/主页链接" in f, false);
  assert.equal("命中关键词" in f, false);
  assert.equal("评论原文" in f, false);
  assert.equal("昵称" in f, false);
});

test("buildLeadCoreFields: 非法链接(不以http开头)留空", () => {
  const f = buildLeadCoreFields({ nick: "沉", dyid: "x", purl: "display:砚秋", comment: "c", video: "v", vurl: "" });
  assert.equal(f["主页链接"], "");
  assert.equal(f["评论作品视频链接"], "");
});

test("extractSeenEntries: 从独立字段读取,不解析合并列", () => {
  const records = [
    { record_id: "r1", fields: { "抖音昵称": "沉", "抖音号": "LHJ20001024", "重复命中次数": 2 } },
    { record_id: "r2", fields: { "抖音昵称": "板烧鸡腿堡", "抖音号": "" } },
  ];
  const entries = extractSeenEntries(records);
  assert.deepEqual(entries[0], { nick: "沉", dyid: "LHJ20001024", record_id: "r1", dup: 2 });
  assert.deepEqual(entries[1], { nick: "板烧鸡腿堡", dyid: "", record_id: "r2", dup: 0 });
});

test("findByDyid: 精确匹配抖音号", () => {
  const rows = [{ id: "r1", dyid: "abc" }, { id: "r2", dyid: "xyz" }];
  assert.equal(findByDyid(rows, "xyz").id, "r2");
  assert.equal(findByDyid(rows, "no-such"), null);
});
