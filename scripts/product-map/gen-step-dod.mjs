#!/usr/bin/env node
/**
 * gen-step-dod.mjs — 从契约生成步骤 DoD 运行时清单（任务 9032cdad，决策 0834e2fb：契约真身在 git，运行时拿生成物）
 *
 * 用法: node scripts/product-map/gen-step-dod.mjs [--check]
 *   写 services/phone-adb-controller/step-dod.json（deploy.sh 下发 mmv 与两台执行机）；
 *   --check 只比对不写，不一致 exit 1（contracts.test.js 同样钉住）。
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDisk, stepDodSpec } from './contracts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const controller = resolve(ROOT, 'services/phone-adb-controller');
const ctx = loadContractsFromDisk(), outputs = new Map();
for (const cap of Object.keys(ctx.contracts).sort()) {
  const text = `${JSON.stringify(stepDodSpec(ctx, cap), null, 2)}\n`;
  outputs.set(resolve(controller, 'plans', `${cap}.steps.json`), text);
  if (cap === 'keyword_acquisition') outputs.set(resolve(controller, 'step-dod.json'), text);
}
const check = process.argv.includes('--check');
let drift = false;
for (const [path, text] of outputs) {
  if (check) {
    if (!existsSync(path) || readFileSync(path, 'utf8') !== text) { console.error(`步骤清单漂移: ${path}`); drift = true; }
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); console.log(`wrote ${path}`); }
}
if (check) {
  for (const file of readdirSync(resolve(controller, 'plans')).filter(name => name.endsWith('.steps.json'))) {
    if (!outputs.has(resolve(controller, 'plans', file))) { console.error(`无对应契约的步骤清单: ${file}`); drift = true; }
  }
  if (drift) process.exit(1);
  console.log('全部Workflow步骤清单与契约一致');
}
