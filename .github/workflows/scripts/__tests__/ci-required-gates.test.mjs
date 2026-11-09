import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const profiles = [
  { name: 'code', file: 'ci-l3-code.yml', gate: 'l3-passed', routes: ['dashboard', 'api', 'geoai', 'ci', 'agent_modules'], always: ['security', 'openclaw-scripts-test', 'collection-phone-darwin-test', 'public-code-phone-darwin-test', 'epoch-resume-darwin-test', 'epoch-continuation-darwin-test', 'native-103-darwin-test', 'api-scripts-test'] },
  { name: 'runtime', file: 'ci-l4-runtime.yml', gate: 'l4-passed', routes: ['dashboard', 'api', 'agent', 'ci', 'staff_hub'], always: [] },
  { name: 'integration', file: 'ci-l4-integration.yml', gate: 'integration-gate', routes: ['api'], always: [] },
];
function workflow(p) {
  const source = process.env.CI_GATE_TEST_BASELINE
    ? git(root, ['show', `${process.env.CI_GATE_TEST_BASELINE}:.github/workflows/${p.file}`])
    : readFileSync(join(root, '.github/workflows', p.file), 'utf8');
  return parse(source);
}
function temp(fn) { const dir = mkdtempSync(join(tmpdir(), 'ci-gate-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } }
function contextValue(expression, context) {
  if (expression === 'toJSON(needs)') return JSON.stringify(context.needs);
  return expression.split('.').reduce((v, k) => v?.[k], context) ?? '';
}
function render(value, context) { return value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, expression) => contextValue(expression, context)); }
function runStep(step, context, cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  for (const [key, value] of Object.entries(step.env ?? {})) env[key] = render(String(value), context);
  return spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', render(step.run, context)], { cwd, env, encoding: 'utf8' });
}
function gate(p, { result = 'success', outputs = Object.fromEntries(p.routes.map(k => [k, 'false'])), jobs = {}, absentJobs = [], workflowOverride } = {}) {
  const w = workflowOverride ?? workflow(p);
  const needs = Object.fromEntries(w.jobs[p.gate].needs.map(k => [k, { result: p.always.includes(k) ? 'success' : 'skipped' }]));
  needs.changes = { result, outputs };
  for (const [key, value] of Object.entries(jobs)) needs[key] = { result: value };
  for (const key of absentJobs) delete needs[key];
  const step = w.jobs[p.gate].steps.find(s => s.run);
  return runStep(step, { needs }, root);
}
function git(cwd, args, input) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input, env: { ...process.env, GIT_AUTHOR_NAME: 'CI fixture', GIT_AUTHOR_EMAIL: 'ci@example.test', GIT_COMMITTER_NAME: 'CI fixture', GIT_COMMITTER_EMAIL: 'ci@example.test' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(dir, path) {
  git(dir, ['init', '-q']);
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  git(dir, ['add', '.']);
  const base = git(dir, ['commit-tree', git(dir, ['write-tree']), '-m', 'base']);
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), 'changed\n');
  git(dir, ['add', '.']);
  const head = git(dir, ['commit-tree', git(dir, ['write-tree']), '-p', base, '-m', 'head']);
  git(dir, ['update-ref', 'refs/remotes/origin/main', base]);
  git(dir, ['update-ref', 'refs/heads/change', head]);
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/change']);
  if (existsSync(join(root, 'scripts/ci'))) {
    mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
    cpSync(join(root, 'scripts/ci'), join(dir, 'scripts/ci'), { recursive: true });
  }
  return { base, head };
}
function detect(p, dir, eventName, event, baseRef = 'main') {
  const output = join(dir, 'outputs');
  writeFileSync(output, '');
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify(event));
  const step = workflow(p).jobs.changes.steps.find(s => s.id === 'filter');
  const result = runStep(step, { github: { event_name: eventName, event, base_ref: baseRef } }, dir, { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output });
  result.outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('=')));
  return result;
}
for (const p of profiles) {
  test(`${p.name}: a valid empty diff can skip only conditional jobs`, () => assert.equal(gate(p).status, 0));
  for (const result of ['failure', 'cancelled', 'skipped', '']) {
    test(`${p.name}: changes ${result || 'empty'} must close the gate`, () => assert.notEqual(gate(p, { result }).status, 0));
  }
  for (const job of workflow(p).jobs[p.gate].needs.filter(key => workflow(p).jobs[key]?.if)) {
    for (const result of ['failure', 'cancelled']) {
      test(`${p.name}: unselected ${job} ${result} still rejects the gate`, () => {
        assert.notEqual(gate(p, { jobs: { [job]: result } }).status, 0);
      });
    }
    test(`${p.name}: unselected ${job} may be skipped or absent`, () => {
      assert.equal(gate(p, { jobs: { [job]: 'skipped' } }).status, 0);
      assert.equal(gate(p, { absentJobs: [job] }).status, 0);
    });
  }
  for (const route of p.routes) {
    for (const invalid of [undefined, '', 'TRUE', 'unexpected']) {
      test(`${p.name}: reject ${route} output ${String(invalid)}`, () => {
        const outputs = Object.fromEntries(p.routes.map(k => [k, 'false']));
        if (invalid === undefined) delete outputs[route]; else outputs[route] = invalid;
        assert.notEqual(gate(p, { outputs }).status, 0);
      });
    }
  }
  for (const route of p.routes) {
    test(`${p.name}: ${route} selection agrees with real workflow job conditions`, () => {
      const w = workflow(p);
      const outputs = Object.fromEntries(p.routes.map(k => [k, k === route ? 'true' : 'false']));
      const needs = { changes: { outputs } };
      const jobs = {};
      for (const key of w.jobs[p.gate].needs.filter(k => k !== 'changes')) {
        const condition = w.jobs[key].if;
        const selected = !condition || Function('needs', `return (${condition})`)(needs);
        jobs[key] = selected ? 'success' : 'skipped';
      }
      assert.equal(gate(p, { outputs, jobs }).status, 0, JSON.stringify(jobs));
      for (const [key, result] of Object.entries(jobs)) {
        if (result === 'success') assert.notEqual(gate(p, { outputs, jobs: { ...jobs, [key]: 'failure' } }).status, 0, key);
      }
    });
  }
  test(`${p.name}: selected jobs must all succeed`, () => {
    const w = workflow(p);
    const outputs = Object.fromEntries(p.routes.map(k => [k, 'true']));
    const jobs = Object.fromEntries(w.jobs[p.gate].needs.filter(k => k !== 'changes').map(k => [k, 'success']));
    assert.equal(gate(p, { outputs, jobs }).status, 0);
    for (const job of Object.keys(jobs)) for (const result of ['failure', 'cancelled', 'skipped', '']) {
      assert.notEqual(gate(p, { outputs, jobs: { ...jobs, [job]: result } }).status, 0, `${job}=${result}`);
    }
  });
  for (const [path, route] of [
    ['apps/api/src/a.ts', 'api'], ['package-lock.json', 'api'], ['package.json', 'api'], ['.npmrc', 'api'], ['.skills-source.json', 'api'], ['apps/creator/package.json', 'api'], ['.github/workflows/ci-l4-integration.yml', 'api'], ['scripts/ci/detect-changes.mjs', 'api'],
    ...(p.name !== 'integration' ? [['package-lock.json', 'dashboard'], ['apps/creator/package.json', 'dashboard']] : []),
    ...(p.name === 'code' ? [['apps/geoai/astro.config.mjs', 'geoai'], ['package-lock.json', 'geoai'], ['apps/creator/package.json', 'geoai'], ['services/agent/package-lock.json', 'agent_modules'], ['services/agent/package.json', 'agent_modules'], ['services/agent/tsconfig.build.json', 'agent_modules']] : []),
    ...(p.name === 'runtime' ? [['apps/staff-hub/src/pages/HomePage.tsx', 'staff_hub'], ['package-lock.json', 'staff_hub'], ['services/agent/package-lock.json', 'agent'], ['apps/api/src/services/walking-skeleton.service.ts', 'agent']] : []),
  ]) {
    for (const eventName of ['push', 'pull_request', 'merge_group']) {
      test(`${p.name}: ${eventName} routes real diff ${path} -> ${route}`, () => temp(dir => {
        const { base, head } = fixture(dir, path);
        const event = { before: base, after: head, pull_request: { base: { sha: base }, head: { sha: head } }, merge_group: { base_sha: base, head_sha: head } };
        const result = detect(p, dir, eventName, event, eventName === 'merge_group' ? '' : 'main');
        assert.equal(result.status, 0, result.stderr);
        assert.equal(result.outputs[route], 'true', `${JSON.stringify(result.outputs)}\n${result.stderr}`);
        for (const routeName of p.routes) assert.match(result.outputs[routeName] ?? '', /^(true|false)$/);
      }));
    }
  }
  test(`${p.name}: valid PR commits without a merge base fail closed`, () => temp(dir => {
    const { base } = fixture(dir, 'apps/api/src/a.ts');
    const unrelated = git(dir, ['commit-tree', git(dir, ['write-tree']), '-m', 'unrelated root']);
    const result = detect(p, dir, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: unrelated } } });
    assert.notEqual(result.status, 0, result.stdout);
  }));
  for (const eventName of ['push', 'pull_request', 'merge_group']) {
    test(`${p.name}: ${eventName} no diff stays false`, () => temp(dir => {
      const { base, head } = fixture(dir, 'apps/api/src/a.ts');
      // The event SHAs are authoritative even when checkout HEAD has extra changes.
      const result = detect(p, dir, eventName, { before: base, after: base, pull_request: { base: { sha: base }, head: { sha: base } }, merge_group: { base_sha: base, head_sha: base } });
      assert.equal(result.status, 0, result.stderr);
      for (const route of p.routes) assert.equal(result.outputs[route], 'false');
    }));
    for (const invalid of ['', '0'.repeat(40), 'f'.repeat(40), 'HEAD']) {
      test(`${p.name}: ${eventName} invalid/missing head ${invalid} fails closed`, () => temp(dir => {
        const { base } = fixture(dir, 'apps/api/src/a.ts');
        const result = detect(p, dir, eventName, { before: base, after: invalid, pull_request: { base: { sha: base }, head: { sha: invalid } }, merge_group: { base_sha: base, head_sha: invalid } });
        assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      }));
    }
  }
  for (const eventName of ['push', 'pull_request', 'merge_group']) {
    for (const invalid of ['', '0'.repeat(40), 'f'.repeat(40), 'HEAD']) {
      if (eventName === 'push' && invalid === '0'.repeat(40)) continue;
      test(`${p.name}: ${eventName} invalid/missing base ${invalid} fails closed`, () => temp(dir => {
        const { head } = fixture(dir, 'apps/api/src/a.ts');
        const result = detect(p, dir, eventName, { before: invalid, after: head, pull_request: { base: { sha: invalid }, head: { sha: head } }, merge_group: { base_sha: invalid, head_sha: head } });
        assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      }));
    }
  }
  test(`${p.name}: new branch push populates every route`, () => temp(dir => {
    const { head } = fixture(dir, 'apps/api/src/a.ts');
    const result = detect(p, dir, 'push', { before: '0'.repeat(40), after: head });
    assert.equal(result.status, 0, result.stderr);
    for (const route of p.routes) assert.equal(result.outputs[route], 'true');
  }));
  test(`${p.name}: neighboring paths do not select API`, () => temp(dir => {
    const { base, head } = fixture(dir, 'apps/api-old/src/a.ts');
    const result = detect(p, dir, 'push', { before: base, after: head });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.api, 'false');
  }));
}

// Execute the actual required YAML shell; optional success alone is not this edge.
const runtime = profiles.find(p => p.name === 'runtime');
const runtimeContracts = {
  'dashboard-operations-ui': ['dashboard', 'ci'],
  'staff-skill-eval-ui': ['staff_hub', 'api', 'ci'],
  'agent-windows-contracts': ['agent', 'ci'],
};
function selectedRuntimeJobs(outputs) {
  const w = workflow(runtime), needs = {changes:{outputs}};
  return Object.fromEntries(w.jobs[runtime.gate].needs.filter(k => k !== 'changes').map(k => {
    const condition = w.jobs[k]?.if;
    return [k, !condition || Function('needs', 'return (' + condition + ')')(needs) ? 'success' : 'skipped'];
  }));
}
for (const [job, routes] of Object.entries(runtimeContracts)) {
  for (const route of routes) {
    test('runtime consumer: '+route+' requires '+job+' success through actual YAML', () => {
      const outputs = Object.fromEntries(runtime.routes.map(k => [k, k === route ? 'true' : 'false']));
      const jobs = {...selectedRuntimeJobs(outputs), [job]:'success'};
      assert.equal(gate(runtime,{outputs,jobs}).status,0);
      for (const result of ['skipped','failure','cancelled','']) {
        const r=gate(runtime,{outputs,jobs:{...jobs,[job]:result}});
        assert.notEqual(r.status,0,job+'='+result+' was accepted for '+route);
      }
      assert.notEqual(gate(runtime,{outputs,jobs,absentJobs:[job]}).status,0,job+' missing was accepted for '+route);
    });
  }
  test('runtime consumer: unrelated changes can skip '+job+'; detection failure closes gate', () => {
    const outputs = Object.fromEntries(runtime.routes.map(k => [k,'false']));
    assert.equal(gate(runtime,{outputs,jobs:{[job]:'skipped'}}).status,0);
    for(const result of ['failure','cancelled','skipped'])assert.notEqual(gate(runtime,{outputs,jobs:{[job]:'skipped'},result}).status,0);
  });
}
test('runtime consumers have reusable workflows and required needs edges, retaining manual entry', () => {
  const w=workflow(runtime);
  const files={
    'dashboard-operations-ui':'e2e-dashboard-operations-windows.yml',
    'staff-skill-eval-ui':'e2e-staff-skill-eval.yml',
    'agent-windows-contracts':'agent-qr-windows-verify.yml',
  };
  for(const [job,file] of Object.entries(files)){
    assert.ok(w.jobs[runtime.gate].needs.includes(job),job);
    assert.equal(w.jobs[job].uses,'./.github/workflows/'+file);
    assert.equal(w.jobs[job].needs,'changes');
    const called=parse(readFileSync(join(root,'.github/workflows',file),'utf8'));
    assert.ok(Object.hasOwn(called.on,'workflow_call'),file);
    assert.ok(Object.hasOwn(called.on,'workflow_dispatch'),file);
    assert.ok(!Object.hasOwn(called.on,'pull_request'),file);
    assert.ok(!Object.hasOwn(called.on,'push'),file);
  }
});
for (const [job,routes] of Object.entries(runtimeContracts)) {
  test('runtime consumer: removing real YAML admission reproduces skipped '+job+' false green', () => {
    const outputs=Object.fromEntries(runtime.routes.map(k=>[k,k===routes[0]?'true':'false']));
    const jobs={...selectedRuntimeJobs(outputs),[job]:'skipped'};
    assert.notEqual(gate(runtime,{outputs,jobs}).status,0);
    const mutated=structuredClone(workflow(runtime));
    mutated.jobs[runtime.gate].steps.find(s=>s.run).run='node scripts/ci/required-gate.mjs runtime';
    assert.equal(gate(runtime,{outputs,jobs,workflowOverride:mutated}).status,0,
      'control must expose the original missing-UI-admission bug');
  });
}


test('Windows handler reusable call runs contracts while candidate files require standalone manual version', () => {
  const called=parse(readFileSync(join(root,'.github/workflows/agent-qr-windows-verify.yml'),'utf8'));
  assert.ok(Object.hasOwn(called.on,'workflow_call'));
  assert.equal(called.jobs['unit-tests-windows'].if,undefined);
  assert.equal(called.on.workflow_dispatch.inputs.version.required,true);
  assert.equal(called.on.workflow_dispatch.inputs.version.type,'string');
  assert.equal(called.on.workflow_call?.inputs?.version,undefined);
  const condition=called.jobs['sandbox-install'].if;
  const selected=(event,inputs={})=>Boolean(Function('github','inputs','return ('+condition+')')({event_name:event},inputs));
  for(const event of ['pull_request','push','merge_group','workflow_call']){
    assert.equal(selected(event),false,event+' must not download candidate files');
    assert.equal(selected(event,{version:'1.2.3'}),false,event+' must stay files-only manual');
  }
  assert.equal(selected('workflow_dispatch'),false,'a reusable caller with no version must not download');
  assert.equal(selected('workflow_dispatch',{version:'1.2.3'}),true);
  assert.equal(workflow(runtime).jobs['agent-windows-contracts'].with,undefined);
});

test('epoch native Darwin required gate拒绝missing/skipped/failure/cancelled，成功才可准入',async()=>{const {checkGate,gates}=await import('../../../../scripts/ci/required-gate.mjs');const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}])),'epoch-resume-darwin-test':{result:'success'}};assert.doesNotThrow(()=>checkGate('code',needs));for(const state of [undefined,'skipped','failure','cancelled']){const bad=structuredClone(needs);if(state===undefined)delete bad['epoch-resume-darwin-test'];else bad['epoch-resume-darwin-test'].result=state;assert.throws(()=>checkGate('code',bad),/epoch-resume-darwin-test/);}});

test('stop-only continuation独立Darwin必须成功，missing/skipped/failure/cancelled均拒绝',async()=>{const {checkGate,gates}=await import('../../../../scripts/ci/required-gate.mjs');assert.ok(gates.code.always.includes('epoch-continuation-darwin-test'));const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}]))};assert.doesNotThrow(()=>checkGate('code',needs));for(const state of [undefined,'skipped','failure','cancelled']){const bad=structuredClone(needs);if(state===undefined)delete bad['epoch-continuation-darwin-test'];else bad['epoch-continuation-darwin-test'].result=state;assert.throws(()=>checkGate('code',bad),/epoch-continuation-darwin-test/);}});
