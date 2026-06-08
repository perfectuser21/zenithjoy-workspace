import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runPreflight as preflightLine01 } from '../preflight';
import { runPreflight as preflightLine02 } from '../../line02/preflight';
import { runPreflight as preflightLine05 } from '../../line05/preflight';

// Sprint 06081700：line01/02/05 stub 模块结构契约
// 每个 Line 模块必须有完整 manifest + preflight 返回 {ok: true}
const MODULES_ROOT = path.join(__dirname, '..', '..');

const CASES = [
  { id: 'line01', lineId: 'line01-publish', preflight: preflightLine01 },
  { id: 'line02', lineId: 'line02-lead-gen', preflight: preflightLine02 },
  { id: 'line05', lineId: 'line05-video', preflight: preflightLine05 },
] as const;

describe('line stub 模块（line01/02/05）', () => {
  for (const c of CASES) {
    describe(c.id, () => {
      it('manifest.json 必填字段完整 (lineId, version, entry, platform)', () => {
        const manifestPath = path.join(MODULES_ROOT, c.id, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        expect(manifest.lineId).toBe(c.lineId);
        expect(typeof manifest.version).toBe('string');
        expect(manifest.version.length).toBeGreaterThan(0);
        expect(manifest.entry).toBe('index.js');
        expect(Array.isArray(manifest.platform)).toBe(true);
        expect(manifest.platform.length).toBeGreaterThan(0);
      });

      it('preflight 返回 {ok: true, checks: {}}', async () => {
        const result = await c.preflight(path.join(MODULES_ROOT, c.id));

        expect(result.ok).toBe(true);
        expect(result.checks).toBeDefined();
        expect(typeof result.checks).toBe('object');
      });
    });
  }
});
