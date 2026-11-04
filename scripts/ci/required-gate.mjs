#!/usr/bin/env node
// The same selection contract drives all three required aggregate checks.
export const gates = {
  wechat: {
    routes: ['agent_or_api', 'agent'],
    conditional: { 'middleware-chain': 'agent_or_api', 'agent-windows': 'agent', 'bubble-read-gate': 'agent' },
    always: [], manual: true,
  },
  lead: { routes: ['lead', 'lead_windows'], conditional: { e2e: 'lead', 'e2e-windows': 'lead_windows' }, always: [], manual: true },
  orphan: { routes: ['orphan'], conditional: { 'playwright-orphan-consolidation': 'orphan' }, always: [], manual: true },
  android: { routes: ['android'], conditional: { 'test-and-build': 'android' }, always: [] },
  code: {
    routes: ['dashboard', 'api', 'geoai', 'ci', 'agent_modules'],
    conditional: {
      'dashboard-lint': 'dashboard', 'dashboard-typecheck': 'dashboard', 'dashboard-build': 'dashboard',
      'api-lint': 'api', 'api-typecheck': 'api', 'geoai-build': 'geoai', 'line-module-build': 'agent_modules',
    },
    always: ['security', 'openclaw-scripts-test', 'collection-phone-darwin-test', 'api-scripts-test'],
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

export function checkGate(profile, needs) {
  const contract = gates[profile];
  if (!contract) throw new Error(`Unknown gate profile: ${profile}`);
  if (needs?.changes?.result !== 'success') throw new Error('Detect Changes must succeed');
  const outputs = needs.changes.outputs;
  for (const route of contract.routes) {
    if (outputs?.[route] !== 'true' && outputs?.[route] !== 'false') throw new Error(`Invalid or missing change output: ${route}`);
  }
  const required = [...contract.always, ...Object.entries(contract.conditional)
    .filter(([, route]) => outputs[route] === 'true' || outputs.ci === 'true')
    .map(([job]) => job)];
  const failed = required.filter(job => needs[job]?.result !== 'success');
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
