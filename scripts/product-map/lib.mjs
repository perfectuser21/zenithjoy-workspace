/**
 * lib.mjs — Product Map SSOT 核心库
 *
 * 导出：
 *   loadAndValidateProductMap()   — 读取并校验 product-map.yaml
 *   validateSchema(input)         — 底层 schema 校验（接受对象）
 *   validateRelations(map)        — 交叉引用关系校验
 *   canonicalize(map)             — 规范化排序
 *   canonicalJson(map)            — 规范化 JSON 字符串
 *   productMapDigest(map)         — SHA-256 摘要
 *   renderProductMapMarkdown(map) — 生成 Markdown 投影
 *   assertBootstrapParity(map, docs) — bootstrap 文件无手写分类词汇
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const SCHEMA_PATH = resolve(REPO_ROOT, 'product-map/product-map.schema.json');
const YAML_PATH = resolve(REPO_ROOT, 'product-map/product-map.yaml');

// ─── Ajv 实例（strict: true，allErrors: true，draft/2020-12）─────────────────

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

let _validate = null;

function getValidate() {
  if (!_validate) {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    _validate = ajv.compile(schema);
  }
  return _validate;
}

// ─── validateSchema ────────────────────────────────────────────────────────────

/**
 * 底层 schema 校验：接受任意对象，返回 { errors }
 * errors 为空数组表示通过。
 */
export function validateSchema(input) {
  const validate = getValidate();
  const valid = validate(input);
  if (valid) {
    return { errors: [] };
  }
  const errors = (validate.errors || []).map(e => {
    const path = e.instancePath || '/';
    return `Schema error at ${path}: ${e.message}`;
  });
  return { errors };
}

// ─── loadAndValidateProductMap ─────────────────────────────────────────────────

/**
 * 读取 product-map.yaml，schema 校验，返回 { map, errors }
 * 通过时 map 为解析后的对象，errors 为 []
 * 失败时 map 为 null，errors 非空
 */
export async function loadAndValidateProductMap() {
  const raw = readFileSync(YAML_PATH, 'utf8');
  const parsed = parseYaml(raw);
  const { errors } = validateSchema(parsed);
  if (errors.length > 0) {
    return { map: null, errors };
  }
  return { map: parsed, errors: [] };
}

// ─── validateRelations ─────────────────────────────────────────────────────────

/**
 * 交叉引用关系校验：
 *   1. GP app_id 须在 map.apps 中存在
 *   2. GP line_id 须在对应 app 的 lines 中存在
 *   3. GP required_surfaces 须在 map.surfaces 中存在
 *   4. GP edition 须在 map.editions 中存在
 *   5. GP id 不得重复
 *
 * 返回错误字符串数组，空数组表示通过。
 */
export function validateRelations(map) {
  const errors = [];
  const appIds = new Set((map.apps || []).map(a => a.id));
  const surfaceSet = new Set(map.surfaces || []);
  const editionSet = new Set(map.editions || []);

  // 建立 app -> Set<lineId> 映射
  const appLineMap = new Map();
  for (const app of (map.apps || [])) {
    appLineMap.set(app.id, new Set((app.lines || []).map(l => l.id)));
  }

  // 检查 GP id 唯一性
  const seenGpIds = new Map();
  for (const gp of (map.golden_paths || [])) {
    if (seenGpIds.has(gp.id)) {
      errors.push(`Duplicate GP id: "${gp.id}" — duplicate golden_path id detected`);
    } else {
      seenGpIds.set(gp.id, true);
    }
  }

  for (const gp of (map.golden_paths || [])) {
    // app_id 校验
    if (!appIds.has(gp.app_id)) {
      errors.push(`GP "${gp.id}" references unknown app: "${gp.app_id}"`);
      continue; // line_id 校验依赖 app 存在，跳过
    }

    // line_id 校验
    const lineSet = appLineMap.get(gp.app_id);
    if (lineSet && !lineSet.has(gp.line_id)) {
      errors.push(`GP "${gp.id}" references unknown line: "${gp.line_id}" in app "${gp.app_id}"`);
    }

    // required_surfaces 校验
    for (const surf of (gp.required_surfaces || [])) {
      if (!surfaceSet.has(surf)) {
        errors.push(`GP "${gp.id}" references unknown surface: "${surf}"`);
      }
    }

    // edition 校验
    if (gp.edition !== undefined && !editionSet.has(gp.edition)) {
      errors.push(`GP "${gp.id}" references unknown edition: "${gp.edition}"`);
    }
  }

  return errors;
}

// ─── canonicalize ──────────────────────────────────────────────────────────────

/**
 * 规范化排序：apps 按 id、lines 按 id、golden_paths 按 id 字母序排序
 * surfaces/editions 按字典序排序
 */
export function canonicalize(map) {
  const apps = [...(map.apps || [])].sort((a, b) => a.id.localeCompare(b.id)).map(app => ({
    ...app,
    lines: [...(app.lines || [])].sort((a, b) => a.id.localeCompare(b.id)),
  }));

  const golden_paths = [...(map.golden_paths || [])].sort((a, b) => a.id.localeCompare(b.id));

  const surfaces = [...(map.surfaces || [])].sort();
  const editions = [...(map.editions || [])].sort();

  return { apps, surfaces, editions, golden_paths };
}

// ─── canonicalJson ─────────────────────────────────────────────────────────────

/**
 * 规范化后的确定性 JSON 字符串（2 空格缩进）
 */
export function canonicalJson(map) {
  return JSON.stringify(canonicalize(map), null, 2);
}

// ─── productMapDigest ──────────────────────────────────────────────────────────

/**
 * SHA-256 摘要（hex），基于规范化 JSON
 */
export function productMapDigest(map) {
  return createHash('sha256').update(canonicalJson(map)).digest('hex');
}

// ─── renderProductMapMarkdown ──────────────────────────────────────────────────

/**
 * 生成 Markdown 投影，包含 digest 注释
 */
export function renderProductMapMarkdown(map, digest) {
  const c = canonicalize(map);
  const lines = [];

  lines.push('# Product Map');
  lines.push('');
  lines.push(`<!-- digest: ${digest} -->`);
  lines.push('');
  lines.push('> 此文件由 `npm run product-map:generate` 自动生成，请勿手工编辑。');
  lines.push('> 唯一手写源：`product-map/product-map.yaml`');
  lines.push('');

  lines.push('## Apps & Lines');
  lines.push('');
  for (const app of c.apps) {
    lines.push(`### ${app.id} — ${app.name}`);
    lines.push('');
    lines.push('| Line ID | Name |');
    lines.push('|---------|------|');
    for (const line of app.lines) {
      lines.push(`| ${line.id} | ${line.name} |`);
    }
    lines.push('');
  }

  lines.push('## Golden Paths');
  lines.push('');
  lines.push('| ID | App | Line | Status |');
  lines.push('|----|-----|------|--------|');
  for (const gp of c.golden_paths) {
    const name = gp.name || '';
    lines.push(`| ${gp.id} | ${gp.app_id} | ${gp.line_id} | ${gp.status} |`);
  }
  lines.push('');

  lines.push('## Surfaces');
  lines.push('');
  lines.push(c.surfaces.map(s => `- ${s}`).join('\n'));
  lines.push('');

  lines.push('## Editions');
  lines.push('');
  lines.push(c.editions.map(e => `- ${e}`).join('\n'));
  lines.push('');

  return lines.join('\n');
}

// ─── assertBootstrapParity ─────────────────────────────────────────────────────

/**
 * 断言 bootstrap 文件不含手写分类词汇
 *
 * @param {object} map — 解析后的 product-map
 * @param {object} docs — { filename: content } 键值对
 * @throws 若任何文件含 App/Line/GP ID 字面量，抛出 Error（消息含 "duplicates Product Map fact"）
 */
export function assertBootstrapParity(map, docs) {
  // 收集所有分类 ID
  const taxonomyIds = new Set();
  for (const app of (map.apps || [])) {
    taxonomyIds.add(app.id);
    for (const line of (app.lines || [])) {
      taxonomyIds.add(line.id);
    }
  }
  for (const gp of (map.golden_paths || [])) {
    taxonomyIds.add(gp.id);
  }

  for (const [filename, content] of Object.entries(docs)) {
    for (const term of taxonomyIds) {
      if (content.includes(term)) {
        throw new Error(
          `${filename} duplicates Product Map fact: contains taxonomy ID "${term}". ` +
          `All classification facts must live exclusively in product-map/product-map.yaml.`
        );
      }
    }
  }
}
