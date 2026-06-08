import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Sprint 06081700：line01/02/05 stub 模块结构契约
// 每个 Line 模块必须有完整 manifest + preflight 返回 {ok: true}
const MODULES = ['line01', 'line02', 'line05'] as const;

const EXPECTED_LINE_ID: Record<string, string> = {
  line01: 'line01-publish',
  line02: 'line02-lead-gen',
  line05: 'line05-video',
};

const MODULES_ROOT = path.join(__dirname, '..', '..');

describe('line stub 模块（line01/02/05）', () => {
  for (const m of MODULES) {
    describe(m, () => {
      it('manifest.json 必填字段完整 (lineId, version, entry, platform)', () => {
        const manifestPath = path.join(MODULES_ROOT, m, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

        expect(manifest.lineId).toBe(EXPECTED_LINE_ID[m]);
        expect(typeof manifest.version).toBe('string');
        expect(manifest.version.length).toBeGreaterThan(0);
        expect(manifest.entry).toBe('index.js');
        expect(Array.isArray(manifest.platform)).toBe(true);
        expect(manifest.platform.length).toBeGreaterThan(0);
      });

      it('preflight 返回 {ok: true, checks: {}}', async () => {
        const mod = await import(`../../${m}/preflight`);
        const result = await mod.runPreflight(path.join(MODULES_ROOT, m));

        expect(result.ok).toBe(true);
        expect(result.checks).toBeDefined();
        expect(typeof result.checks).toBe('object');
      });
    });
  }
});
