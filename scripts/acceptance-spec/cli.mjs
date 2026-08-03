#!/usr/bin/env node
/**
 * cli.mjs — Line02 验收规程 CLI
 *
 * 用法:
 *   node scripts/acceptance-spec/cli.mjs validate   — schema 校验
 *   node scripts/acceptance-spec/cli.mjs generate    — 生成员工验收网页 HTML
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndValidateSpec, renderHtml } from './lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const GENERATED_DIR = resolve(REPO_ROOT, 'acceptance-spec/generated');
const HTML_OUT = resolve(GENERATED_DIR, 'line02-android.html');

const [, , command] = process.argv;

async function cmdValidate() {
  const { errors } = await loadAndValidateSpec();
  if (errors.length > 0) {
    console.error('FAIL: acceptance-spec/line02-android.yaml 校验失败：');
    for (const e of errors) console.error(' ', e);
    process.exit(1);
  }
  console.log('PASS: acceptance-spec/line02-android.yaml 校验通过');
}

async function cmdGenerate() {
  const { spec, errors } = await loadAndValidateSpec();
  if (errors.length > 0) {
    console.error('FAIL: 无法生成 — 规程文件有校验错误：');
    for (const e of errors) console.error(' ', e);
    process.exit(1);
  }

  const html = renderHtml(spec);

  if (!existsSync(GENERATED_DIR)) {
    mkdirSync(GENERATED_DIR, { recursive: true });
  }
  writeFileSync(HTML_OUT, html, 'utf8');
  console.log(`PASS: 已生成 ${HTML_OUT}`);
  console.log('部署：scp 到 hk-vps 落位 /data/docs/line02-android-acceptance-sop/index.html（见 docs-center skill）');
}

switch (command) {
  case 'validate':
    await cmdValidate();
    break;
  case 'generate':
    await cmdGenerate();
    break;
  default:
    console.error('用法: node scripts/acceptance-spec/cli.mjs validate|generate');
    process.exit(1);
}
