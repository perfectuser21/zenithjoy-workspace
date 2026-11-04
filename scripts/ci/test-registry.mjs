#!/usr/bin/env node
// Inventory validation only. A registered test is not evidence that CI executes it.
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const excluded = new Set(['.git', '.worktrees', '.skills-source', '.skills-runtime', 'node_modules', 'dist', 'build', 'coverage', '.venv', 'venv', '__pycache__', '.pytest_cache']);
const testName = /\.(?:test|spec)\.(?:[cm]?[jt]sx?|py|sh|bash|zsh|ps1)$/i;
const nativeName = /^(?:test_.+\.(?:py|sh|bash|zsh|ps1)|.+_test\.py)$/i;
export function discoverTests(root) {
  const files = [];
  const boundary = realpathSync(root);
  function visit(directory, prefix = '') {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (excluded.has(item.name)) continue;
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) visit(resolve(directory, item.name), path);
      else if ((item.isFile() || item.isSymbolicLink()) && (testName.test(item.name) || nativeName.test(item.name))) {
        if (item.isSymbolicLink()) {
          let actual;
          try { actual = realpathSync(resolve(directory, item.name)); }
          catch (error) { throw new Error(`Dangling or unreadable test symlink: ${path} (${error.code})`); }
          const rel = relative(boundary, actual);
          if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Test symlink escapes repository: ${path}`);
          if (!statSync(actual).isFile()) throw new Error(`Test symlink does not target a file: ${path}`);
        }
        files.push(path);
      }
    }
  }
  visit(root);
  return files.sort();
}
export function checkRegistry(root = process.cwd()) {
  const errors = [];
  let data;
  try { data = YAML.parse(readFileSync(resolve(root, 'test-registry.yaml'), 'utf8')); }
  catch (error) { return { errors: [`Cannot parse test-registry.yaml: ${error.message}`], discovered: [], registered: 0 }; }
  if (!data || !Array.isArray(data.tests)) return { errors: ['test-registry.yaml must contain a tests array'], discovered: [], registered: 0 };
  const ids = new Set(), paths = new Set(), registered = new Set(), historical = new Set();
  for (const [index, entry] of data.tests.entries()) {
    const label = `tests[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${label} must be a mapping`); continue; }
    for (const field of ['id', 'path', 'type', 'ci', 'status', 'product']) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) errors.push(`${label}: ${field} must be a nonempty string`);
    }
    if (typeof entry.id === 'string') {
      if (ids.has(entry.id)) errors.push(`Duplicate id: ${entry.id}`);
      ids.add(entry.id);
    }
    if (!['unit', 'integration', 'e2e', 'smoke', 'contract', 'unclassified'].includes(entry.type)) errors.push(`${label}: invalid type ${entry.type}`);
    if (!['L1', 'L2', 'L3', 'L4', 'L4-INT', 'manual', 'windows_cloud', 'ubuntu_chromium', 'e2e-content-clipper-windows', 'e2e-machine-events-windows', 'e2e-machines-windows', 'e2e-acquisition-config-windows', 'unverified'].includes(entry.ci)) errors.push(`${label}: invalid ci ${entry.ci}`);
    if (!['active', 'deprecated', 'pending-ci'].includes(entry.status)) errors.push(`${label}: invalid status ${entry.status}`);
    if ((entry.ci === 'unverified' || entry.type === 'unclassified') && !['pending-ci', 'deprecated'].includes(entry.status)) errors.push(`${label}: unverified inventory must have pending-ci status`);
    const path = entry.path;
    if (typeof path !== 'string' || !path || path.includes('\\') || posix.isAbsolute(path) || path.startsWith('../') || path === '..' || posix.normalize(path) !== path) {
      errors.push(`${label}: path must be a normalized repository-relative file path`); continue;
    }
    if (paths.has(path)) errors.push(`Duplicate path: ${path}`);
    paths.add(path);
    let exists = false;
    try {
      const full = resolve(root, path), actual = realpathSync(full);
      const rel = relative(realpathSync(root), actual);
      if (rel === '..' || rel.startsWith(`..${sep}`)) errors.push(`${label}: path escapes repository: ${path}`);
      else exists = statSync(full).isFile();
    } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') errors.push(`${label}: cannot inspect ${path}: ${error.message}`); }
    if (entry.status === 'deprecated') {
      const superseded = typeof entry.deprecation_reason === 'string' && entry.deprecation_reason.trim() && Array.isArray(entry.superseded_by) && entry.superseded_by.length;
      if (superseded) {
        for (const id of entry.superseded_by) {
          const replacement = data.tests.find(test => test?.id === id && test.status === 'active');
          if (!replacement || typeof replacement.path !== 'string') errors.push(`${label}: missing active replacement ${id}`);
        }
        historical.add(path);
        // A superseded file can remain as historical evidence, but never count it as active coverage.
      } else {
        if (typeof entry.retirement !== 'string' || !entry.retirement.trim()) errors.push(`${label}: retirement explanation required for ${path}`);
        if (exists) errors.push(`${label}: retired test still exists: ${path}`);
      }
    } else {
      if (!exists) errors.push(`Missing registered file: ${path}`);
      registered.add(path);
    }
  }
  const discovered = discoverTests(root);
  for (const path of discovered) if (!registered.has(path) && !historical.has(path)) errors.push(`Unregistered test: ${path}`);
  return { errors, discovered, registered: registered.size };
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkRegistry();
    if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
    else console.log(`PASS: validated ${result.registered} registered files; discovered ${result.discovered.length} test files. Registration does not verify CI execution.`);
  } catch (error) { console.error(`Registry check failed: ${error.message}`); process.exitCode = 1; }
}
