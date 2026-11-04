#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gates } from './required-gate.mjs';
import { classifyAgentChanges } from './wechat-agent-scope.mjs';

const zero = '0'.repeat(40);
function git(...args) { return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
function commit(sha, label) {
  if (typeof sha !== 'string' || !/^[a-fA-F0-9]{40}$/.test(sha) || sha === zero) throw new Error(`Invalid ${label} SHA`);
  git('cat-file', '-e', `${sha}^{commit}`);
  return sha;
}

export function detectChanges(profile, eventName, event) {
  const contract = gates[profile];
  if (!contract) throw new Error(`Unknown gate profile: ${profile}`);
  if (eventName === 'workflow_dispatch' && contract.manual) return Object.fromEntries(contract.routes.map(route => [route, 'true']));
  let base, head, range;
  if (eventName === 'push') {
    head = commit(event.after, 'push head');
    // A branch creation has no base commit; run every check rather than guess a diff.
    if (event.before === zero) return Object.fromEntries(contract.routes.map(route => [route, 'true']));
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
  let agentScope;
  if (profile === 'wechat') {
    // Preserve the fixed-source proof that excludes only identical skill relocations.
    // Merge-group uses a two-commit diff, like push; a non-ancestor base runs Agent.
    agentScope = classifyAgentChanges({ repoRoot: process.cwd(), base, head, event: eventName === 'merge_group' ? 'push' : eventName });
    if (process.env.CI_SCOPE_PROOF) writeFileSync(process.env.CI_SCOPE_PROOF, JSON.stringify(agentScope, null, 2) + '\n');
  }
  const apiOrDashboard = has(/^apps\/(?:api|dashboard)\//);
  const selected = {
    dashboard: ci || rootDependencies || has(/^apps\/dashboard\//),
    api: ci || rootDependencies || has(/^apps\/api\//),
    geoai: ci || rootDependencies || has(/^apps\/geoai\//),
    agent: agentScope ? agentScope.agent : ci || has(/^services\/agent\//) || has(/^apps\/api\/src\/services\/walking-skeleton\.service\.ts$/),
    agent_modules: ci || has(/^services\/agent\//),
    staff_hub: ci || rootDependencies || has(/^apps\/staff-hub\//),
    agent_or_api: ci || rootDependencies || agentScope?.agent === true || has(/^(?:services\/agent\/|apps\/api\/)/),
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
