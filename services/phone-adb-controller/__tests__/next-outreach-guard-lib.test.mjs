// 触达选单护栏纯函数（等级门槛 / 选号 / 悬空回收 / 预写校验）+ next-outreach.js 接线守卫。
// 背景：0928 生产事故——熔断后 20 秒空转（选单器随机选到已熔断号又取同一条线索）、
// 预写「触达中」不校验、触达等级门槛写死。判断全部放纯函数，网络部分只剩薄薄一层。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require_ = createRequire(import.meta.url);
const lib = require_("../next-outreach-lib.js");
const { routeOf } = require_("../line-routes.js");

// ── leadGrade / GRADE_ORDER / gradeRank ────────────────────────────────
test("leadGrade: 从 AI判断理由 前缀取等级字母（字符串 / [{text}] / {name}）", () => {
  assert.equal(lib.leadGrade({ "AI判断理由": "[A级] 明确求职" }), "A");
  assert.equal(lib.leadGrade({ "AI判断理由": "[B级] 有意向" }), "B");
  assert.equal(lib.leadGrade({ "AI判断理由": [{ text: "[C级] " }, { text: "一般" }] }), "C");
  assert.equal(lib.leadGrade({ "AI判断理由": { name: "[D级] x" } }), "D");
  assert.equal(lib.leadGrade({ "AI判断理由": "[E级] 弱" }), "E");
  assert.equal(lib.leadGrade({ "AI判断理由": "[A+] 兼容写法" }), "A");
});

test("leadGrade: 取不到返回 null（老数据无前缀 / 非法字母 / 空 / 缺字段）", () => {
  assert.equal(lib.leadGrade({ "AI判断理由": "没有等级前缀" }), null);
  assert.equal(lib.leadGrade({ "AI判断理由": "[F级] 越界" }), null);
  assert.equal(lib.leadGrade({ "AI判断理由": "" }), null);
  assert.equal(lib.leadGrade({}), null);
  assert.equal(lib.leadGrade(undefined), null);
  assert.equal(lib.leadGrade({ "AI判断理由": "说明里提到[A级]但不在开头" }), null);
});

test("GRADE_ORDER 与 gradeRank：A=0..E=4，null/未知=5 排最后", () => {
  assert.deepEqual(lib.GRADE_ORDER, ["A", "B", "C", "D", "E"]);
  assert.equal(lib.gradeRank("A"), 0);
  assert.equal(lib.gradeRank("B"), 1);
  assert.equal(lib.gradeRank("C"), 2);
  assert.equal(lib.gradeRank("D"), 3);
  assert.equal(lib.gradeRank("E"), 4);
  assert.equal(lib.gradeRank(null), 5);
  assert.equal(lib.gradeRank("Z"), 5);
  assert.equal(lib.gradeRank(undefined), 5);
});

// ── gradeAllowed ───────────────────────────────────────────────────────
test("gradeAllowed: 在允许列表内放行，不在则拒", () => {
  assert.equal(lib.gradeAllowed("A", ["A", "B"]), true);
  assert.equal(lib.gradeAllowed("C", ["A", "B"]), false);
  assert.equal(lib.gradeAllowed("E", ["A", "B", "C", "D", "E"]), true);
});

test("gradeAllowed: 等级为 null（老数据没有前缀）一律放行，不因新门槛丢老单", () => {
  assert.equal(lib.gradeAllowed(null, ["A"]), true);
  assert.equal(lib.gradeAllowed(null, []), true);
});

// ── pickSender / parseExclude ──────────────────────────────────────────
const S1 = { profile: "jinoshengyuan-work", id: "langzi63485", label: "小号1 躺赢AI学姐" };
const S2 = { profile: "legacy", id: "44997267357", label: "小号2 人工智能小诺考评" };

test("pickSender: rand 注入决定选谁，未被排除的才参与", () => {
  assert.equal(lib.pickSender([S1, S2], [], () => 0).profile, "jinoshengyuan-work");
  assert.equal(lib.pickSender([S1, S2], [], () => 0.99).profile, "legacy");
  assert.equal(lib.pickSender([S1, S2], ["jinoshengyuan-work"], () => 0).profile, "legacy");
  assert.equal(lib.pickSender([S1, S2], ["legacy"], () => 0.99).profile, "jinoshengyuan-work");
});

test("pickSender: 全被排除返回 null；不认识的排除名被忽略", () => {
  assert.equal(lib.pickSender([S1, S2], ["jinoshengyuan-work", "legacy"], () => 0), null);
  assert.equal(lib.pickSender([], [], () => 0), null);
  assert.equal(lib.pickSender([S1, S2], ["nobody"], () => 0).profile, "jinoshengyuan-work");
});

test("pickSender: 默认用 Math.random，返回值一定来自候选", () => {
  for (let i = 0; i < 20; i++) assert.ok([S1, S2].includes(lib.pickSender([S1, S2], [])));
});

test("parseExclude: 逗号拆分、去空白与空段；空/undefined → []", () => {
  assert.deepEqual(lib.parseExclude("a,b"), ["a", "b"]);
  assert.deepEqual(lib.parseExclude(" a , ,b,"), ["a", "b"]);
  assert.deepEqual(lib.parseExclude(""), []);
  assert.deepEqual(lib.parseExclude(undefined), []);
  assert.deepEqual(lib.parseExclude("solo"), ["solo"]);
});

// ── isStaleInflight ────────────────────────────────────────────────────
const TTL = 40 * 60 * 1000;
const NOW = 1_800_000_000_000;

test("isStaleInflight: 触达中且超过 ttl → true", () => {
  assert.equal(lib.isStaleInflight({ fields: { "状态": "触达中" }, last_modified_time: NOW - TTL - 1 }, NOW, TTL), true);
  assert.equal(lib.isStaleInflight({ fields: { "状态": [{ text: "触达中" }] }, last_modified_time: NOW - 3 * TTL }, NOW, TTL), true);
});

test("isStaleInflight: 未超时 / 恰好等于 ttl → false", () => {
  assert.equal(lib.isStaleInflight({ fields: { "状态": "触达中" }, last_modified_time: NOW - TTL + 1 }, NOW, TTL), false);
  assert.equal(lib.isStaleInflight({ fields: { "状态": "触达中" }, last_modified_time: NOW - TTL }, NOW, TTL), false);
});

test("isStaleInflight: 状态不是触达中 / 缺 last_modified_time → false（不猜）", () => {
  assert.equal(lib.isStaleInflight({ fields: { "状态": "待触达" }, last_modified_time: 1 }, NOW, TTL), false);
  assert.equal(lib.isStaleInflight({ fields: { "状态": "已触达" }, last_modified_time: 1 }, NOW, TTL), false);
  assert.equal(lib.isStaleInflight({ fields: { "状态": "触达中" } }, NOW, TTL), false);
  assert.equal(lib.isStaleInflight({ fields: { "状态": "触达中" }, last_modified_time: undefined }, NOW, TTL), false);
  assert.equal(lib.isStaleInflight({}, NOW, TTL), false);
});

// ── verifyClaim ────────────────────────────────────────────────────────
const EXPECT = { sender_label_with_id: "小号2 人工智能小诺考评(44997267357)", script_id: "S-001" };
const OK_FIELDS = { "状态": "触达中", "实际分发号": "小号2 人工智能小诺考评(44997267357)", "话术ID": "S-001" };

test("verifyClaim: 三项一致 → ok", () => {
  assert.deepEqual(lib.verifyClaim(OK_FIELDS, EXPECT), { ok: true });
  assert.deepEqual(lib.verifyClaim({
    "状态": { name: "触达中" }, "实际分发号": [{ text: "小号2 人工智能小诺考评(44997267357)" }], "话术ID": [{ text: "S-001" }],
  }, EXPECT), { ok: true });
});

test("verifyClaim: 状态不符 / 分发号不符 / 话术ID不符 → 各自带原因", () => {
  const a = lib.verifyClaim({ ...OK_FIELDS, "状态": "待触达" }, EXPECT);
  assert.equal(a.ok, false); assert.match(a.reason, /状态/);
  const b = lib.verifyClaim({ ...OK_FIELDS, "实际分发号": "小号1 躺赢AI学姐(langzi63485)" }, EXPECT);
  assert.equal(b.ok, false); assert.match(b.reason, /实际分发号/);
  const c = lib.verifyClaim({ ...OK_FIELDS, "话术ID": "S-999" }, EXPECT);
  assert.equal(c.ok, false); assert.match(c.reason, /话术ID/);
});

test("verifyClaim: 回读为空（写失败/字段缺失）→ 不 ok", () => {
  assert.equal(lib.verifyClaim({}, EXPECT).ok, false);
  assert.equal(lib.verifyClaim(undefined, EXPECT).ok, false);
});

// ── next-outreach.js 接线守卫（网络部分难单测，守住"接线"与"常量没改错"） ──
test("routeOf(jinuo) 的 base/lead/script 等于 next-outreach.js 原写死常量（防改错）", () => {
  const r = routeOf("jinuo");
  assert.equal(r.base, "GNuwbzY0da8GP0sv6MGcOTu9ntd");
  assert.equal(r.lead, "tblTLFj69CflUqSr");
  assert.equal(r.script, "tblZZWdv0YUNojqI");
});

test("接线守卫：next-outreach.js 取路由表，不再写死表 id；接了护栏纯函数与 --exclude", () => {
  const src = readFileSync(new URL("../next-outreach.js", import.meta.url), "utf8");
  for (const lit of ["GNuwbzY0da8GP0sv6MGcOTu9ntd", "tblTLFj69CflUqSr", "tblZZWdv0YUNojqI"]) {
    assert.ok(!src.includes(lit), `next-outreach.js 仍写死 ${lit}，应取自 routeOf("jinuo")`);
  }
  assert.match(src, /routeOf\(\s*["']jinuo["']\s*\)/);
  for (const fn of ["gradeAllowed", "leadGrade", "gradeRank", "pickSender", "parseExclude", "isStaleInflight", "verifyClaim"]) {
    assert.ok(src.includes(fn), `next-outreach.js 未接 ${fn}`);
  }
  for (const s of ["--exclude", "NO_SENDER", "CLAIM_FAILED", "swept_inflight=", "grade_filtered=", "[触达中悬空回收]"]) {
    assert.ok(src.includes(s), `next-outreach.js 缺少 ${s}`);
  }
});

test("接线守卫：NO_SENDER 判定必须在预写「触达中」之前", () => {
  const src = readFileSync(new URL("../next-outreach.js", import.meta.url), "utf8");
  const iSender = src.indexOf("NO_SENDER");
  const iClaim = src.indexOf('"触达中", "话术ID"');
  assert.ok(iSender > 0 && iClaim > 0, "找不到 NO_SENDER 或预写触达中的位置");
  assert.ok(iSender < iClaim, "NO_SENDER 在预写触达中之后——全被排除时线索已被动过");
});
