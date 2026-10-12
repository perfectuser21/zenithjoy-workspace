#!/usr/bin/env node
/**
 * gen-commander-contracts.mjs — 从契约生成 Commander 运行时合同清单（决策 2186700a / 26df670a，任务 c0fe7e30）
 *
 * 用法: node scripts/product-map/gen-commander-contracts.mjs [--check]
 *   写 services/phone-adb-controller/commander/workflow-contracts.json（deploy.sh 下发 mmv ~/.openclaw/commander/）；
 *   wf-launch / wf-agent-run / work-commander 读它判断 codex_agent 形态、外壳与业务活动、读回、陪跑 skill。
 *   --check 只比对不写，不一致 exit 1（commander-skill-contracts.test.js 同样钉住）。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContractsFromDisk, commanderContractsSpec } from './contracts-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(ROOT, 'services/phone-adb-controller/commander/workflow-contracts.json');
const text = `${JSON.stringify(commanderContractsSpec(loadContractsFromDisk()), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!existsSync(out) || readFileSync(out, 'utf8') !== text) {
    console.error(`Commander 合同清单漂移: ${out}（跑 node scripts/product-map/gen-commander-contracts.mjs 重新生成）`);
    process.exit(1);
  }
  console.log('Commander 合同清单与契约一致');
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out}`);
}
