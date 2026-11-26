#!/usr/bin/env node
// The same selection contract drives all three required aggregate checks.
const darwinJobs = [
  'collection-phone-darwin-test', 'public-code-phone-darwin-test',
  'epoch-resume-darwin-test', 'epoch-continuation-darwin-test', 'epoch-private-recovery-darwin-test',
  'native-103-darwin-test',
];
const codeFullJobs = ['openclaw-scripts-test', ...darwinJobs];

export const gates = {
  wechat: {
    routes: ['cs_backend', 'android_cs'],
    conditional: { 'middleware-chain': 'cs_backend', 'android-cs': 'android_cs' },
    always: [], manual: true,
  },
  lead: { routes: ['lead', 'lead_windows'], conditional: { e2e: 'lead', 'e2e-windows': 'lead_windows' }, always: [], manual: true },
  orphan: { routes: ['orphan'], conditional: { 'playwright-orphan-consolidation': 'orphan' }, always: [], manual: true },
  android: { routes: ['android'], conditional: { 'test-and-build': 'android' }, always: [] },
  code: {
    routes: ['dashboard', 'api', 'geoai', 'ci', 'agent_modules', 'docs_only', 'darwin_unrelated'],
    conditional: {
      'dashboard-build': 'dashboard',
      'api-lint': 'api', 'geoai-build': 'geoai', 'line-module-build': 'agent_modules',
    },
    always: ['security', 'api-scripts-test', ...codeFullJobs],
  },
  runtime: {
    routes: ['dashboard', 'api', 'agent', 'ci', 'staff_hub'],
    conditional: { 'dashboard-test': 'dashboard', 'api-test': 'api', 'agent-test': 'agent', 'windows-process-cleanup': 'agent', 'staff-hub-test': 'staff_hub' },
    always: [],
  },
  integration: {
    routes: ['api'],
    conditional: { 'api-integration-test': 'api' },
    always: [],
  },
};

export function checkGate(profile, needs, eventName = process.env.GITHUB_EVENT_NAME) {
  const contract = gates[profile];
  if (!contract) throw new Error(`Unknown gate profile: ${profile}`);
  if (needs?.changes?.result !== 'success') throw new Error('Detect Changes must succeed');
  const outputs = needs.changes.outputs;
  for (const route of contract.routes) {
    if (outputs?.[route] !== 'true' && outputs?.[route] !== 'false') throw new Error(`Invalid or missing change output: ${route}`);
  }
  const docsOnly = profile === 'code' && outputs.docs_only === 'true';
  if (docsOnly && (eventName !== 'pull_request' || contract.routes.some(route => route !== 'docs_only' && outputs[route] === 'true'))) {
    throw new Error('Invalid docs-only change selection');
  }
  const darwinUnrelated = profile === 'code' && outputs.darwin_unrelated === 'true';
  if (darwinUnrelated && (eventName !== 'pull_request' || outputs.dashboard !== 'true' ||
    ['api', 'geoai', 'ci', 'agent_modules', 'docs_only'].some(route => outputs[route] === 'true'))) {
    throw new Error('Invalid Darwin-unrelated change selection');
  }
  const required = [...contract.always, ...Object.entries(contract.conditional)
    .filter(([, route]) => outputs[route] === 'true' || outputs.ci === 'true')
    .map(([job]) => job)];
  const failed = required.filter(job => {
    const result = needs[job]?.result;
    const maySkip = (docsOnly && codeFullJobs.includes(job)) || (darwinUnrelated && darwinJobs.includes(job));
    return result !== 'success' && !(maySkip && result === 'skipped');
  });
  for (const [job, state] of Object.entries(needs)) {
    if (['failure', 'cancelled'].includes(state?.result) && !failed.includes(job)) failed.push(job);
  }
  if (failed.length) throw new Error(`Required jobs did not succeed: ${failed.map(job => `${job}=${needs[job]?.result ?? 'missing'}`).join(', ')}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  try {
    checkGate(process.argv[2], JSON.parse(process.env.GATE_NEEDS));
    console.log(`${process.argv[2]} gate PASSED`);
  } catch (error) {
    console.error(`Gate FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
