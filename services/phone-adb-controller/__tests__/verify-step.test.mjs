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
  // 6b133a81：每条带 pass（按 expect 判）与失败语义；PARAMS 无 metrics → ref 型判不了 pass=null
  assert.deepEqual(by.videos_readback, { key: "videos_readback", observed: 2, probed_at: now(), pass: null, failure_class: "needs_human", on_fail: "stop_run" });
  assert.deepEqual(by.comments_readback, { key: "comments_readback", observed: 2, probed_at: now(), pass: null, failure_class: "needs_human", on_fail: "stop_run" });
  assert.equal(by.line_key_not_null.pass, false, "有 null 行即不过");
  assert.deepEqual(by.line_key_not_null.observed, ["jinuo", null]);
  for (const p of r.probes) assert.ok(!("error" in p), `${p.key} 不该带 error`);
  // sql 全部参数化：values 里有 tag/line，text 里没有
  for (const c of pool.calls) { assert.ok(c.values.includes("auto0926")); assert.ok(!c.text.includes("auto0926")); assert.match(c.text, /\$1/); }
});

test("runProbes scoring: http count 双列 filter（文本/单选）；scoring 只剩 pool_advanced（effective_count 已删）", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const fetch = fakeFetch({
    tblmrJTyVgzTj89P: [[
      row({ 运行批次: T("auto0926"), 处理状态: "待分拣", 命中关键词: T("AI训练师"), 进入最终线索: true }),
      row({ 运行批次: T("auto0926"), 处理状态: "已分拣", 命中关键词: T("AI训练师"), 进入最终线索: true }),
      row({ 运行批次: T("auto0926"), 处理状态: "待分拣", 命中关键词: T("别的词"), 进入最终线索: false }),
    ]],
  });
  const r = await runProbes({ doc, stage: "scoring", params: PARAMS, deps: deps(fakePool(() => { throw new Error("no sql here"); }), fetch) });
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.deepEqual(Object.keys(by), ["pool_advanced"]);
  assert.equal(by.pool_advanced.observed, 2, "运行批次=auto0926 且 处理状态=待分拣");
});

// ── 业务线无关化：http 探针 url 里的 $BASE/$POOL/$KEYWORD/$LEAD 按 routeOf(lineKey) 展开 ──
const { ROUTES } = require(join(D, "line-routes.js"));
const JN = ROUTES.find((r) => r.key === "jinuo"), YS = ROUTES.find((r) => r.key === "yuesheng");
const recUrl = (base, tbl) => `https://open.feishu.cn/open-apis/bitable/v1/apps/${base}/tables/${tbl}/records`;

test("runProbes http: $BASE/$POOL 按业务线展开——jinuo 读金诺 base+池，yuesheng 读悦升 base+池（各自的表 id 回各自的数据）", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  for (const [route, want] of [[JN, 2], [YS, 1]]) {
    const log = [];
    const fetch = fakeFetch({
      [JN.pool]: [[row({ 运行批次: T("auto0926") }), row({ 运行批次: T("auto0926") })]],
      [YS.pool]: [[row({ 运行批次: T("auto0926") })]],
    }, log);
    const pool = fakePool(() => ({ rows: [{ count: "0" }], fields: [{ name: "count" }] }));
    const r = await runProbes({ doc, stage: "delivery", params: { ...PARAMS, lineKey: route.key }, deps: deps(pool, fetch) });
    assert.equal(r.probes.find((p) => p.key === "comments_readback").observed, want, `${route.key} 应读自己的池`);
    const recs = log.filter((l) => l.url.includes("/records")).map((l) => l.url);
    assert.ok(recs.length >= 1 && recs.every((u) => u.startsWith(recUrl(route.base, route.pool))), `${route.key} 只该请求 ${route.base}/${route.pool}：${recs}`);
    assert.ok(recs.every((u) => !u.includes("$")), `占位符必须已展开：${recs}`);
  }
});

test("runProbes http: scoring 的 pool_advanced 同样按业务线展开（悦升不读金诺的池）", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const log = [];
  const fetch = fakeFetch({
    [JN.pool]: [[row({ 运行批次: T("auto0926"), 处理状态: "待分拣" }), row({ 运行批次: T("auto0926"), 处理状态: "待分拣" })]],
    [YS.pool]: [[row({ 运行批次: T("auto0926"), 处理状态: "已分拣" })]],
  }, log);
  const r = await runProbes({ doc, stage: "scoring", params: { ...PARAMS, lineKey: "yuesheng" }, deps: deps(fakePool(() => { throw new Error("x"); }), fetch) });
  assert.equal(r.probes[0].observed, 0, "悦升池里没有待分拣");
  assert.ok(log.filter((l) => l.url.includes("/records")).every((l) => l.url.startsWith(recUrl(YS.base, YS.pool))));
});

test("runProbes http: $KEYWORD/$LEAD 与 minus 子查询同样展开", async () => {
  const doc = { probes: [{
    key: "synthetic", stage: "scoring",
    probe: {
      type: "http", target: "feishu_yuesheng", url: "https://open.feishu.cn/open-apis/bitable/v1/apps/$BASE/tables/$KEYWORD/records",
      filter: { k: "v" }, reduce: "field:n",
      minus: { url: "https://open.feishu.cn/open-apis/bitable/v1/apps/$BASE/tables/$LEAD/records", filter: { k: "v" }, reduce: "count" },
    },
    expect: { op: "==", value: 0 },
  }] };
  const log = [];
  const fetch = fakeFetch({ [YS.keyword]: [[row({ k: T("v"), n: 5 })]], [YS.lead]: [[row({ k: T("v") }), row({ k: T("v") })]] }, log);
  const r = await runProbes({ doc, stage: "scoring", params: { ...PARAMS, lineKey: "yuesheng" }, deps: deps(fakePool(() => { throw new Error("x"); }), fetch) });
  assert.equal(r.probes[0].observed, 5 - 2);
  const recs = log.filter((l) => l.url.includes("/records")).map((l) => l.url.split("?")[0]);
  assert.deepEqual(recs, [recUrl(YS.base, YS.keyword), recUrl(YS.base, YS.lead)]);
});

test("runProbes http: 认不出业务线（routeOf 抛错）→ http 条目带 error（fail-open），sql 条目照常，不请求飞书", async () => {
  const { doc } = loadChecks(YAML, SCHEMA);
  const log = [];
  const pool = fakePool((text) => (text.includes("count(*)") ? { rows: [{ count: "3" }], fields: [{ name: "count" }] } : { rows: [{ line_key: "x" }], fields: [{ name: "line_key" }] }));
  const r = await runProbes({ doc, stage: "delivery", params: { ...PARAMS, lineKey: "xiaolongxia" }, deps: deps(pool, fakeFetch({}, log)) });
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.match(by.comments_readback.error, /未配路由/); assert.ok(!("observed" in by.comments_readback));
  assert.equal(by.videos_readback.observed, 3, "sql 探针不受影响");
  assert.equal(log.filter((l) => l.url.includes("/records")).length, 0, "不该带着未展开的 url 去请求飞书");
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
  // 真 YAML 8 个 stage 都有探针（决策 f18f56b8），这里用只含 delivery 的夹具验空分支
  const { doc } = loadChecks(YAML, SCHEMA);
  const only = { ...doc, probes: doc.probes.filter((p) => p.stage === "delivery") };
  const r = await runProbes({ doc: only, stage: "discovery", params: PARAMS, deps: deps(fakePool(() => { throw new Error("x"); }), fakeFetch({})) });
  assert.deepEqual(r, { stage: "discovery", probes: [], gate: { verdict: "none", action: "continue", failed: [], unknown: [], alert: false } });
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
  const NONE = { verdict: "none", action: "continue", failed: [], unknown: [], alert: false };
  assert.equal(a.status, 0); assert.deepEqual(JSON.parse(a.out.trim()), { stage: "", probes: [], gate: NONE });
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

// metric 探针（决策 f18f56b8）：preflight/cleanup 只有账本指标可判，observed 取 stage 工件的 metrics[键]
test("runProbes metric: observed 取 params.metrics[键]；缺键 → 该条 error，不影响其余", async () => {
  const doc = { probes: [
    { key: "pf_account_verified", stage: "preflight", probe: { type: "metric", ref: "metrics.account_verified" }, expect: { op: "==", value: 1 } },
    { key: "pf_lock_acquired", stage: "preflight", probe: { type: "metric", ref: "metrics.lock_acquired" }, expect: { op: "==", value: 1 } },
  ] };
  const r = await runProbes({ doc, stage: "preflight", params: { ...PARAMS, metrics: { account_verified: 0 } }, deps: deps(fakePool(() => ({ rows: [] })), fakeFetch({})) });
  const by = Object.fromEntries(r.probes.map((p) => [p.key, p]));
  assert.deepEqual(by.pf_account_verified, { key: "pf_account_verified", observed: 0, probed_at: now(), pass: false, failure_class: undefined, on_fail: undefined });
  assert.match(by.pf_lock_acquired.error, /lock_acquired/);
});

test("CLI: --metrics-json 接 stage 工件文件（取 .metrics）喂 metric 探针", () => {
  const dir = mkdtempSync(join(tmpdir(), "vs-metric-"));
  const art = join(dir, "a.json");
  writeFileSync(art, JSON.stringify({ stage_id: "cleanup", metrics: { close_app_attempts: 1, lock_released: 1, safe_desktop_visible: 0 } }));
  const r = spawnSync(process.execPath, [VERIFY, "--stage", "cleanup", "--run-tag", "t", "--line-key", "jinuo", "--metrics-json", art], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const by = Object.fromEntries(JSON.parse(r.stdout.trim().split("\n").pop()).probes.map((p) => [p.key, p]));
  assert.equal(by.cl_lock_released.observed, 1);
  assert.equal(by.cl_safe_desktop_visible.observed, 0);
});
