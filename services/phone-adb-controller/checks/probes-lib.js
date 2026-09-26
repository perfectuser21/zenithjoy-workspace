// probes-lib.js —— 声明式探针文件（checks/*.yaml）的零依赖加载/校验层
//
// 为什么自己写而不用 js-yaml/ajv：__tests__/*.test.mjs 在 CI openclaw-scripts-test 里是
// "纯 node --test 不装依赖"跑的（见 .github/workflows/ci-l3-code.yml 注释），顶层 require 第三方包
// CI 直接炸。探针文件只用 YAML 的一个受限子集（块映射 / 块序列 / 标量 / | 块标量 / 引号串），
// 校验也只用 JSON Schema 的一个子集（type/required/enum/properties/additionalProperties/items/
// pattern/minimum/oneOf/not/allOf/if-then），够用且可测。
//
// 消费方：cecelia 仓 scripts/sync-step-probes.mjs（登记 sha256 + 把 journey cell 的
// assertion_ref 写成 probe:<key>）。改探针 = 改 YAML 发 PR，本文件只管形状。
"use strict";
const fs = require("fs");
const crypto = require("crypto");

// Brain 侧 journey cell 就这 7 个，与 workflow-result.sh req_keys() 顺序一致
const STAGES = Object.freeze(["preflight", "discovery", "qualification", "collection", "scoring", "delivery", "cleanup"]);

// ── 受限 YAML 子集解析 ────────────────────────────────────────────────
function scalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "null" || s === "~") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.startsWith('"') ? JSON.parse(s) : s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

function stripComment(line) {
  // 只剥不在引号里的 " #"；探针 SQL 用 | 块标量，不走这里
  let inQ = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === inQ) inQ = null; continue; }
    if (c === '"' || c === "'") { inQ = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const indentOf = (l) => l.length - l.trimStart().length;
  const isBlank = (l) => l.trim() === "" || l.trim().startsWith("#");

  function readBlockScalar(indent) {
    const out = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l.trim() === "") { out.push(""); i++; continue; }
      if (indentOf(l) <= indent) break;
      out.push(l);
      i++;
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    const base = Math.min(...out.filter((l) => l.trim() !== "").map(indentOf));
    return out.map((l) => l.slice(base)).join("\n") + "\n";
  }

  function readValue(rest, indent) {
    const r = rest.trim();
    if (r === "|" || r === ">") {
      const s = readBlockScalar(indent);
      return r === ">" ? s.replace(/\n(?!\n)/g, " ").trim() + "\n" : s;
    }
    if (r === "") {
      // 嵌套块：下一非空行决定是映射还是序列
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && indentOf(lines[j]) > indent) {
        return /^-(\s|$)/.test(lines[j].trim()) ? readSeq(indentOf(lines[j])) : readMap(indentOf(lines[j]));
      }
      return null;
    }
    if (r === "[]") return [];
    if (r === "{}") return {};
    return scalar(stripComment(r));
  }

  function readMap(indent) {
    const obj = {};
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { i++; continue; }
      const ind = indentOf(l);
      if (ind < indent) break;
      if (ind > indent) throw new Error(`YAML 缩进错误 第${i + 1}行: ${l}`);
      const m = /^([^:#]+?):(?:\s+(.*)|)$/.exec(stripComment(l.trim()));
      if (!m) throw new Error(`YAML 期待 key: 第${i + 1}行: ${l}`);
      i++;
      obj[scalar(m[1])] = readValue(m[2] || "", indent);
    }
    return obj;
  }

  function readSeq(indent) {
    const arr = [];
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { i++; continue; }
      const ind = indentOf(l);
      if (ind < indent) break;
      if (ind > indent || !/^-(\s|$)/.test(l.trim())) throw new Error(`YAML 期待序列项 第${i + 1}行: ${l}`);
      const rest = l.trim().slice(1).trim();
      if (rest === "") { i++; arr.push(readValue("", indent)); continue; }
      if (/^[^:#"']+?:(\s|$)/.test(rest)) {
        // "- key: v" —— 把本行当作缩进为 indent+2 的映射首行回放
        lines[i] = " ".repeat(indent + 2) + rest;
        arr.push(readMap(indent + 2));
      } else {
        i++;
        arr.push(scalar(stripComment(rest)));
      }
    }
    return arr;
  }

  while (i < lines.length && isBlank(lines[i])) i++;
  if (i >= lines.length) return null;
  return /^-(\s|$)/.test(lines[i].trim()) ? readSeq(indentOf(lines[i])) : readMap(indentOf(lines[i]));
}

// ── JSON Schema 子集校验 ───────────────────────────────────────────────
function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function typeOk(v, t) {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

function validateSchema(doc, schema, root = schema, at = "$", errors = []) {
  if (!schema || typeof schema !== "object") return errors;
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o && o[k], root);
    return validateSchema(doc, target, root, at, errors);
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(doc, t))) { errors.push(`${at}: 类型应为 ${types.join("|")}，实际 ${typeOf(doc)}`); return errors; }
  }
  if (schema.enum && !schema.enum.some((e) => e === doc)) errors.push(`${at}: 值 ${JSON.stringify(doc)} 不在枚举 [${schema.enum.join(", ")}]`);
  if (schema.const !== undefined && doc !== schema.const) errors.push(`${at}: 应为 ${JSON.stringify(schema.const)}`);
  if (typeof doc === "string") {
    if (schema.pattern && !new RegExp(schema.pattern).test(doc)) errors.push(`${at}: "${doc}" 不匹配 /${schema.pattern}/`);
    if (schema.minLength !== undefined && doc.length < schema.minLength) errors.push(`${at}: 长度不足 ${schema.minLength}`);
  }
  if (typeof doc === "number" && schema.minimum !== undefined && doc < schema.minimum) errors.push(`${at}: 小于最小值 ${schema.minimum}`);
  if (Array.isArray(doc)) {
    if (schema.minItems !== undefined && doc.length < schema.minItems) errors.push(`${at}: 元素少于 ${schema.minItems}`);
    if (schema.items) doc.forEach((v, idx) => validateSchema(v, schema.items, root, `${at}[${idx}]`, errors));
  }
  if (doc && typeof doc === "object" && !Array.isArray(doc)) {
    for (const k of schema.required || []) if (!(k in doc)) errors.push(`${at}: 缺必填字段 ${k}`);
    if (schema.minProperties !== undefined && Object.keys(doc).length < schema.minProperties) errors.push(`${at}: 字段少于 ${schema.minProperties}`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(doc)) {
      if (props[k]) validateSchema(v, props[k], root, `${at}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: 不允许的字段 ${k}`);
    }
  }
  for (const sub of schema.allOf || []) validateSchema(doc, sub, root, at, errors);
  if (schema.oneOf) {
    const passes = schema.oneOf.filter((sub) => validateSchema(doc, sub, root, at, []).length === 0).length;
    if (passes !== 1) errors.push(`${at}: oneOf 应恰好命中 1 个分支，实际 ${passes}`);
  }
  if (schema.anyOf && !schema.anyOf.some((sub) => validateSchema(doc, sub, root, at, []).length === 0)) {
    errors.push(`${at}: anyOf 无分支命中`);
  }
  if (schema.not && validateSchema(doc, schema.not, root, at, []).length === 0) errors.push(`${at}: 命中了 not 分支`);
  if (schema.if) {
    const hit = validateSchema(doc, schema.if, root, at, []).length === 0;
    const branch = hit ? schema.then : schema.else;
    if (branch) validateSchema(doc, branch, root, at, errors);
  }
  return errors;
}

// ── 闭集键：从 workflow-result.sh 文本抽（不抄一份，抄了必漂）──────────
function extractMetricKeys(wfrText) {
  const keys = new Set();
  const common = /^COMMON="([^"]+)"/m.exec(wfrText);
  if (common) common[1].split(/\s+/).forEach((k) => k && keys.add(k));
  for (const m of wfrText.matchAll(/^\s+\w+\) echo "([a-z_ ]+)";;$/gm)) m[1].split(/\s+/).forEach((k) => k && keys.add(k));
  return keys;
}

function loadChecks(yamlPath, schemaPath) {
  const text = fs.readFileSync(yamlPath, "utf8");
  const doc = parseYaml(text);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const errors = validateSchema(doc, schema);
  const sha256 = crypto.createHash("sha256").update(text).digest("hex");
  return { doc, errors, sha256 };
}

module.exports = { STAGES, parseYaml, validateSchema, extractMetricKeys, loadChecks };
