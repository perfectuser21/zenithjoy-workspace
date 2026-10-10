// leadgen-notion-mirror：获客三表（视频/评论/线索）PG → Notion 镜像的列合同（任务 f6ad056e，决策 a029a7a7）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { SPECS, buildLeadProps, buildCommentProps, buildVideoProps, leadGrade, lineLabel, runOnce, parseEnvText } =
  require("../leadgen-notion-mirror.js");

const plain = (p) => (p?.title || p?.rich_text || []).map((t) => t.text.content).join("");

test("三张库：获客·视频 / 获客·评论 / 获客·线索，各有唯一来源标记，SQL 只读 zenithjoy.leadgen_* 三表", () => {
  assert.deepEqual(SPECS.map((s) => s.title), ["获客·视频", "获客·评论", "获客·线索"]);
  assert.equal(new Set(SPECS.map((s) => s.marker)).size, 3);
  for (const s of SPECS) {
    assert.match(s.selectSql, /FROM zenithjoy\.leadgen_(videos|comments|leads)/);
    assert.doesNotMatch(s.selectSql, /\b(INSERT|UPDATE|DELETE)\b/i, "镜像只读 PG");
  }
});

test("线索库必备列：抖音号、抖音主页链接、意向等级、触达状态、来源视频、业务线", () => {
  const spec = SPECS.find((s) => s.key === "leads");
  for (const col of ["抖音号", "抖音主页链接", "意向等级", "触达状态", "来源视频", "业务线"]) assert.ok(spec.properties[col], `缺列 ${col}`);
  assert.equal(spec.properties["抖音主页链接"].url !== undefined, true);
  const props = buildLeadProps({
    id: "e92b90f1", line_key: "jinuo", nickname: "小糖果", douyin_id: "1873867835", profile_url: "https://v.douyin.com/X_TqQpfletY/",
    comment_body: "[赞] 首评", source_video: "#技能培训#人工智能训练师", status: "待触达", send_status: "未发送",
    ai_judgment_reason: "[C] ", comment_grade: null, created_at: "2026-10-10T01:45:55Z",
  });
  assert.equal(plain(props["昵称"]), "小糖果");
  assert.equal(plain(props["抖音号"]), "1873867835");
  assert.equal(props["抖音主页链接"].url, "https://v.douyin.com/X_TqQpfletY/");
  assert.equal(props["意向等级"].select.name, "C");
  assert.equal(props["触达状态"].select.name, "待触达");
  assert.equal(plain(props["来源视频"]), "#技能培训#人工智能训练师");
  assert.equal(props["业务线"].select.name, "AI人工智能训练师");
  for (const k of Object.keys(props)) assert.ok(spec.properties[k], `属性 ${k} 不在库列合同里`);
});

test("意向等级：评论池分拣结果优先，其次 AI 判定理由的 [X] 前缀，都没有留空", () => {
  assert.equal(leadGrade({ comment_grade: "A", ai_judgment_reason: "[C] x" }), "A");
  assert.equal(leadGrade({ comment_grade: null, ai_judgment_reason: "[B] 有意向" }), "B");
  assert.equal(leadGrade({ comment_grade: null, ai_judgment_reason: "无前缀" }), null);
});

test("业务线：路由键翻成客户语义名，认不出的原样显示（不兜底成别家业务线）", () => {
  assert.equal(lineLabel("jinuo"), "AI人工智能训练师");
  assert.equal(lineLabel("yuesheng"), "悦升云端");
  assert.equal(lineLabel("xiaolongxia"), "xiaolongxia");
});

test("空主页链接写 null（Notion url 列不收空串），视频判定翻中文", () => {
  const c = buildCommentProps({ id: "x", line_key: "jinuo", nickname: "甲", comment_body: "怎么报名", profile_url: "", intent_grade: "A", relevance: "相关", process_status: "待分拣" });
  assert.equal(c["抖音主页链接"].url, null);
  assert.equal(c["意向等级"].select.name, "A");
  const v = buildVideoProps({ id: "v", line_key: "yuesheng", title: "标题", video_url: "https://v.douyin.com/a/", judgment_status: "rejected", comment_count: 3 });
  assert.equal(v["判定结论"].select.name, "不合格");
  assert.equal(v["评论数"].number, 3);
  for (const spec of SPECS) {
    const sample = spec.key === "videos" ? v : spec.key === "comments" ? c : null;
    if (sample) for (const k of Object.keys(sample)) assert.ok(spec.properties[k], `${spec.title} 属性 ${k} 不在列合同里`);
  }
});

test("runOnce：三表依次同步，任一表致命失败不阻断后面的表，汇总 ok=false", async () => {
  const calls = [];
  const fakeSync = async ({ spec }) => { calls.push(spec.key); return { key: spec.key, failed: spec.key === "videos" ? 1 : 0, fatal: spec.key === "videos", source_rows: 1, notion_rows: 1 }; };
  const out = await runOnce({ pool: {}, notionReq: async () => ({}), parentPageId: "p", syncImpl: fakeSync });
  assert.deepEqual(calls, ["videos", "comments", "leads"]);
  assert.equal(out.ok, false);
  assert.equal(out.tables.length, 3);
});

test("parseEnvText：认 export 前缀与引号，供 launchd 直接读 ~/.credentials/*.env", () => {
  assert.deepEqual(parseEnvText('export A="1"\n# c\nB=two\n'), { A: "1", B: "two" });
});
