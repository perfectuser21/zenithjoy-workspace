// apps/api/tests/regression/module-version-sync.test.ts
//
// 回归测试：services/agent/modules/*/manifest.json 版本必须与
// HEARTBEAT_MODULES.required_version 完全一致。
//
// 背景（2026-06-09）：PR #710 升 line04 manifest 1.0.0→1.0.1，
// 但 HEARTBEAT_MODULES 未同步，导致服务端永远下发旧版本，
// Agent 从不触发模块更新，"未找到微信"在生产环境持续存在。
// 本测试作为永久 CI 护栏，强制两者同步。

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HEARTBEAT_MODULES } from '../../src/services/walking-skeleton.service';

// 从 apps/api/tests/regression/ 向上 4 级到 repo 根，再进 services/agent/modules/
const MODULES_ROOT = path.resolve(__dirname, '../../../../services/agent/modules');

function readManifests(): Record<string, { lineId: string; version: string }> {
  const result: Record<string, { lineId: string; version: string }> = {};
  if (!fs.existsSync(MODULES_ROOT)) return result;
  for (const dir of fs.readdirSync(MODULES_ROOT)) {
    const manifestPath = path.join(MODULES_ROOT, dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m.lineId && m.version) result[m.lineId] = { lineId: m.lineId, version: m.version };
    } catch {
      // 损坏的 manifest 让其他测试覆盖，这里跳过
    }
  }
  return result;
}

describe('模块版本同步检查（manifest ↔ HEARTBEAT_MODULES）', () => {
  const manifests = readManifests();

  it('services/agent/modules/ 下至少存在一个 manifest.json（环境健康检查）', () => {
    expect(Object.keys(manifests).length).toBeGreaterThan(0);
  });

  it('每个 manifest 的 lineId 都在 HEARTBEAT_MODULES 中有对应条目', () => {
    const missing = Object.keys(manifests).filter(lineId => !(lineId in HEARTBEAT_MODULES));
    expect(missing, `以下模块在 HEARTBEAT_MODULES 中缺失：${missing.join(', ')}`).toEqual([]);
  });

  it('manifest.version 与 HEARTBEAT_MODULES.required_version 完全一致', () => {
    const mismatches: string[] = [];
    for (const [lineId, { version }] of Object.entries(manifests)) {
      const hbVersion = HEARTBEAT_MODULES[lineId]?.required_version;
      if (hbVersion === undefined) continue; // 已被上面的测试捕获
      if (hbVersion !== version) {
        mismatches.push(`${lineId}: manifest=${version} vs HEARTBEAT_MODULES=${hbVersion}`);
      }
    }
    expect(
      mismatches,
      `版本不一致（改 manifest 时必须同步改 walking-skeleton.service.ts）：\n${mismatches.join('\n')}`,
    ).toEqual([]);
  });

  // 反向检查：HEARTBEAT_MODULES 里不应有 manifest 里不存在的幽灵 lineId
  it('HEARTBEAT_MODULES 中每个 lineId 在 modules/ 下都有对应 manifest', () => {
    const knownLineIds = new Set(Object.keys(manifests));
    const ghosts = Object.keys(HEARTBEAT_MODULES).filter(id => !knownLineIds.has(id));
    expect(
      ghosts,
      `HEARTBEAT_MODULES 中以下 lineId 在 modules/ 下找不到 manifest（已删模块但未清 HEARTBEAT_MODULES？）：${ghosts.join(', ')}`,
    ).toEqual([]);
  });
});
