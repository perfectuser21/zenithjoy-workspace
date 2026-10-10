// pg-notion-mirror-lib.js —— Postgres → Notion 单向镜像通用引擎（任务 f6ad056e，决策 a029a7a7：PG 为真身，Notion 内部看，飞书给客户）
//
// 调用方只给一份 spec：{ key, title, marker, properties, selectSql, buildProps(row) }，引擎负责：
//   1. 建库/认领：父页下找同名库，来源标记（库描述）吻合才认领，没有就建；缺列 PATCH 补（不删人加的列）。
//   2. 页身份 = 「源ID」列（PG 行主键）。每轮先把库里现存页按源ID建索引——映射表就住在 Notion 里：
//      建页成功后哪怕进程当场崩掉，下一轮也能凭源ID认回这页，不会重复建（失败重试不重复建页）。
//      不在 PG 加 notion_page_id 列：生产 zenithjoy 库的迁移要走 promote-prod-hk 人工放行闸，镜子不该卡在那。
//   3. 增量：按将要写的属性算指纹存进「同步指纹」列，指纹没变不打 Notion；变了 PATCH，缺页 POST。
//   4. 自愈：同一源ID多页 → 留一页归档其余；PG 已删的行 → 归档对应页（PG 读回 0 行时不归档，防查询出错清空镜子）。
//   5. 401/403/429/5xx/网络错 = 致命，整批立刻停，下轮再来（指纹没写就会重推）。
//
// 纯逻辑 + 依赖注入：notionReq(path, method, body) 与 pool.query 都由调用方给，单测不连库不打网络。
"use strict";

const crypto = require("crypto");

const ID_PROP = "源ID";
const DIGEST_PROP = "同步指纹";
const RT_MAX = 1900;
const NOTION_VERSION = "2022-06-28";

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") return Object.keys(v).sort().reduce((o, k) => { o[k] = stable(v[k]); return o; }, {});
  return v;
}

/** 属性指纹：键序无关的 sha1 */
function propsDigest(properties) {
  return crypto.createHash("sha1").update(JSON.stringify(stable(properties || {}))).digest("hex");
}

// ── 属性构造小工具（给各 spec 用）────────────────────────────────────
const textOf = (v) => (v === null || v === undefined ? "" : String(v));
const rt = (v) => { const t = textOf(v).slice(0, RT_MAX); return t ? [{ type: "text", text: { content: t } }] : []; };
const P = {
  title: (v, max = 200) => ({ title: rt(textOf(v).slice(0, max)) }),
  text: (v) => ({ rich_text: rt(v) }),
  select: (v) => ({ select: textOf(v).trim() ? { name: textOf(v).trim().replace(/,/g, "，").slice(0, 100) } : null }),
  number: (v) => ({ number: v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v) }),
  url: (v) => ({ url: /^https?:\/\//i.test(textOf(v).trim()) ? textOf(v).trim().slice(0, 2000) : null }),
  date: (v) => {
    if (!v) return { date: null };
    const d = v instanceof Date ? v : new Date(v);
    return { date: Number.isNaN(d.getTime()) ? null : { start: d.toISOString() } };
  },
};

const plainOf = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text ?? t.text?.content ?? "").join("");
const compact = (id) => String(id || "").replace(/-/g, "").toLowerCase();

function httpStatusOf(err) {
  if (Number.isInteger(err?.status)) return err.status;
  const m = /→ (\d{3}):/.exec(err?.message || "");
  return m ? Number(m[1]) : null;
}

/** 致命 = 继续逐行打只会放大：401/403（凭据失效）、429 限流、5xx、无状态（网络断/超时） */
function isFatalNotionError(err) {
  const s = httpStatusOf(err);
  return s === null || s === 401 || s === 403 || s === 429 || s >= 500;
}

/** 完整列 = spec 列 + 源ID + 同步指纹 */
function fullProperties(spec) {
  return { ...spec.properties, [ID_PROP]: { rich_text: {} }, [DIGEST_PROP]: { rich_text: {} } };
}

/**
 * 缺库才建：父页下同名 child_database → 校验来源标记 → 补缺列；没有就新建（带标记）。
 * 同名多库 / 标记不符一律抛错拒绝认领。返回库 id。
 */
async function ensureDatabase(notionReq, { parentPageId, spec }) {
  if (!parentPageId) throw new Error("ensureDatabase: parentPageId 必填");
  const found = [];
  let cursor = null;
  do {
    const page = await notionReq(`/blocks/${parentPageId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`, "GET");
    for (const b of page.results || []) if (b.type === "child_database" && b.child_database?.title === spec.title) found.push(b.id);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  const wanted = fullProperties(spec);
  if (found.length === 0) {
    const created = await notionReq("/databases", "POST", {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: spec.title } }],
      description: [{ type: "text", text: { content: spec.marker } }],
      properties: wanted,
    });
    return created.id;
  }
  if (found.length > 1) throw new Error(`${spec.title} 在父页下重复 ${found.length} 个，拒绝认领`);
  const db = await notionReq(`/databases/${found[0]}`, "GET");
  const marker = plainOf({ rich_text: db.description || [] });
  if (db.archived || db.in_trash || marker !== spec.marker || (db.parent?.page_id && compact(db.parent.page_id) !== compact(parentPageId))) {
    throw new Error(`${spec.title} 库来源标记不符（库描述「${marker}」），拒绝认领`);
  }
  const missing = Object.fromEntries(Object.entries(wanted).filter(([k]) => db.properties?.[k] === undefined && !wanted[k].title));
  if (Object.keys(missing).length) await notionReq(`/databases/${found[0]}`, "PATCH", { properties: missing });
  return found[0];
}

/** 库内现存（未归档）页按源ID聚合：Map(源ID → [{ pageId, digest }])，跟完分页 */
async function loadPageIndex(notionReq, dbId) {
  const index = new Map();
  let cursor = null;
  do {
    const res = await notionReq(`/databases/${dbId}/query`, "POST", { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const p of res.results || []) {
      const sid = plainOf(p.properties?.[ID_PROP]);
      if (!sid) continue;
      if (!index.has(sid)) index.set(sid, []);
      index.get(sid).push({ pageId: p.id, digest: plainOf(p.properties?.[DIGEST_PROP]) });
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return index;
}

/**
 * 一张表同步一轮。返回统计：
 * { key, db_id, source_rows, notion_rows, created, patched, skipped, archived_duplicates, archived_orphans, failed, fatal, errors[] }
 */
async function syncMirror({ pool, notionReq, parentPageId, spec, log = () => {} }) {
  const stat = { key: spec.key, db_id: null, source_rows: 0, notion_rows: 0, created: 0, patched: 0, skipped: 0,
    archived_duplicates: 0, archived_orphans: 0, failed: 0, fatal: false, errors: [] };
  const fail = (err, what) => {
    stat.failed++;
    if (stat.errors.length < 5) stat.errors.push(`${what}: ${String(err?.message || err).slice(0, 200)}`);
    if (isFatalNotionError(err)) { stat.fatal = true; return true; }
    log(`[${spec.key}] ${what} 失败: ${err?.message || err}`);
    return false;
  };
  try {
    stat.db_id = await ensureDatabase(notionReq, { parentPageId, spec });
  } catch (err) { fail(err, "建库/认领"); stat.fatal = true; return stat; }

  const { rows } = await pool.query(spec.selectSql);
  stat.source_rows = rows.length;
  let index;
  try { index = await loadPageIndex(notionReq, stat.db_id); } catch (err) { fail(err, "读现存页"); stat.fatal = true; return stat; }
  let live = [...index.values()].reduce((n, list) => n + list.length, 0);

  const seen = new Set();
  for (const row of rows) {
    const sid = String(row.id);
    seen.add(sid);
    const base = spec.buildProps(row);
    const digest = propsDigest(base);
    const properties = { ...base, [ID_PROP]: P.text(sid), [DIGEST_PROP]: P.text(digest) };
    const existing = index.get(sid) || [];
    try {
      for (const extra of existing.slice(1)) {
        await notionReq(`/pages/${extra.pageId}`, "PATCH", { archived: true });
        stat.archived_duplicates++; live--;
      }
      if (existing.length === 0) {
        await notionReq("/pages", "POST", { parent: { database_id: stat.db_id }, properties });
        stat.created++; live++;
      } else if (existing[0].digest === digest) {
        stat.skipped++;
      } else {
        await notionReq(`/pages/${existing[0].pageId}`, "PATCH", { properties });
        stat.patched++;
      }
    } catch (err) {
      if (fail(err, `行 ${sid}`)) { stat.notion_rows = live; return stat; }
    }
  }

  if (rows.length > 0) {
    for (const [sid, list] of index) {
      if (seen.has(sid)) continue;
      for (const p of list) {
        try {
          await notionReq(`/pages/${p.pageId}`, "PATCH", { archived: true });
          stat.archived_orphans++; live--;
        } catch (err) {
          if (fail(err, `归档 ${sid}`)) { stat.notion_rows = live; return stat; }
        }
      }
    }
  }
  stat.notion_rows = live;
  return stat;
}

/**
 * 真实 Notion 请求：节流（默认 350ms/次，Notion 限 3 次/秒）+ 429/5xx/网络错退避重试（默认 3 次）。
 * 失败抛 Error（message 含「→ <状态码>:」，err.status 带状态码），不打印 token。
 */
function createNotionReq(token, { fetchImpl = globalThis.fetch, minIntervalMs = 350, maxRetries = 3, timeoutMs = 30000, sleep } = {}) {
  if (!token) throw new Error("createNotionReq: 缺 Notion token");
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = 0;
  return async function notionReq(path, method = "GET", body) {
    for (let attempt = 0; ; attempt++) {
      const gap = last + minIntervalMs - Date.now();
      if (gap > 0) await wait(gap);
      last = Date.now();
      let res;
      try {
        res = await fetchImpl(`https://api.notion.com/v1${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt < maxRetries) { await wait(1000 * 2 ** attempt); continue; }
        throw err;
      }
      if (res.ok) return res.json();
      const text = await res.text().catch(() => "");
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers?.get?.("retry-after"));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw Object.assign(new Error(`Notion ${method} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    }
  };
}

module.exports = {
  ID_PROP, DIGEST_PROP, P, propsDigest, isFatalNotionError, ensureDatabase, loadPageIndex, syncMirror, createNotionReq,
};
