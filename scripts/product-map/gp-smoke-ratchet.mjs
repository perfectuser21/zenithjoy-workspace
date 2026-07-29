#!/usr/bin/env node
/**
 * gp-smoke-ratchet.mjs — GP锚定闭环 刀5 patrol 棘轮指标
 *
 * 用法:
 *   node scripts/product-map/gp-smoke-ratchet.mjs
 *
 * 输出 JSON（stdout）: { gp_no_smoke_count, gp_no_smoke_ids }
 * Report-only：供 ci-patrol 日报调用展示，不作 CI 硬闸，exit 恒为 0
 * （硬闸职责已由 lint-gp-anchor.sh / lint-smoke-baseline.sh 承担，本脚本只报数）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeGpSmokeRatchet } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const JSON_PATH = resolve(REPO_ROOT, 'product-map/generated/product-map.json');

if (!existsSync(JSON_PATH)) {
  console.log(JSON.stringify({ gp_no_smoke_count: 0, gp_no_smoke_ids: [], error: 'product-map/generated/product-map.json 不存在，请先 npm run product-map:generate' }));
  process.exit(0);
}

const map = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const result = computeGpSmokeRatchet(map);
console.log(JSON.stringify(result));
