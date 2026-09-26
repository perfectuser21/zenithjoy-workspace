// verify-step.test.mjs —— 棒3b：探针在执行机侧读回（决策 95e29afd）。
// runProbes 走依赖注入（假 pool / 假 fetch），CI 不装 pg；CLI 用 spawnSync 真进程验超时与 exit 0。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parametrize, runProbes } from "../verify-step.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const D = join(HERE, "..");
const VERIFY = join(D, "verify-step.mjs");
const { loadChecks } = require(join(D, "checks", "probes-lib.js"));
const YAML = join(D, "checks", "social-keyword-leadgen.yaml");
const SCHEMA = join(D, "checks", "schema.json");
const PARAMS = { runTag: "auto0926", lineKey: "jinuo", word: "AI训练师" };
const now = () => "2026-09-26T00:00:00.000Z";

// 假飞书：按 table id 给行；支持 has_more 分页（pages[tbl] = [[items...], [items...]]）
function fakeFetch(pages, log = []) {
  return async (url, opts = {}) => {
    log.push({ url, method: opts.method || "GET", headers: opts.headers || {} });
    if (url.includes("/auth/v3/tenant_access_token/internal")) return { json: async () => ({ code: 0, tenant_access_token: "tok-test" }) };
    const tbl = /tables\/(tbl[A-Za-z0-9]+)\/records/.exec(url)[1];
    const list = pages[tbl] || [[]];
    const pt = /page_token=(\d+)/.exec(url);
    const idx = pt ? Number(pt[1]) : 0;
    const items = list[idx] || [];
    const more = idx + 1 < list.length;
    return { json: async () => ({ code: 0, data: { items, has_more: more, page_token: more ? String(idx + 1) : "" } }) };
  };
}
const row = (fields) => ({ fields });
const T = (s) => [{ text: s }]; // 飞书文本字段形状

function fakePool(handler) { const calls = []; return { calls, query: async (text, values) => { calls.push({ text, values }); return handler(text, values); } }; }
const deps = (pool, fetch) => ({ pool, fetch, feishuCreds: () => ({ appId: "id", appSecret: "sec" }), now });

test("parametrize: 带引号占位符→$n，按出现顺序编号，重复占位符复用同一号", () => {
  const q = "SELECT count(*) FROM t WHERE a = '$RUN_TAG' AND b = '$LINE_KEY' AND c = '$RUN_TAG' AND d = $WORD";
  const r = parametrize(q, PARAMS);
  assert.equal(r.text, "SELECT count(*) FROM t WHERE a = $1 AND b = $2 AND c = $1 AND d = $3");
  assert.deepEqual(r.values, ["auto0926", "jinuo", "AI训练师"]);
  assert.ok(!r.text.includes("auto0926"), "值不得拼进 SQL 文本");
});

test("runProbes delivery: 真 YAML 三条（sql count / http count / sql not_null_all）observed 形状", async () => {
  const { doc, errors } = loadChecks(YAML, SCHEMA);
  assert.deepEqual(errors, []);
  const pool = fakePool((text) => (text.includes("count(*)")
    ? { rows: [{ count: "2" }], fields: [{ name: "count" }] }
    : { rows: [{ line_key: "jinuo" }, { line_key: null }], fields: [{ name: "line_key" }] }));
  const fetch = fakeFetch({ tblmrJTyVgzTj89P: [[row({ 运行批次: T("auto0926") }), row({ 运行批次: T("other") }), row({ 运行批次: T("auto0926") })]] });
  const r = await runProbes({ doc, stage: "delivery", params: PARAMS, deps: deps(pool, fetch) });
  assert.equal(r.stage, "delivery");
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.deepEqual(Object.keys(by).sort(), ["comments_readback", "line_key_not_null", "videos_readback"]);
  assert.deepEqual(by.videos_readback, { key: "videos_readback", observed: 2, probed_at: now() });
  assert.deepEqual(by.comments_readback, { key: "comments_readback", observed: 2, probed_at: now() });
  assert.deepEqual(by.line_key_not_null.observed, ["jinuo", null]);
  for (const p of r.probes) assert.ok(!("error" in p), `${p.key} 不该带 error`);
  // sql 全部参数化：values 里有 tag/line，text 里没有
  for (const c of pool.calls) { assert.ok(c.values.includes("auto0926")); assert.ok(!c.text.includes("auto0926")); assert.match(c.text, /\$1/); }
});

test("runProbes scoring: http count 双列 filter（布尔/文本）+ field 求和 minus 子查询", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const fetch = fakeFetch({
    tblmrJTyVgzTj89P: [[
      row({ 运行批次: T("auto0926"), 处理状态: "待分拣", 命中关键词: T("AI训练师"), 进入最终线索: true }),
      row({ 运行批次: T("auto0926"), 处理状态: "已分拣", 命中关键词: T("AI训练师"), 进入最终线索: true }),
      row({ 运行批次: T("auto0926"), 处理状态: "待分拣", 命中关键词: T("别的词"), 进入最终线索: false }),
    ]],
    tbleP4LgzkcwAhiZ: [[row({ "抖音获客-关键词配置": T("AI训练师"), 有效线索数: 5 }), row({ "抖音获客-关键词配置": T("别的词"), 有效线索数: 9 })]],
  });
  const r = await runProbes({ doc, stage: "scoring", params: PARAMS, deps: deps(fakePool(() => { throw new Error("no sql here"); }), fetch) });
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.equal(by.pool_advanced.observed, 2, "运行批次=auto0926 且 处理状态=待分拣");
  assert.equal(by.effective_count.observed, 5 - 2, "关键词表 有效线索数(5) − 池内 命中关键词=词 且 进入最终线索=true(2)");
});

test("runProbes: 飞书分页 has_more 两页全量计数，且带 Bearer token", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const log = [];
  const fetch = fakeFetch({ tblmrJTyVgzTj89P: [[row({ 运行批次: T("auto0926") })], [row({ 运行批次: T("auto0926") }), row({ 运行批次: T("x") })]] }, log);
  const pool = fakePool(() => ({ rows: [{ count: "0" }], fields: [{ name: "count" }] }));
  const r = await runProbes({ doc, stage: "delivery", params: PARAMS, deps: deps(pool, fetch) });
  assert.equal(r.probes.find((p) => p.key === "comments_readback").observed, 2);
  const recs = log.filter((l) => l.url.includes("/records"));
  assert.equal(recs.length, 2, "两页两次");
  assert.match(recs[1].url, /page_token=1/);
  assert.equal(recs[0].headers.Authorization, "Bearer tok-test");
});

test("runProbes: 单条失败 fail-open——该条带 error，其余照常", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const pool = fakePool(() => { throw new Error("ECONNREFUSED 127.0.0.1:5432"); });
  const fetch = fakeFetch({ tblmrJTyVgzTj89P: [[row({ 运行批次: T("auto0926") })]] });
  const r = await runProbes({ doc, stage: "delivery", params: PARAMS, deps: deps(pool, fetch) });
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.equal(r.probes.length, 3);
  assert.match(by.videos_readback.error, /ECONNREFUSED/); assert.ok(!("observed" in by.videos_readback));
  assert.match(by.line_key_not_null.error, /ECONNREFUSED/);
  assert.equal(by.comments_readback.observed, 1);
});

test("runProbes: 整体超时→已得部分照出，未完成条目 error=timeout", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const pool = fakePool(() => new Promise(() => {})); // 永不 resolve
  const fetch = fakeFetch({ tblmrJTyVgzTj89P: [[row({ 运行批次: T("auto0926") })]] });
  const t0 = Date.now();
  const r = await runProbes({ doc, stage: "delivery", params: PARAMS, deps: deps(pool, fetch), timeoutMs: 200 });
  assert.ok(Date.now() - t0 < 3000);
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.equal(by.comments_readback.observed, 1);
  assert.equal(by.videos_readback.error, "timeout"); assert.equal(by.line_key_not_null.error, "timeout");
  assert.equal(typeof by.videos_readback.probed_at, "string");
});

test("runProbes: stage 无探针 → probes 空数组", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const r = await runProbes({ doc, stage: "discovery", params: PARAMS, deps: deps(fakePool(() => { throw new Error("x"); }), fakeFetch({})) });
  assert.deepEqual(r, { stage: "discovery", probes: [] });
});

// ── CLI：真进程 ──
function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [VERIFY, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 20000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test("CLI: --deps 注入永不返回的 pool + --timeout-ms 300 → 一行 JSON、timeout 条目、exit 0、不挂死", () => {
  const d = mkdtempSync(join(tmpdir(), "vs-"));
  const depsFile = join(d, "deps.mjs");
  writeFileSync(depsFile, `export default { pool: { query: () => new Promise(() => {}) }, fetch: async () => ({ json: async () => ({ code: 0, tenant_access_token: "t", data: { items: [], has_more: false } }) }), feishuCreds: () => ({ appId: "a", appSecret: "b" }) };\n`);
  const t0 = Date.now();
  const r = cli(["--stage", "delivery", "--run-tag", "auto0926", "--line-key", "jinuo", "--timeout-ms", "300", "--deps", pathToFileURL(depsFile).href]);
  assert.equal(r.status, 0, r.err);
  assert.ok(Date.now() - t0 < 10000, "超时后必须自己退出");
  const lines = r.out.trim().split("\n");
  assert.equal(lines.length, 1, `stdout 应恰一行: ${r.out}`);
  const j = JSON.parse(lines[0]);
  assert.equal(j.stage, "delivery");
  const by = Object.fromEntries(j.probes.map((p) => [p.key, p]));
  assert.equal(by.videos_readback.error, "timeout"); assert.equal(by.comments_readback.observed, 0);
});

test("CLI: 缺 --stage / YAML 不存在 → 仍 exit 0 且 stdout 一行 {stage, probes:[]}", () => {
  const a = cli([]);
  assert.equal(a.status, 0); assert.deepEqual(JSON.parse(a.out.trim()), { stage: "", probes: [] });
  const b = cli(["--stage", "delivery", "--run-tag", "x", "--line-key", "jinuo", "--checks", "/nonexistent.yaml"]);
  assert.equal(b.status, 0); assert.deepEqual(JSON.parse(b.out.trim()), { stage: "delivery", probes: [] }); assert.match(b.err, /verify-step/);
});

test("CLI: 飞书凭据缺失（无 env、CLAWDBOT_JSON 指向不存在）→ http 条目带 error，sql 条目由假 pool 正常", () => {
  const d = mkdtempSync(join(tmpdir(), "vs-"));
  const depsFile = join(d, "deps.mjs");
  writeFileSync(depsFile, `export default { pool: { query: async () => ({ rows: [{ count: "7" }], fields: [{ name: "count" }] }) } };\n`);
  const r = cli(["--stage", "delivery", "--run-tag", "auto0926", "--line-key", "jinuo", "--deps", pathToFileURL(depsFile).href],
    { FEISHU_APP_ID: "", FEISHU_APP_SECRET: "", CLAWDBOT_JSON: join(d, "none.json") });
  assert.equal(r.status, 0, r.err);
  const by = Object.fromEntries(JSON.parse(r.out.trim()).probes.map((p) => [p.key, p]));
  assert.equal(by.videos_readback.observed, 7);
  assert.match(by.comments_readback.error, /clawdbot|ENOENT|凭据/);
});
