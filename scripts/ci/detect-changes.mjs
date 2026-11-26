#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gates } from './required-gate.mjs';
import { AUTHORING_FILES, greaterVersion } from './authoring-source-version.mjs';

// This document is linked from the controller README and has no runtime readers.
const standaloneDocs = new Set(['docs/android-rpa-execution-modes.md']);
const authoring = new Set(AUTHORING_FILES);
const dashboardSource = /^apps\/dashboard\/src\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.(?:css|ts|tsx)$/;
const dodMetadata = /^\.dod-cp-[a-zA-Z0-9_.-]+\.md$/;
const versionHeader = /^(  "version": ")([0-9.]+)(",\r?)$/m;

const zero = '0'.repeat(40);
function gitBuffer(...args) { return execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 }); }
function git(...args) { return gitBuffer(...args).toString('utf8'); }
function commit(sha, label) {
  if (typeof sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(sha) || sha === zero) throw new Error(`Invalid ${label} SHA`);
  git('cat-file', '-e', `${sha}^{commit}`);
  return sha;
}

function isVersionHeaderBump(oldBlob, newBlob) {
  const oldBytes = gitBuffer('cat-file', 'blob', oldBlob);
  const newBytes = gitBuffer('cat-file', 'blob', newBlob);
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const before = decoder.decode(oldBytes);
    const after = decoder.decode(newBytes);
    const oldHeader = versionHeader.exec(before);
    const newHeader = versionHeader.exec(after);
    if (!oldHeader || !newHeader) return false;
    const oldVersion = oldHeader[2];
    const newVersion = newHeader[2];
    return JSON.parse(before).version === oldVersion && JSON.parse(after).version === newVersion &&
      greaterVersion(newVersion, oldVersion) &&
      Buffer.from(before.replace(versionHeader, (_, prefix, _version, suffix) => prefix + newVersion + suffix)).equals(newBytes);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error.message === 'AUTHORING_SOURCE_VERSION_INVALID') return false;
    throw error;
  }
}

function matchesPrCheckout(base, head) {
  // L2 compares against the current PR base and tests run on the checkout tree.
  return git('merge-base', base, head).trim() === base &&
    git('rev-parse', 'HEAD^{tree}') === git('rev-parse', `${head}^{tree}`);
}

function prDiff(base, head, paths) {
  const records = git('diff', '--raw', '--abbrev=40', '-z', '--no-renames', '--ignore-submodules=none', base, head, '--').split('\0');
  if (records.length !== paths.length * 2 + 1 || records.at(-1) !== '') throw new Error('Invalid raw PR diff');
  const pattern = /^:(?<oldMode>[0-7]{6}) (?<newMode>[0-7]{6}) (?<oldBlob>[a-f0-9]{40}) (?<newBlob>[a-f0-9]{40}) (?<status>[AMD])$/;
  return paths.map((path, i) => {
    if (records[i * 2 + 1] !== path) throw new Error('Inconsistent raw PR diff');
    return { path, ...pattern.exec(records[i * 2])?.groups };
  });
}

function versionHeadersOnly(rows) {
  const versions = rows.filter(({ path }) => authoring.has(path));
  return versions.length === 0 || (
    versions.length === AUTHORING_FILES.length && versions.every(({ oldMode, newMode, status, oldBlob, newBlob }) =>
      oldMode === '100644' && newMode === '100644' && status === 'M' && isVersionHeaderBump(oldBlob, newBlob))
  );
}

function isDocsOnlyPr(base, head, paths) {
  if (!paths.some(path => standaloneDocs.has(path)) || paths.some(path => !standaloneDocs.has(path) && !authoring.has(path))) return false;
  if (!matchesPrCheckout(base, head)) return false;
  const rows = prDiff(base, head, paths);
  return rows.every(({ path, oldMode, newMode, status }) => authoring.has(path) ||
    (oldMode === '100644' && newMode === '100644' && status === 'M')) && versionHeadersOnly(rows);
}

function isDarwinUnrelatedPr(base, head, paths) {
  // Darwin's phone/PG suites can read shared dependencies such as API migrations.
  // Admit only this audited frontend family and its exact companion metadata.
  if (!paths.some(path => dashboardSource.test(path)) ||
    paths.some(path => !dashboardSource.test(path) && !dodMetadata.test(path) && !authoring.has(path))) return false;
  if (!matchesPrCheckout(base, head)) return false;
  const rows = prDiff(base, head, paths);
  return rows.every(({ path, status, oldMode, newMode }) => authoring.has(path) ||
    (status && ['000000', '100644'].includes(oldMode) && ['000000', '100644'].includes(newMode))) && versionHeadersOnly(rows);
}

export function detectChanges(profile, eventName, event) {
  const contract = gates[profile];
  if (!contract) throw new Error(`Unknown gate profile: ${profile}`);
  if (eventName === 'workflow_dispatch' && contract.manual) return Object.fromEntries(contract.routes.map(route => [route, 'true']));
  let base, head, range;
  if (eventName === 'push') {
    head = commit(event.after, 'push head');
    // A branch creation has no base commit; run every check rather than guess a diff.
    if (event.before === zero) return Object.fromEntries(contract.routes.map(route => [route, String(route !== 'docs_only' && route !== 'darwin_unrelated')]));
    base = commit(event.before, 'push base');
    range = [base, head];
  } else if (eventName === 'pull_request') {
    base = commit(event.pull_request?.base?.sha, 'pull request base');
    head = commit(event.pull_request?.head?.sha, 'pull request head');
    range = [`${base}...${head}`];
  } else if (eventName === 'merge_group') {
    base = commit(event.merge_group?.base_sha, 'merge group base');
    head = commit(event.merge_group?.head_sha, 'merge group head');
    range = [base, head];
  } else {
    throw new Error(`Unsupported change event: ${eventName}`);
  }
  // A missing merge base, unreadable object, or any diff error must fail this job.
  const paths = git('diff', '--name-only', '-z', '--no-renames', ...range, '--').split('\0').filter(Boolean);
  const has = pattern => paths.some(path => pattern.test(path));
  const ci = has(/^(?:\.github\/|scripts\/ci\/|tsconfig\.base\.json$|package\.json$|\.npmrc$|\.skills-source\.json$)/);
  // Root workspace installs validate the shared lock and workspace manifests.
  const rootDependencies = has(/^(?:package-lock\.json$|apps\/[^/]+\/package\.json$)/);
  // Company freeze SQL lives in phone code but is executed by required API PG.
  const companyPostgres = profile === 'integration' && has(/^services\/phone-adb-controller\/(?:company-config-(?:lib\.js|readiness\.mjs|sync-lib\.js)|__tests__\/company-config(?:-postgres|-sync)?\.test\.mjs)$/);
  // Current customer-service producer is the standalone Android RPA service.
  // Its workflow JSON and backend adapter must exercise both service and API contracts.
  const wechatCs = ci || rootDependencies || has(/^(?:services\/wechat-cs-android\/|apps\/api\/)/);
  const apiOrDashboard = has(/^apps\/(?:api|dashboard)\//);
  const selected = {
    docs_only: profile === 'code' && eventName === 'pull_request' && isDocsOnlyPr(base, head, paths),
    darwin_unrelated: profile === 'code' && eventName === 'pull_request' && isDarwinUnrelatedPr(base, head, paths),
    dashboard: ci || rootDependencies || has(/^apps\/dashboard\//),
    api: ci || rootDependencies || companyPostgres || has(/^apps\/api\//),
    geoai: ci || rootDependencies || has(/^apps\/geoai\//),
    agent: ci || has(/^services\/agent\//) || has(/^apps\/api\/src\/services\/walking-skeleton\.service\.ts$/),
    agent_modules: ci || has(/^services\/agent\//),
    staff_hub: ci || rootDependencies || has(/^apps\/staff-hub\//),
    cs_backend: wechatCs,
    android_cs: wechatCs,
    lead: ci || rootDependencies || apiOrDashboard || has(/^services\/agent\/src\/line02\/reply-poller\.ts$/) || has(/^sprints\/07032333-line02-lead-human-handoff\//),
    lead_windows: false, // The existing Windows evaluator is dispatch-only.
    orphan: ci || rootDependencies || apiOrDashboard,
    android: ci || has(/^services\/agent-android\//),
    ci,
  };
  return Object.fromEntries(contract.routes.map(route => [route, String(selected[route])]));
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    const outputs = detectChanges(process.argv[2], process.env.GITHUB_EVENT_NAME, JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')));
    appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
  } catch (error) {
    console.error(`Change detection FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
