// checks-social-keyword-leadgen.test.mjs —— 声明式探针文件守卫（决策 702949b6 / e2cef2c9）
//
// 探针文件 checks/social-keyword-leadgen.yaml 是 Brain step_probes 的 SSOT（cecelia 仓
// scripts/sync-step-probes.mjs 按哈希登记）。这份测试卡的是"文件形状不能漂"：
//   - stage 只能是 workflow-result.sh 的 7 个 stage（Brain 侧 journey cell 就这 7 个）
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

test("闭集键从 workflow-result.sh 抽出：含 delivery 四键与 COMMON 四键", () => {
  const keys = extractMetricKeys(wfrText);
  for (const k of ["leads_written", "duplicates_skipped", "readback_verified", "cursor_updates",
                   "videos_processed", "comments_collected", "external_interactions", "business_writes"]) {
    assert.ok(keys.has(k), `缺闭集键 ${k}`);
  }
  assert.ok(!keys.has("leads_writt"), "不该有截断的假键");
});

test("STAGES 与 workflow-result.sh req_keys 的 7 个 stage 一致", () => {
  const stages = [...wfrText.matchAll(/^\s+(\w+)\) echo "[a-z_ ]+";;$/gm)].map((m) => m[1]);
  assert.deepEqual(stages, [...STAGES]);
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

test("首发五条探针键齐全且落在 delivery / scoring", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const byKey = Object.fromEntries(doc.probes.map((p) => [p.key, p]));
  for (const k of ["videos_readback", "comments_readback", "line_key_not_null"]) {
    assert.equal(byKey[k] && byKey[k].stage, "delivery", `${k} 应在 delivery`);
  }
  for (const k of ["pool_advanced", "effective_count"]) {
    assert.equal(byKey[k] && byKey[k].stage, "scoring", `${k} 应在 scoring`);
  }
});

test("key 唯一、journey_cell == stage:<stage>、首发全 warn、note 带 文件:行 依据", () => {
  const { doc } = loadChecks(YAML_PATH, SCHEMA_PATH);
  const keys = doc.probes.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length, "key 重复");
  for (const p of doc.probes) {
    assert.equal(p.journey_cell, `stage:${p.stage}`, `${p.key} journey_cell 与 stage 不一致`);
    assert.equal(p.severity, "warn", `${p.key} 首发必须 warn`);
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
    } else {
      assert.match(p.probe.target, /^feishu_(jinuo|yuesheng)$/);
      assert.match(p.probe.url, /^https:\/\/open\.feishu\.cn\/open-apis\/bitable\/v1\/apps\/[A-Za-z0-9]+\/tables\/tbl[A-Za-z0-9]+\/records/);
      assert.ok(p.probe.filter && Object.keys(p.probe.filter).length > 0, `${p.key} 缺 filter`);
      assert.match(p.probe.reduce, /^(count|field:.+)$/, `${p.key} reduce 非法`);
    }
  }
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

test("value 与 ref 同时给被拒", () => {
  const errors = validateSchema(withProbe({ expect: { op: ">=", value: 1, ref: "metrics.leads_written" } }), schema);
  assert.ok(errors.length > 0, "value+ref 同给应被拒");
});
