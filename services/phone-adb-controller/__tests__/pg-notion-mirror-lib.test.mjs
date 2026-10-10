// pg-notion-mirror-lib：PG → Notion 单向镜像通用引擎（任务 f6ad056e，决策 a029a7a7）。
// 纯依赖注入：假 pool + 内存版 Notion，不连库、不打网络。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { propsDigest, ensureDatabase, loadPageIndex, syncMirror, isFatalNotionError, ID_PROP, DIGEST_PROP } =
  require("../pg-notion-mirror-lib.js");

const PARENT = "parent-page-1";
const plain = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.text?.content ?? t.plain_text ?? "").join("");

// 内存版 Notion：只实现引擎用到的端点；calls 记录每次写，便于断言「没变不打 Notion」
function fakeNotion({ failOn } = {}) {
  const dbs = new Map(); const pages = new Map(); const children = new Map([[PARENT, []]]);
  const calls = []; let seq = 0;
  const err = (status, msg) => Object.assign(new Error(`Notion → ${status}: ${msg}`), { status });
  async function req(path, method = "GET", body) {
    if (method !== "GET" && !path.endsWith("/query")) calls.push(`${method} ${path}`);
    if (failOn) { const e = failOn(path, method, body, calls); if (e) throw e; }
    let m;
    if ((m = /^\/blocks\/([^/]+)\/children/.exec(path))) {
      return { results: (children.get(m[1]) || []).map((id) => ({ id, type: "child_database", child_database: { title: dbs.get(id).titleText } })), has_more: false };
    }
    if (path === "/databases" && method === "POST") {
      const id = `db-${++seq}`;
      dbs.set(id, { id, titleText: body.title[0].text.content, description: body.description, parent: body.parent, properties: { ...body.properties } });
      children.get(body.parent.page_id).push(id);
      return { id };
    }
    if ((m = /^\/databases\/([^/]+)\/query$/.exec(path))) {
      const all = [...pages.values()].filter((p) => p.dbId === m[1] && !p.archived);
      const start = body?.start_cursor ? Number(body.start_cursor) : 0;
      const slice = all.slice(start, start + 2); // 每页 2 条，逼出分页
      const next = start + 2 < all.length ? String(start + 2) : null;
      return { results: slice.map((p) => ({ id: p.id, properties: p.properties })), has_more: !!next, next_cursor: next };
    }
    if ((m = /^\/databases\/([^/]+)$/.exec(path))) {
      const db = dbs.get(m[1]); if (!db) throw err(404, "not found");
      if (method === "PATCH") { Object.assign(db.properties, body.properties); return db; }
      return { id: db.id, description: db.description, parent: db.parent, properties: db.properties, archived: false };
    }
    if (path === "/pages" && method === "POST") {
      const id = `page-${++seq}`;
      pages.set(id, { id, dbId: body.parent.database_id, properties: body.properties, archived: false });
      return { id };
    }
    if ((m = /^\/pages\/([^/]+)$/.exec(path)) && method === "PATCH") {
      const p = pages.get(m[1]); if (!p) throw err(404, "page gone");
      if (body.archived) p.archived = true;
      if (body.properties) p.properties = { ...p.properties, ...body.properties };
      return { id: p.id };
    }
    throw err(400, `unexpected ${method} ${path}`);
  }
  return { req, dbs, pages, children, calls, live: (dbId) => [...pages.values()].filter((p) => p.dbId === dbId && !p.archived) };
}

const SPEC = {
  key: "demo",
  title: "演示库",
  marker: "PG demo.rows → Notion（测试）",
  properties: { "名称": { title: {} }, "数量": { number: {} } },
  selectSql: "SELECT * FROM demo.rows",
  buildProps: (r) => ({ "名称": { title: [{ text: { content: r.name } }] }, "数量": { number: r.n } }),
};
const poolOf = (rowsRef) => ({ query: async () => ({ rows: rowsRef.rows }) });

test("propsDigest 与键序无关、内容变了指纹就变", () => {
  const a = propsDigest({ x: { number: 1 }, y: { rich_text: [] } });
  assert.equal(a, propsDigest({ y: { rich_text: [] }, x: { number: 1 } }));
  assert.notEqual(a, propsDigest({ x: { number: 2 }, y: { rich_text: [] } }));
});

test("ensureDatabase：缺库在父页下建（带来源标记+源ID/同步指纹列），再跑认领同一个库不重建", async () => {
  const n = fakeNotion();
  const id1 = await ensureDatabase(n.req, { parentPageId: PARENT, spec: SPEC });
  const id2 = await ensureDatabase(n.req, { parentPageId: PARENT, spec: SPEC });
  assert.equal(id1, id2);
  assert.equal(n.dbs.size, 1);
  const db = n.dbs.get(id1);
  assert.equal(plain({ rich_text: db.description }), SPEC.marker);
  assert.ok(db.properties[ID_PROP] && db.properties[DIGEST_PROP] && db.properties["数量"]);
});

test("ensureDatabase：同名库来源标记不符拒绝认领（宁可不推也不乱写别人的库）", async () => {
  const n = fakeNotion();
  await ensureDatabase(n.req, { parentPageId: PARENT, spec: { ...SPEC, marker: "别人的库" } });
  await assert.rejects(ensureDatabase(n.req, { parentPageId: PARENT, spec: SPEC }), /来源标记不符/);
});

test("ensureDatabase：已有库缺列 → PATCH 补列，不删人加的列", async () => {
  const n = fakeNotion();
  const id = await ensureDatabase(n.req, { parentPageId: PARENT, spec: SPEC });
  n.dbs.get(id).properties["人工备注"] = { rich_text: {} };
  delete n.dbs.get(id).properties["数量"];
  await ensureDatabase(n.req, { parentPageId: PARENT, spec: SPEC });
  assert.ok(n.dbs.get(id).properties["数量"]);
  assert.ok(n.dbs.get(id).properties["人工备注"]);
});

test("syncMirror：首轮全建；没变的第二轮零写；改一行只 PATCH 一页；Notion 行数 = PG 行数", async () => {
  const n = fakeNotion();
  const ref = { rows: [{ id: "a", name: "甲", n: 1 }, { id: "b", name: "乙", n: 2 }, { id: "c", name: "丙", n: 3 }] };
  const s1 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s1.created, 3); assert.equal(s1.notion_rows, 3); assert.equal(s1.source_rows, 3);
  const writesAfter1 = n.calls.length;
  const s2 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s2.skipped, 3); assert.equal(s2.created + s2.patched, 0);
  assert.equal(n.calls.length, writesAfter1, "没变的行不打 Notion 写接口");
  ref.rows[1] = { id: "b", name: "乙", n: 20 };
  const s3 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s3.patched, 1); assert.equal(s3.skipped, 2);
  const b = n.live(s3.db_id).find((p) => plain(p.properties[ID_PROP]) === "b");
  assert.equal(b.properties["数量"].number, 20);
});

test("syncMirror：建页中途失败，重跑只补缺的、不重复建页（页身份认源ID列）", async () => {
  let posts = 0;
  const n = fakeNotion({ failOn: (path, method) => (path === "/pages" && method === "POST" && ++posts === 2 ? Object.assign(new Error("Notion → 409: conflict"), { status: 409 }) : null) });
  const ref = { rows: [{ id: "a", name: "甲", n: 1 }, { id: "b", name: "乙", n: 2 }, { id: "c", name: "丙", n: 3 }] };
  const s1 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s1.failed, 1); assert.equal(s1.created, 2);
  const s2 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s2.created, 1);
  assert.equal(n.live(s2.db_id).length, 3);
});

test("syncMirror：同一源ID出现两页 → 留一页归档其余；PG 删了的行 → Notion 页归档", async () => {
  const n = fakeNotion();
  const ref = { rows: [{ id: "a", name: "甲", n: 1 }, { id: "b", name: "乙", n: 2 }] };
  const s1 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  const dup = [...n.pages.values()].find((p) => plain(p.properties[ID_PROP]) === "a");
  await n.req("/pages", "POST", { parent: { database_id: s1.db_id }, properties: dup.properties });
  ref.rows = [ref.rows[0]];
  const s2 = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s2.archived_duplicates, 1);
  assert.equal(s2.archived_orphans, 1);
  assert.equal(n.live(s1.db_id).length, 1);
  assert.equal(s2.notion_rows, 1);
});

test("syncMirror：PG 读回 0 行时不清空 Notion（防查询出错把镜子整库归档）", async () => {
  const n = fakeNotion();
  const ref = { rows: [{ id: "a", name: "甲", n: 1 }] };
  await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  ref.rows = [];
  const s = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(s.archived_orphans, 0);
  assert.equal(s.notion_rows, 1);
});

test("syncMirror：401/403/429/5xx 是致命错，整批立刻停，不逐行硬打", async () => {
  let posts = 0;
  const n = fakeNotion({ failOn: (path, method) => (path === "/pages" && method === "POST" ? (posts++, Object.assign(new Error("Notion → 401: unauthorized"), { status: 401 })) : null) });
  const ref = { rows: [{ id: "a", name: "甲", n: 1 }, { id: "b", name: "乙", n: 2 }, { id: "c", name: "丙", n: 3 }] };
  const s = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  assert.equal(posts, 1);
  assert.equal(s.fatal, true);
  assert.equal(isFatalNotionError({ status: 503 }), true);
  assert.equal(isFatalNotionError({ status: 409 }), false);
});

test("loadPageIndex：按源ID聚合并跟完分页", async () => {
  const n = fakeNotion();
  const ref = { rows: [1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, name: `行${i}`, n: i })) };
  const s = await syncMirror({ pool: poolOf(ref), notionReq: n.req, parentPageId: PARENT, spec: SPEC });
  const idx = await loadPageIndex(n.req, s.db_id);
  assert.equal(idx.size, 5);
  assert.equal(idx.get("r3").length, 1);
});
