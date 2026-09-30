// checks-social-keyword-leadgen.test.mjs —— 声明式探针文件守卫（决策 702949b6 / e2cef2c9）
//
// 探针文件 checks/social-keyword-leadgen.yaml 是 Brain step_probes 的 SSOT（cecelia 仓
// scripts/sync-step-probes.mjs 按哈希登记）。这份测试卡的是"文件形状不能漂"：
//   - stage = 契约 8 个主干活动（设计顺序，决策 f18f56b8）= workflow-result.sh 的 7 个账本 stage + outreach（触达不走账本）
//   - 全部 severity=error（决策 f18f56b8：每个活动后置条件一律拦截，不设 warn）
//   - expect.ref 只能引 workflow-result.sh req_keys()/COMMON 的闭集键（运行时从脚本抽，不抄）
//   - op / severity 枚举、key 唯一、journey_cell 与 stage 一致
// CI openclaw-scripts-test 是"纯 node --test 不装依赖"，所以解析器/校验器都是仓内零依赖实现。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CHECKS = path.join(ROOT, "checks");
const YAML_PATH = path.join(CHECKS, "social-keyword-leadgen.yaml");
const SCHEMA_PATH = path.join(CHECKS, "schema.json");
const WFR_PATH = path.join(ROOT, "workflow-result.sh");

const lib = require(path.join(CHECKS, "probes-lib.js"));
const { parseYaml, validateSchema, loadChecks, extractMetricKeys, STAGES } = lib;

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const wfrText = fs.readFileSync(WFR_PATH, "utf8");

test("闭集键从 workflow-result.sh 抽出：含 delivery 五键（含 videos_pushed）与 COMMON 四键", () => {
  const keys = extractMetricKeys(wfrText);
  for (const k of ["leads_written", "videos_pushed", "duplicates_skipped", "readback_verified", "cursor_updates",
                   "videos_processed", "comments_collected", "external_interactions", "business_writes"]) {
    assert.ok(keys.has(k), `缺闭集键 ${k}`);
  }
  assert.ok(!keys.has("leads_writt"), "不该有截断的假键");
});

const DESIGN_ORDER = ["preflight", "discovery", "qualification", "collection", "scoring", "delivery", "outreach", "cleanup"];
const reqStages = () => [...wfrText.matchAll(/^\s+(\w+)\) echo "[a-z_ ]+";;$/gm)].map((m) => m[1]);
function reqKeysOf(stage) {
  const m = new RegExp(`^\\s+${stage}\\) echo "([a-z_ ]+)";;$`, "m").exec(wfrText);
  return m ? m[1].split(/\s+/) : [];
}

test("STAGES = 契约 8 活动设计顺序；账本 req_keys 8 个 stage 同序（6b133a81 起触达进账本）", () => {
  assert.deepEqual([...STAGES], DESIGN_ORDER);
  assert.deepEqual(reqStages(), DESIGN_ORDER);
});

test("8 个活动每个都至少挂 1 条探针（缺探针=后置条件无判定）", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  for (const s of STAGES) assert.ok(doc.probes.some((p) => p.stage === s), `stage ${s} 没有探针`);
});

// 0930 决策 f425e3fd：归位一次做对率进探针——collection 工件 metrics.rescan_rate（兜底重搜/打开作品数）超 0.3 判红。
// severity 按 schema 只能 error（f18f56b8）；on_fail=fail_stage 只判该词 collection 失败，不停跑。
test("coll_rescan_rate：collection 上的 metric 探针，ref metrics.rescan_rate <= 0.3，rescan_rate 在 collection 闭集里", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const p = doc.probes.find((x) => x.key === "coll_rescan_rate");
  assert.ok(p, "缺 coll_rescan_rate 探针");
  assert.equal(p.stage, "collection");
  assert.deepEqual(p.probe, { type: "metric", ref: "metrics.rescan_rate" });
  assert.deepEqual(p.expect, { op: "<=", value: 0.3 });
  assert.equal(p.on_fail, "fail_stage");
  assert.ok(reqKeysOf("collection").includes("rescan_rate") && reqKeysOf("collection").includes("rescan_count"), "collection 闭集缺 rescan_count/rescan_rate");
});

test("metric 探针：ref 只能引本 stage 的 req_keys 闭集键", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const metric = doc.probes.filter((p) => p.probe.type === "metric");
  assert.ok(metric.length >= 1, "至少一条 metric 探针（preflight/cleanup 只有账本指标可判）");
  for (const p of metric) {
    const k = /^metrics\.([a-z_]+)$/.exec(p.probe.ref)[1];
    assert.ok(reqKeysOf(p.stage).includes(k), `${p.key} 引了非本 stage 的键 ${k}`);
    assert.ok("value" in p.expect, `${p.key} metric 探针必须对常量断言`);
  }
});

test("YAML 子集解析器：块映射/块序列/块标量/引号/数字", () => {
  const doc = parseYaml([
    "version: 1",
    "name: \"a: b\"",
    "items:",
    "  - key: x",
    "    n: 2.5",
    "    ok: true",
    "    q: |",
    "      SELECT 1",
    "      FROM t",
    "    nested:",
    "      op: \">=\"",
    "  - key: y",
    "    nil: null",
  ].join("\n"));
  assert.deepEqual(doc, {
    version: 1, name: "a: b",
    items: [
      { key: "x", n: 2.5, ok: true, q: "SELECT 1\nFROM t\n", nested: { op: ">=" } },
      { key: "y", nil: null },
    ],
  });
});

test("探针文件通过 schema.json（形状守卫）", () => {
  const { doc, errors } = loadChecks(YAML_PATH, SCHEMA_PATH);
  assert.deepEqual(errors, []);
  assert.equal(doc.version, 1);
  assert.equal(doc.workflow, "social-keyword-leadgen");
  assert.ok(Array.isArray(doc.probes) && doc.probes.length >= 5, "首发至少 5 条探针");
});

test("运行时接线的四条探针键齐全且落在 delivery / scoring；effective_count 已删（批级评分无法按词判）", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const byKey = Object.fromEntries(doc.probes.map((p) => [p.key, p]));
  for (const k of ["videos_readback", "comments_readback", "line_key_not_null"]) {
    assert.equal(byKey[k] && byKey[k].stage, "delivery", `${k} 应在 delivery`);
  }
  assert.equal(byKey.pool_advanced && byKey.pool_advanced.stage, "scoring", "pool_advanced 应在 scoring");
  assert.ok(!("effective_count" in byKey), "effective_count 用 $WORD，评分是批级的，评估时 $WORD 为空，无意义 → 已删");
  assert.ok(!doc.probes.some((p) => p.stage === "scoring" && JSON.stringify(p.probe).includes("$WORD")), "scoring 探针不得依赖 $WORD");
});

test("videos_readback 对账基准 = metrics.videos_pushed（delivery 工件真有的键；videos_processed 只在 collection 工件里，delivery 上 ref_unresolved 恒败）", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const p = doc.probes.find((x) => x.key === "videos_readback");
  assert.equal(p.expect.ref, "metrics.videos_pushed");
  assert.ok(reqKeysOf("delivery").includes("videos_pushed"));
  assert.match(p.note, /PUSH_VIDEOS_STATS/);
  assert.doesNotMatch(p.note, /videos_processed 之和/);
  // 所有 delivery 探针的 expect.ref 必须是 delivery 自己的键，否则 Brain 判 ref_unresolved
  for (const q of doc.probes.filter((x) => x.stage === "delivery" && x.expect.ref)) {
    assert.ok(reqKeysOf("delivery").includes(q.expect.ref.slice("metrics.".length)), `${q.key} ref ${q.expect.ref} 不在 delivery 闭集`);
  }
});

test("comments_readback 对账基准 leads_written = push-raw-comments 本批实际落池数（PUSH_COMMENTS_STATS.created），note 说清不含历史去重掉的", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const p = doc.probes.find((x) => x.key === "comments_readback");
  assert.equal(p.expect.ref, "metrics.leads_written");
  assert.match(p.note, /PUSH_COMMENTS_STATS/);
  assert.match(p.note, /历史.*去重/);
});

test("运行时接线 stage（delivery/scoring）的 http 探针 url 用 $BASE/$POOL 占位，不得写死业务线的 base id（悦升批次会读错库）", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const wired = doc.probes.filter((p) => p.probe.type === "http" && (p.stage === "delivery" || p.stage === "scoring"));
  assert.ok(wired.length >= 2);
  for (const p of wired) {
    for (const u of [p.probe.url, p.probe.minus && p.probe.minus.url].filter(Boolean)) {
      assert.ok(!u.includes("GNuwbzY0da8GP0sv6MGcOTu9ntd") && !u.includes("H3OrbAH49aLNebs7XvOcpS1enec"), `${p.key} url 写死了 base: ${u}`);
    }
    assert.match(p.probe.url, /\/apps\/\$BASE\/tables\/\$POOL\/records/, `${p.key} 应为 $BASE/$POOL`);
  }
});

test("所有 http 探针（含尚未接线的 outreach）url 都不得写死业务线的 base/表 id，线索表用 $LEAD", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const https = doc.probes.filter((p) => p.probe.type === "http");
  assert.ok(https.some((p) => p.stage === "outreach"), "outreach 探针应存在");
  for (const p of https) {
    for (const u of [p.probe.url, p.probe.minus && p.probe.minus.url].filter(Boolean)) {
      assert.ok(!/\/apps\/(?!\$BASE)[A-Za-z0-9]+\//.test(u), `${p.key} url 写死了 base: ${u}`);
      assert.ok(!/\/tables\/tbl/.test(u), `${p.key} url 写死了表 id: ${u}`);
    }
  }
  const out = https.find((p) => p.key === "out_no_stuck_inflight");
  assert.match(out.probe.url, /\/apps\/\$BASE\/tables\/\$LEAD\/records/);
});

test("key 唯一、journey_cell == stage:<stage>、全部 error（拦截）、note 带 文件:行 依据", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const keys = doc.probes.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "key 重复");
  for (const p of doc.probes) {
    assert.equal(p.journey_cell, `stage:${p.stage}`, `${p.key} journey_cell 与 stage 不一致`);
    assert.equal(p.severity, "error", `${p.key} 必须 error（决策 f18f56b8 每步拦截）`);
    assert.match(p.note, /[\w.-]+\.(js|sh|sql):\d+/, `${p.key} note 缺 文件:行 依据`);
  }
});

test("expect.ref 只能引闭集键（从 workflow-result.sh 实时抽）", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const keys = extractMetricKeys(wfrText);
  const refs = doc.probes.filter((p) => p.expect.ref).map((p) => [p.key, p.expect.ref]);
  assert.ok(refs.length >= 2, "至少两条探针用 ref 对账（videos/comments readback）");
  for (const [k, ref] of refs) {
    const m = /^metrics\.([a-z_]+)$/.exec(ref);
    assert.ok(m, `${k} ref 形状错：${ref}`);
    assert.ok(keys.has(m[1]), `${k} 引了闭集外的键：${m[1]}`);
  }
});

test("sql 探针只打 pg_zenithjoy 且 query 带 $RUN_TAG；http 探针 filter/reduce 齐全", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  for (const p of doc.probes) {
    if (p.probe.type === "sql") {
      assert.equal(p.probe.target, "pg_zenithjoy");
      assert.match(p.probe.query, /zenithjoy\.leadgen_/, `${p.key} 必须查 zenithjoy.leadgen_* 表`);
      assert.match(p.probe.query, /\$RUN_TAG/, `${p.key} 必须按本 run 归属`);
    } else if (p.probe.type === "http") {
      assert.match(p.probe.target, /^feishu_(jinuo|yuesheng)$/);
      assert.match(p.probe.url, /^https:\/\/open\.feishu\.cn\/open-apis\/bitable\/v1\/apps\/(\$BASE|[A-Za-z0-9]+)\/tables\/(\$POOL|\$KEYWORD|\$LEAD|tbl[A-Za-z0-9]+)\/records/);
      assert.ok(p.probe.filter && Object.keys(p.probe.filter).length > 0, `${p.key} 缺 filter`);
      assert.match(p.probe.reduce, /^(count|field:.+)$/, `${p.key} reduce 非法`);
    }
  }
});

// 棒3b-2 口径守卫（决策 8f38f5fd）：09-26 MMV 实跑同 TAG 下 videos_readback=0 而 line_key_not_null 读回 7 行——
// 前者多了 line_key='$LINE_KEY' 条件，而 --line-key 传的是 profile 名(jinoshengyuan-work)、库里存的是路由键(jinuo，push-videos.js:57 ROUTE.key)。
// 两条探针查同一张表同一批次，WHERE 必须一字不差，否则同 TAG 一条读到行、另一条读 0 的分叉会再发。
function sqlShape(query) {
  const q = query.replace(/\s+/g, " ").trim();
  const table = (/FROM\s+(\S+)/i.exec(q) || [])[1];
  const where = (/WHERE\s+(.+?)\s*$/i.exec(q) || [])[1];
  return { table, where };
}
test("videos_readback 与 line_key_not_null：同 target、同表、同 WHERE（只按 $RUN_TAG 归属，不带 line_key 条件）", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const byKey = Object.fromEntries(doc.probes.map((p) => [p.key, p]));
  const a = byKey.videos_readback, b = byKey.line_key_not_null;
  assert.equal(a.probe.target, b.probe.target);
  const sa = sqlShape(a.probe.query), sb = sqlShape(b.probe.query);
  assert.equal(sa.table, "zenithjoy.leadgen_videos"); assert.equal(sa.table, sb.table);
  assert.equal(sa.where, sb.where, `两条 WHERE 分叉：\n  videos_readback: ${sa.where}\n  line_key_not_null: ${sb.where}`);
  assert.equal(sa.where, "harvest_batch = '$RUN_TAG'");
  assert.ok(!/\$LINE_KEY/.test(a.probe.query), "videos_readback 不得再按 $LINE_KEY 过滤（profile 名 ≠ 库内路由键）");
});

test("verify-step resolveLineKey：profile 名 / 业务线名 → 路由键；认不出原样透传；空串原样", async () => {
  const { resolveLineKey } = await import(path.join(ROOT, "verify-step.mjs"));
  assert.equal(resolveLineKey("jinoshengyuan-work"), "jinuo");
  assert.equal(resolveLineKey("悦升云端"), "yuesheng");
  assert.equal(resolveLineKey("jinuo"), "jinuo");
  assert.equal(resolveLineKey("xiaolongxia"), "xiaolongxia", "routeOf 抛错时原样透传，不吞探针");
  assert.equal(resolveLineKey(""), "");
});

// 运行时读回接线棘轮：探针定义已补齐 8 个 stage，但 workflow-result.sh 运行时只对 WFR_PROBE_STAGES 读回。
// 其余 stage 的运行时接线（metric 探针传 --metrics-json、outreach 接账本）挂任务 6b133a81；
// 接上一个就必须从 RUNTIME_PENDING 删一个——清单与现实不符即红，防"定义了但永远不跑"被遗忘。
const RUNTIME_PENDING = [];   // 6b133a81：8 个 stage 全部接上运行时读回+拦截，棘轮清零
test("WFR_PROBE_STAGES ∪ RUNTIME_PENDING(6b133a81) == YAML stage 集合，且两者不相交", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const yamlStages = [...new Set(doc.probes.map((p) => p.stage))].sort();
  const m = /WFR_PROBE_STAGES="\$\{WFR_PROBE_STAGES:?-([a-z ]+)\}"/.exec(wfrText);
  assert.ok(m, "workflow-result.sh 缺 WFR_PROBE_STAGES 默认值声明");
  const wired = m[1].trim().split(/\s+/);
  assert.ok(!wired.some((s) => RUNTIME_PENDING.includes(s)), "已接线的 stage 还挂在 RUNTIME_PENDING");
  assert.deepEqual([...wired, ...RUNTIME_PENDING].sort(), yamlStages);
});

// ── proven-to-fire：坏文档必须被拒 ────────────────────────────────────────
function withProbe(patch) {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const p = JSON.parse(JSON.stringify(doc.probes[0]));
  Object.assign(p, patch);
  return { ...doc, probes: [p] };
}

test("坏 stage 被拒", () => {
  const errors = validateSchema(withProbe({ stage: "sorting", journey_cell: "stage:sorting" }), schema);
  assert.ok(errors.some((e) => /stage/.test(e)), errors.join("\n"));
});

test("坏 op 被拒", () => {
  const errors = validateSchema(withProbe({ expect: { op: "!=", value: 0 } }), schema);
  assert.ok(errors.some((e) => /expect/.test(e)), errors.join("\n"));
});

test("坏 severity 被拒", () => {
  const errors = validateSchema(withProbe({ severity: "info" }), schema);
  assert.ok(errors.some((e) => /severity/.test(e)), errors.join("\n"));
});

test("ref 不是 metrics.<key> 形状被拒", () => {
  const errors = validateSchema(withProbe({ expect: { op: ">=", ref: "probe:other" } }), schema);
  assert.ok(errors.some((e) => /ref/.test(e)), errors.join("\n"));
});

test("not_null_all 不得带 value/ref", () => {
  const errors = validateSchema(withProbe({ expect: { op: "not_null_all", value: 0 } }), schema);
  assert.ok(errors.length > 0, "not_null_all + value 应被拒");
});

test("metric 探针缺 ref 被拒；ref 非 metrics.<key> 被拒", () => {
  let errors = validateSchema(withProbe({ probe: { type: "metric" }, expect: { op: "==", value: 1 } }), schema);
  assert.ok(errors.length > 0, "metric 缺 ref 应被拒");
  errors = validateSchema(withProbe({ probe: { type: "metric", ref: "leads_written" }, expect: { op: "==", value: 1 } }), schema);
  assert.ok(errors.length > 0, "metric ref 形状错应被拒");
});

test("warn 级探针被 schema 拒（决策 f18f56b8 不设 warn）", () => {
  const errors = validateSchema(withProbe({ severity: "warn" }), schema);
  assert.ok(errors.some((e) => /severity/.test(e)), errors.join("\n"));
});

test("value 与 ref 同时给被拒", () => {
  const errors = validateSchema(withProbe({ expect: { op: ">=", value: 1, ref: "metrics.leads_written" } }), schema);
  assert.ok(errors.length > 0, "value+ref 同给应被拒");
});

test("http url 占位符：$BASE/$POOL/$KEYWORD/$LEAD 通过；未知占位符（$WORD/$BOGUS）与坏形状被拒", () => {
  const http = (url, minus) => withProbe({ probe: { type: "http", target: "feishu_jinuo", url, filter: { a: "b" }, reduce: "count", ...(minus ? { minus: { url: minus, filter: { a: "b" }, reduce: "count" } } : {}) } });
  const base = "https://open.feishu.cn/open-apis/bitable/v1/apps";
  for (const t of ["$POOL", "$KEYWORD", "$LEAD"]) assert.deepEqual(validateSchema(http(`${base}/$BASE/tables/${t}/records`), schema), [], t);
  assert.deepEqual(validateSchema(http(`${base}/$BASE/tables/$POOL/records`, `${base}/$BASE/tables/$KEYWORD/records`), schema), [], "minus 同形");
  assert.deepEqual(validateSchema(http(`${base}/GNuwbzY0da8GP0sv6MGcOTu9ntd/tables/tblmrJTyVgzTj89P/records`), schema), [], "字面 id 仍合法（向后兼容）");
  assert.ok(validateSchema(http(`${base}/$BOGUS/tables/$POOL/records`), schema).length > 0, "$BOGUS 应被拒");
  assert.ok(validateSchema(http(`${base}/$BASE/tables/$WORD/records`), schema).length > 0, "$WORD 不是表占位符");
});

// ── 探针挂点 target（cecelia 迁移 496 / 价值流建模⑤）────────────────────────
// 库里 coll_rescan_rate 已由迁移挂到 step；YAML 不写 target 的话，下次 sync-step-probes 会按
// journey_cell 回挂活动级（漂移）。SSOT 是这份 YAML，所以形状必须在这里定死。
test("coll_rescan_rate 声明 target:{type:step,key:collection.return_to_results}", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const p = doc.probes.find((x) => x.key === "coll_rescan_rate");
  assert.ok(p, "缺 coll_rescan_rate");
  assert.deepEqual(p.target, { type: "step", key: "keyword_acquisition.collection.return_to_results" });
  assert.equal(p.journey_cell, "stage:collection", "journey_cell（活动格，翻色单位）必须保留");
  assert.equal(validateSchema(doc, schema).length, 0, "带 target 的文档必须过 schema");
});

test("target.type 只允许 activity|step|enabler，且 key 必填、无未知键", () => {
  let errors = validateSchema(withProbe({ target: { type: "foo", key: "x" } }), schema);
  assert.ok(errors.some((e) => /target/.test(e)), errors.join("\n"));
  errors = validateSchema(withProbe({ target: { type: "step" } }), schema);
  assert.ok(errors.some((e) => /target/.test(e)), "缺 key 应被拒");
  errors = validateSchema(withProbe({ target: { type: "enabler", key: "device_lock", extra: 1 } }), schema);
  assert.ok(errors.some((e) => /target/.test(e)), "未知键应被拒");
});
