import { test } from "node:test";
import assert from "node:assert/strict";
import lib from "../next-outreach-lib.js";

const F_OK = { "客户昵称": "沉", "抖音号": "LHJ20001024", "主页链接": "https://www.douyin.com/user/MS4wLjABAAAAtest-_x" };
const F_SHORT = { "客户昵称": "板烧鸡腿堡", "抖音号": "P0ten", "主页链接": "https://v.douyin.com/AbCd123/" };
const F_NOLINK = { "客户昵称": "砚秋", "抖音号": "", "主页链接": "" };
const F_PENDING = { "客户昵称": "你脸红了诶~", "抖音号": "31225819860", "主页链接": "https://www.douyin.com/user/MS4wq" };

test("extractLead: 直接读独立字段", () => {
  const r = lib.extractLead(F_OK);
  assert.equal(r.nick, "沉");
  assert.equal(r.dyid, "LHJ20001024");
  assert.equal(r.profileUrl, "https://www.douyin.com/user/MS4wLjABAAAAtest-_x");
});
test("extractLead: 短链字段", () => {
  assert.equal(lib.extractLead(F_SHORT).profileUrl, "https://v.douyin.com/AbCd123/");
});
test("classifyPending: 带链+合法dyid=ok", () => {
  assert.equal(lib.classifyPending(F_OK), "ok");
  assert.equal(lib.classifyPending(F_PENDING), "ok");
});
test("classifyPending: 无链=no_link", () => {
  assert.equal(lib.classifyPending(F_NOLINK), "no_link");
});
test("classifyPending: 有链但dyid非法=no_link", () => {
  assert.equal(lib.classifyPending({ "客户昵称": "某人", "抖音号": "id待核验", "主页链接": "https://v.douyin.com/x1/" }), "no_link");
  assert.equal(lib.classifyPending({ "客户昵称": "某人", "抖音号": "中文号", "主页链接": "https://v.douyin.com/x1/" }), "no_link");
});
test("requeueTransientFields: 首轮回队待触达+标记", () => {
  const f = lib.requeueTransientFields("", "AdbIME cannot be enabled", "0915 12:00(UTC+8)");
  assert.equal(f["状态"], "待触达");
  assert.ok(f["回复结果"].startsWith("[瞬时败]"));
});
test("requeueTransientFields: 二轮转受阻,保留原文", () => {
  const f = lib.requeueTransientFields("[瞬时败][1轮 0915 12:00(UTC+8)]x", "again", "0915 13:00(UTC+8)");
  assert.equal(f["状态"], "触达受阻");
  assert.equal(f["发送状态"], "发送失败");
  assert.ok(f["回复结果"].includes("[瞬时败]"));
  assert.ok(f["回复结果"].includes("2轮转受阻"));
  assert.ok(f["回复结果"].length <= 200);
});
