#!/usr/bin/env node
// verify-step.mjs —— 探针在执行机侧读回（棒3b，决策 95e29afd：执行机只读回，Brain business-probe-judge 只判定）。
//
// 用法（workflow-result.sh stage 钩子在 POST Brain 前调用）：
//   node verify-step.mjs --stage delivery --run-tag auto0926 --line-key jinoshengyuan-work [--word W]
//        [--checks checks/social-keyword-leadgen.yaml] [--metrics-json f] [--timeout-ms 60000] [--deps <mjs url>]
// stdout 恰好一行 JSON：{"stage","probes":[{key, observed, probed_at} | {key, probed_at, error}]}；永远 exit 0。
//
// 约定（checks/social-keyword-leadgen.yaml 头注释）：
//   sql  → leadgen-db-connect.js getPool()；占位符 '$RUN_TAG'/'$LINE_KEY'/'$WORD' 一律替换成 $1/$2 参数化，禁止拼接；
//          单行单列 → 该值（数值化）；多行 → 逐行首列数组（not_null_all 用）。
//   http → 飞书 Bitable：凭据 env FEISHU_APP_ID/FEISHU_APP_SECRET 优先，否则 CLAWDBOT_JSON（默认 ~/.openclaw/clawdbot.json）
//          的 channels.feishu.accounts[routeOf(lineKey).account]（同 push-raw-comments.js:6-16）；page_size=500 分页拉全；
//          filter 每列全等（文本字段经 txt() 归一，布尔直接比）；reduce count | field:<列>（求和）；minus 同形子查询取差。
// 单条失败 fail-open（该条带 error 继续其余）；整体超时把已得部分输出、未完成的标 error:"timeout"。
// --deps 只给测试注入 {pool, fetch, feishuCreds, now}，生产不传。
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER_PARAM = { RUN_TAG: "runTag", LINE_KEY: "lineKey", WORD: "word" };
const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const PAGE_SIZE = 500;

export function parametrize(query, params) {
  const values = [];
  const index = new Map();
  const text = query.replace(/'?\$(RUN_TAG|LINE_KEY|WORD)'?/g, (_, name) => {
    if (!index.has(name)) {
      values.push(params[PLACEHOLDER_PARAM[name]] ?? null);
      index.set(name, values.length);
    }
    return `$${index.get(name)}`;
  });
  return { text, values };
}

function substitute(v, params) {
  return typeof v === "string" ? v.replace(/\$(RUN_TAG|LINE_KEY|WORD)/g, (_, n) => params[PLACEHOLDER_PARAM[n]] ?? "") : v;
}

// 同 keyword-stats-lib.js:70——飞书文本字段是 [{text}] 数组，单选是 {name} 或字符串
const txt = (v) => (Array.isArray(v) ? v.map((x) => x.text || x.name || x).join("") : (v && v.text) || (v && v.name) || String(v == null ? "" : v));
const num = (v) => { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) ? n : v; };

function fieldEq(actual, want) {
  if (typeof want === "boolean") return actual === want;
  if (typeof want === "number") return Number(txt(actual)) === want;
  return txt(actual) === String(want);
}

async function runSql(probe, params, deps) {
  const pool = deps.pool || require("./leadgen-db-connect.js").getPool();
  const { text, values } = parametrize(probe.query, params);
  const res = await pool.query(text, values);
  const rows = res.rows || [];
  const col = res.fields?.[0]?.name ?? (rows[0] ? Object.keys(rows[0])[0] : undefined);
  const first = (r) => (col !== undefined && col in r ? r[col] : Object.values(r)[0]);
  if (rows.length === 1 && Object.keys(rows[0]).length === 1) return num(first(rows[0]));
  return rows.map(first);
}

export function loadFeishuCreds(lineKey) {
  if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) return { appId: process.env.FEISHU_APP_ID, appSecret: process.env.FEISHU_APP_SECRET };
  const { routeOf } = require("./line-routes.js");
  const route = routeOf(lineKey);
  const cfgPath = process.env.CLAWDBOT_JSON || join(homedir(), ".openclaw", "clawdbot.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const acc = cfg?.channels?.feishu?.accounts?.[route.account];
  if (!acc?.appId || !acc?.appSecret) throw new Error(`飞书凭据缺失: ${cfgPath} 无 accounts.${route.account}`);
  return { appId: acc.appId, appSecret: acc.appSecret };
}

function tokenGetter(params, deps) {
  let cached = null;
  return async () => {
    if (cached) return cached;
    const creds = (deps.feishuCreds || loadFeishuCreds)(params.lineKey);
    const r = await deps.fetch(FEISHU_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }) });
    const j = await r.json();
    if (!j.tenant_access_token) throw new Error(`飞书 token 失败: ${j.code} ${j.msg || ""}`);
    cached = j.tenant_access_token;
    return cached;
  };
}

async function fetchAllRecords(url, headers, fetchFn) {
  const items = [];
  let pageToken = "";
  do {
    const u = `${url}${url.includes("?") ? "&" : "?"}page_size=${PAGE_SIZE}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
    const j = await (await fetchFn(u, { headers })).json();
    if (j.code !== undefined && j.code !== 0) throw new Error(`飞书 ${j.code}: ${j.msg || ""}`);
    items.push(...(j.data?.items || []));
    pageToken = j.data?.has_more ? j.data.page_token : "";
  } while (pageToken);
  return items;
}

async function readSource(src, params, headers, fetchFn) {
  const items = await fetchAllRecords(src.url, headers, fetchFn);
  const filter = Object.entries(src.filter || {});
  const rows = items.filter((it) => filter.every(([k, want]) => fieldEq((it.fields || {})[k], substitute(want, params))));
  if (src.reduce === "count") return rows.length;
  const col = src.reduce.slice("field:".length);
  return rows.reduce((sum, r) => sum + (Number(txt((r.fields || {})[col])) || 0), 0);
}

async function runHttp(probe, params, deps, getToken) {
  const headers = { Authorization: `Bearer ${await getToken()}` };
  const main = await readSource(probe, params, headers, deps.fetch);
  if (!probe.minus) return main;
  return main - (await readSource(probe.minus, params, headers, deps.fetch));
}

export async function runProbes({ doc, stage, params, deps = {}, timeoutMs = 60000 }) {
  const now = deps.now || (() => new Date().toISOString());
  const fetchFn = deps.fetch || globalThis.fetch;
  const d = { ...deps, fetch: fetchFn };
  const getToken = tokenGetter(params, d);
  const specs = (doc?.probes || []).filter((p) => p.stage === stage);
  const results = specs.map((p) => ({ key: p.key, error: "timeout" }));
  const jobs = specs.map(async (p, i) => {
    try {
      const observed = p.probe.type === "sql" ? await runSql(p.probe, params, d) : await runHttp(p.probe, params, d, getToken);
      results[i] = { key: p.key, observed, probed_at: now() };
    } catch (e) {
      results[i] = { key: p.key, probed_at: now(), error: String((e && e.message) || e).slice(0, 300) };
    }
  });
  let timer;
  await Promise.race([Promise.all(jobs), new Promise((res) => { timer = setTimeout(res, timeoutMs); })]);
  clearTimeout(timer);
  return { stage, probes: results.map((r) => (r.probed_at ? r : { ...r, probed_at: now() })) };
}

// resolveLineKey: --line-key 拿到的是 profile 名（workflow-result.sh 传 WFR_PROFILE=jinoshengyuan-work），而 PG
// leadgen_videos.line_key 存的是路由键 jinuo（push-videos.js:57 ROUTE.key）——$LINE_KEY 替换前先经 routeOf().key 归一；
// 认不出（routeOf 抛错）原样透传，让 SQL/飞书那一侧自己报 error，而不是在这里把整段探针吞掉。
export function resolveLineKey(raw, routeOf = require("./line-routes.js").routeOf) {
  const s = String(raw || "");
  if (!s) return s;
  try { return routeOf(s).key; } catch { return s; }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) { a[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : ""; }
  return a;
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`, () => process.exit(0));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const stage = a.stage || "";
  const warn = (m) => process.stderr.write(`verify-step: ${m}\n`);
  try {
    if (!stage) { warn("缺 --stage"); return emit({ stage, probes: [] }); }
    const yamlPath = a.checks || join(HERE, "checks", "social-keyword-leadgen.yaml");
    const { loadChecks } = require(join(HERE, "checks", "probes-lib.js"));
    const { doc, errors } = loadChecks(yamlPath, join(HERE, "checks", "schema.json"));
    if (errors.length) { warn(`探针文件校验失败 ${yamlPath}: ${errors.join("; ")}`); return emit({ stage, probes: [] }); }
    const deps = a.deps ? (await import(a.deps)).default : {};
    const params = { runTag: a["run-tag"] || "", lineKey: resolveLineKey(a["line-key"]), word: a.word || "" };
    const timeoutMs = Number(a["timeout-ms"]) > 0 ? Number(a["timeout-ms"]) : 60000;
    const out = await runProbes({ doc, stage, params, deps, timeoutMs });
    for (const p of out.probes) if (p.error) warn(`${p.key}: ${p.error}`);
    emit(out);
  } catch (e) {
    warn(String((e && e.stack) || e));
    emit({ stage, probes: [] });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
