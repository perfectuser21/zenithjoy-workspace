// Shared fixture only: importing this module must never register tests.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { readImplementationSource } from '../../../ci/implementation-skill-source.mjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export function createProductMapFixture() {
  const root = mkdtempSync(join(tmpdir(), 'product-map-cli-json-'));
  cpSync(resolve(repoRoot, 'scripts/product-map'), resolve(root, 'scripts/product-map'), { recursive: true });
  cpSync(resolve(repoRoot, 'product-map'), resolve(root, 'product-map'), { recursive: true });
  cpSync(resolve(repoRoot, 'package.json'), resolve(root, 'package.json'));
  mkdirSync(resolve(root, 'node_modules'));
  const require = createRequire(import.meta.url);
  for (const dependency of ['ajv', 'ajv-formats', 'yaml']) {
    symlinkSync(dirname(require.resolve(`${dependency}/package.json`)), resolve(root, 'node_modules', dependency), 'dir');
  }
  const generated = JSON.parse(readFileSync(resolve(root, 'product-map/generated/product-map.json'), 'utf8'));
  for (const gp of generated.golden_paths ?? []) {
    for (const path of gp.smoke_files ?? []) {
      mkdirSync(dirname(resolve(root, path)), { recursive: true });
      cpSync(resolve(repoRoot, path), resolve(root, path));
    }
  }
  // 主干活动契约（决策 3240824c）引用的探针文件与账本脚本，check 会一并校验
  const contracts = JSON.parse(readFileSync(resolve(root, 'product-map/generated/contracts.json'), 'utf8'));
  const deps = new Set();
  for (const cap of Object.keys(contracts.capabilities)) {
    const text = readFileSync(resolve(root, `product-map/contracts/${cap}.yaml`), 'utf8');
    for (const m of text.matchAll(/^(?:checks|ledger): (\S+)$/gm)) deps.add(m[1]);
  }
  for (const path of deps) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    cpSync(resolve(repoRoot, path), resolve(root, path));
  }
  // 合同 commander_skill 指向的陪跑 skill（任务 c0fe7e30），check 校验其存在与版本
  // CLI imports this module even when the fixture's skill files are materialized.
  mkdirSync(resolve(root, 'scripts/ci'), { recursive: true });
  cpSync(resolve(repoRoot, 'scripts/ci/implementation-skill-source.mjs'), resolve(root, 'scripts/ci/implementation-skill-source.mjs'));
  // Resolve the real checked-in lock through the production reader. Temporary
  // fixtures have no Git history, so give them the exact pinned skill bytes.
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  for (const cap of Object.keys(contracts.capabilities)) {
    const contract = parseYaml(readFileSync(resolve(repoRoot, `product-map/contracts/${cap}.yaml`), 'utf8'));
    if (!contract.commander_skill) continue;
    const path = `services/phone-adb-controller/commander/skills/${contract.commander_skill.name}/SKILL.md`;
    const bytes = readImplementationSource(repoRoot, revision, path, { source: process.env.SKILLS_SOURCE_DIR || resolve(repoRoot, '.skills-source'), offline: true });
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), bytes);
  }
  return root;
}

