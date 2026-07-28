#!/usr/bin/env node
/**
 * cli.mjs — Product Map CLI
 *
 * 用法:
 *   node scripts/product-map/cli.mjs validate   — schema + 关系校验
 *   node scripts/product-map/cli.mjs generate   — 生成 JSON + MD 投影
 *   node scripts/product-map/cli.mjs check      — 漂移检测
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadAndValidateProductMap,
  validateRelations,
  canonicalize,
  canonicalJson,
  productMapDigest,
  renderProductMapMarkdown,
} from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const GENERATED_DIR = resolve(REPO_ROOT, 'product-map/generated');
const JSON_OUT = resolve(GENERATED_DIR, 'product-map.json');
const MD_OUT = resolve(GENERATED_DIR, 'product-map.md');

const [,, command] = process.argv;

async function cmdValidate() {
  const { map, errors } = await loadAndValidateProductMap();
  if (errors.length > 0) {
    console.error('FAIL: Schema validation errors:');
    for (const e of errors) console.error(' ', e);
    process.exit(1);
  }

  const relErrors = validateRelations(map);
  if (relErrors.length > 0) {
    console.error('FAIL: Relation validation errors:');
    for (const e of relErrors) console.error(' ', e);
    process.exit(1);
  }

  console.log('PASS: product-map.yaml is valid');
}

async function cmdGenerate() {
  const { map, errors } = await loadAndValidateProductMap();
  if (errors.length > 0) {
    console.error('FAIL: Cannot generate — schema errors:');
    for (const e of errors) console.error(' ', e);
    process.exit(1);
  }

  const relErrors = validateRelations(map);
  if (relErrors.length > 0) {
    console.error('FAIL: Cannot generate — relation errors:');
    for (const e of relErrors) console.error(' ', e);
    process.exit(1);
  }

  const digest = productMapDigest(map);
  const canonical = canonicalize(map);

  // Build output JSON
  const outputJson = {
    ...canonical,
    digest,
  };

  if (!existsSync(GENERATED_DIR)) {
    mkdirSync(GENERATED_DIR, { recursive: true });
  }

  writeFileSync(JSON_OUT, JSON.stringify(outputJson, null, 2) + '\n', 'utf8');
  writeFileSync(MD_OUT, renderProductMapMarkdown(map, digest), 'utf8');

  console.log(`PASS: generated product-map.json and product-map.md (digest: ${digest.slice(0, 8)}...)`);
}

async function cmdCheck() {
  if (!existsSync(JSON_OUT)) {
    console.error('FAIL: drift — product-map/generated/product-map.json does not exist. Run npm run product-map:generate first.');
    process.exit(1);
  }

  const { map, errors } = await loadAndValidateProductMap();
  if (errors.length > 0) {
    console.error('FAIL: mismatch — product-map.yaml has schema errors');
    process.exit(1);
  }

  const currentDigest = productMapDigest(map);
  const generatedJson = JSON.parse(readFileSync(JSON_OUT, 'utf8'));

  if (generatedJson.digest !== currentDigest) {
    console.error(`FAIL: drift detected — generated digest ${generatedJson.digest.slice(0, 8)} does not match current YAML digest ${currentDigest.slice(0, 8)}`);
    console.error('Run npm run product-map:generate to update the generated files.');
    process.exit(1);
  }

  // Also verify the MD file contains the digest
  if (existsSync(MD_OUT)) {
    const mdContent = readFileSync(MD_OUT, 'utf8');
    if (!mdContent.includes(currentDigest)) {
      console.error(`FAIL: mismatch — product-map.md does not contain current digest`);
      process.exit(1);
    }
  }

  console.log(`PASS: no drift — generated files match current product-map.yaml (digest: ${currentDigest.slice(0, 8)}...)`);
}

switch (command) {
  case 'validate':
    await cmdValidate();
    break;
  case 'generate':
    await cmdGenerate();
    break;
  case 'check':
    await cmdCheck();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Usage: node scripts/product-map/cli.mjs [validate|generate|check]');
    process.exit(1);
}
