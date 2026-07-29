#!/usr/bin/env node
/**
 * realmachine-unverified-ratchet.mjs — 真机验证车道三层防假绿守卫 · 第3层 patrol 棘轮指标
 *
 * 扫描 golden-path-*-smoke.sh（默认 .github/workflows/scripts/smoke 目录下全部 *.sh）里的
 * `[CI-MOCK: real-device-only | nightly_ref: X]` 标记，检查 nightly_ref 指向的脚本名是否
 * 在 nightly-real-machine-staging.yml 中被引用；未被引用（或标记缺 nightly_ref）计入
 * realmachine_unverified_count。跟进 gp-smoke-ratchet.mjs 的 report-only CLI 模式。
 *
 * 用法:
 *   node scripts/product-map/realmachine-unverified-ratchet.mjs
 *
 * 环境变量（均可覆盖，未设置时用默认值，相对 CWD 解析）:
 *   REALMACHINE_SMOKE_DIR    扫描的 smoke 脚本目录（默认 .github/workflows/scripts/smoke）
 *   REALMACHINE_NIGHTLY_YML  读取的 nightly workflow 文件路径
 *                            （默认 .github/workflows/nightly-real-machine-staging.yml）
 *
 * 输出 JSON（stdout）: { realmachine_unverified_count, realmachine_unverified_ids }
 * Report-only：供 ci-patrol 日报调用展示，不作 CI 硬闸，exit 恒为 0。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { computeRealmachineUnverifiedRatchet } from './lib.mjs';

const CWD = process.cwd();
const SMOKE_DIR = resolve(CWD, process.env.REALMACHINE_SMOKE_DIR || '.github/workflows/scripts/smoke');
const NIGHTLY_YML = resolve(CWD, process.env.REALMACHINE_NIGHTLY_YML || '.github/workflows/nightly-real-machine-staging.yml');

// 匹配 `# [CI-MOCK: real-device-only]` 或 `# [CI-MOCK: real-device-only | nightly_ref: X]`
const MARKER_RE = /\[CI-MOCK:\s*real-device-only(?:\s*\|\s*nightly_ref:\s*([^\]]+))?\]/;

function scanMarkers(dir) {
  if (!existsSync(dir)) return [];
  const markers = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.sh')) continue;
    const filePath = join(dir, entry);
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      const m = line.match(MARKER_RE);
      if (m) {
        markers.push({
          file: basename(entry),
          line: idx + 1,
          nightlyRef: m[1] ? m[1].trim() : null,
        });
      }
    });
  }
  return markers;
}

const markers = scanMarkers(SMOKE_DIR);
const nightlyYaml = existsSync(NIGHTLY_YML) ? readFileSync(NIGHTLY_YML, 'utf8') : '';
const result = computeRealmachineUnverifiedRatchet(markers, nightlyYaml);

console.log(JSON.stringify(result));
process.exit(0);
