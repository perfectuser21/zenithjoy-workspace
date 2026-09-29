#!/usr/bin/env node
/**
 * gen-step-dod.mjs — 从契约生成步骤 DoD 运行时清单（任务 9032cdad，决策 0834e2fb：契约真身在 git，运行时拿生成物）
 *
 * 用法: node scripts/product-map/gen-step-dod.mjs [--check]
 *   写 services/phone-adb-controller/step-dod.json（deploy.sh 下发 mmv 与两台执行机）；
 *   --check 只比对不写，不一致 exit 1（contracts.test.js 同样钉住）。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDisk, stepDodSpec } from './contracts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'services/phone-adb-controller/step-dod.json');
const text = `${JSON.stringify(stepDodSpec(loadContractsFromDisk(), 'keyword_acquisition'), null, 2)}\n`;
if (process.argv.includes('--check')) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('step-dod.json 与契约不一致：跑 node scripts/product-map/gen-step-dod.mjs'); process.exit(1); }
  console.log('step-dod.json OK');
} else {
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT}`);
}
