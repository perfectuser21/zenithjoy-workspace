import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, cpSync, symlinkSync, renameSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { AUTHORING_FILES } from '../../../../scripts/ci/authoring-source-version.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const profiles = [
  { name: 'code', file: 'ci-l3-code.yml', gate: 'l3-passed', routes: ['dashboard', 'api', 'geoai', 'ci', 'agent_modules', 'docs_only', 'darwin_unrelated'], always: ['security', 'openclaw-scripts-test', 'collection-phone-darwin-test', 'public-code-phone-darwin-test', 'epoch-resume-darwin-test', 'epoch-continuation-darwin-test', 'epoch-private-recovery-darwin-test', 'native-103-darwin-test', 'api-scripts-test'] },
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
function gate(p, { result = 'success', outputs = Object.fromEntries(p.routes.map(k => [k, 'false'])), jobs = {}, absentJobs = [], workflowOverride, eventName = 'pull_request' } = {}) {
  const w = workflowOverride ?? workflow(p);
  const needs = Object.fromEntries(w.jobs[p.gate].needs.map(k => [k, { result: p.always.includes(k) ? 'success' : 'skipped' }]));
  needs.changes = { result, outputs };
  for (const [key, value] of Object.entries(jobs)) needs[key] = { result: value };
  for (const key of absentJobs) delete needs[key];
  const step = w.jobs[p.gate].steps.find(s => s.run);
  return runStep(step, { needs }, root, { GITHUB_EVENT_NAME: eventName });
}
function git(cwd, args, input) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', input, env: { ...process.env, GIT_AUTHOR_NAME: 'CI fixture', GIT_AUTHOR_EMAIL: 'ci@example.test', GIT_COMMITTER_NAME: 'CI fixture', GIT_COMMITTER_EMAIL: 'ci@example.test' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(dir, path, before = () => {}, after = () => {}) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'core.filemode', 'true']);
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  before();
  git(dir, ['add', '.']);
  const base = git(dir, ['commit-tree', git(dir, ['write-tree']), '-m', 'base']);
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), 'changed\n');
  after();
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
    if (p.always.includes(job)) continue;
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
  for (const route of p.routes.filter(route => !['docs_only', 'darwin_unrelated'].includes(route))) {
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
    const outputs = Object.fromEntries(p.routes.map(k => [k, String(!['docs_only', 'darwin_unrelated'].includes(k))]));
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
    for (const route of p.routes) assert.equal(result.outputs[route], String(!['docs_only', 'darwin_unrelated'].includes(route)));
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

test('private session诊断恢复独立原生门必须成功且不接受缺失或跳过',async()=>{const {checkGate,gates}=await import('../../../../scripts/ci/required-gate.mjs');const key='epoch-private-recovery-darwin-test';assert.ok(gates.code.always.includes(key));const needs={changes:{result:'success',outputs:Object.fromEntries(gates.code.routes.map(k=>[k,'false']))},...Object.fromEntries(gates.code.always.map(k=>[k,{result:'success'}]))};assert.doesNotThrow(()=>checkGate('code',needs));for(const status of [undefined,'skipped','failure','cancelled']){const bad=structuredClone(needs);if(status===undefined)delete bad[key];else bad[key].result=status;assert.throws(()=>checkGate('code',bad),/epoch-private-recovery-darwin-test/);}});

const code = profiles.find(p => p.name === 'code');
const docsPath = 'docs/android-rpa-execution-modes.md';
const sourceBefore = '{\n  "version": "1.0.3",\n  "runtime": { "version": "2.0.0" }\n}\n';
const sourceAfter = sourceBefore.replace('1.0.3', '1.0.4');
const write = (dir, path, bytes) => {
  const file = join(dir, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
};
const docsEligible = [
  ['standalone prose edit', () => {}, true],
  ['the five L2 version headers progress', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
  }, true],
];
const docsIneligible = [
  ['document added', () => {}, false, dir => rmSync(join(dir, docsPath))],
  ['document removed', dir => rmSync(join(dir, docsPath))],
  ['document renamed', dir => renameSync(join(dir, docsPath), join(dir, 'docs/renamed.md'))],
  ['document symlinked', dir => {
    rmSync(join(dir, docsPath));
    symlinkSync('../README.md', join(dir, docsPath));
  }],
  ['document mode changed', dir => chmodSync(join(dir, docsPath), 0o755)],
  ['other markdown file', dir => write(dir, 'docs/unreviewed.md', 'new\n')],
  ['CI changed', dir => write(dir, '.github/workflows/producer.yml', 'new\n')],
  ['runtime producer changed', dir => write(dir, 'services/phone-adb-controller/public-domain-profile.mjs', 'new\n')],
  ['generated Markdown changed', dir => write(dir, 'product-map/generated/product-map.md', 'new\n')],
  ['version headers without the document', dir => {
    write(dir, docsPath, 'previous prose\n');
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
  }],
  ['partial version headers', dir => write(dir, AUTHORING_FILES[0], sourceAfter)],
  ['all headers changed together with a nested version', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
    write(dir, AUTHORING_FILES[4], sourceAfter.replace('2.0.0', '2.0.1'));
  }],
  ['all headers changed together with one whitespace byte', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
    write(dir, AUTHORING_FILES[4], sourceAfter.replace('"runtime": ', '"runtime":  '));
  }],
  ['version regressed', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
    write(dir, AUTHORING_FILES[4], sourceAfter.replace('1.0.4', '1.0.2'));
  }],
  ['noncanonical version', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
    write(dir, AUTHORING_FILES[4], sourceAfter.replace('1.0.4', '1.0.04'));
  }],
  ['version changed into a symlink', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
    rmSync(join(dir, AUTHORING_FILES[4]));
    symlinkSync('single.json', join(dir, AUTHORING_FILES[4]));
  }],
];
for (const [scenario, change, eligible = false, omitDoc] of [...docsEligible, ...docsIneligible]) {
  test('code routing: ' + scenario, () => temp(dir => {
    const { base, head } = fixture(dir, docsPath, () => {
      write(dir, docsPath, 'previous prose\n');
      for (const path of AUTHORING_FILES) write(dir, path, sourceBefore);
      omitDoc?.(dir);
    }, () => change(dir));
    const output = detect(code, dir, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.outputs.docs_only, String(eligible));
    if (eligible) {
      const jobs = Object.fromEntries(code.always.map(job => [job, 'success']));
      for (const job of code.always.filter(job => !['security', 'api-scripts-test'].includes(job))) {
        const jobConfig = workflow(code).jobs[job];
        assert.equal(jobConfig.needs, 'changes');
        assert.equal(Function('needs', 'return (' + jobConfig.if + ')')({ changes: { outputs: output.outputs } }), false, job);
        jobs[job] = 'skipped';
      }
      assert.equal(gate(code, { outputs: output.outputs, jobs }).status, 0);
      for (const [job, result] of Object.entries(jobs)) {
        for (const failure of ['failure', 'cancelled', ...(result === 'success' ? ['skipped'] : [])]) {
          assert.notEqual(gate(code, { outputs: output.outputs, jobs: { ...jobs, [job]: failure } }).status, 0, job + '=' + failure);
        }
        assert.notEqual(gate(code, { outputs: output.outputs, jobs, absentJobs: [job] }).status, 0, job + ' missing');
      }
      for (const eventName of ['push', 'merge_group']) {
        assert.notEqual(gate(code, { outputs: output.outputs, jobs, eventName }).status, 0);
      }
      const incompatible = { ...output.outputs, ci: 'true' };
      assert.notEqual(gate(code, { outputs: incompatible, jobs }).status, 0);
    } else {
      const heavy = 'openclaw-scripts-test';
      assert.equal(gate(code, { outputs: output.outputs, jobs: { [heavy]: 'skipped' } }).status, 1);
    }
  }));
}

test('code routing: other event types and PR checkout drift retain full coverage', () => temp(dir => {
  const { base, head } = fixture(dir, docsPath, () => write(dir, docsPath, 'old prose\n'));
  const event = { before: base, after: head, merge_group: { base_sha: base, head_sha: head }, pull_request: { base: { sha: base }, head: { sha: head } } };
  for (const eventName of ['push', 'merge_group']) {
    const result = detect(code, dir, eventName, event, eventName === 'merge_group' ? '' : 'main');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.docs_only, 'false');
  }

  // GitHub checks out a synthetic merge commit for PR workflows.
  const merge = git(dir, ['commit-tree', git(dir, ['rev-parse', head + '^{tree}']), '-p', base, '-p', head, '-m', 'Merge PR']);
  git(dir, ['update-ref', 'refs/heads/change', merge]);
  const matched = detect(code, dir, 'pull_request', event);
  assert.equal(matched.status, 0, matched.stderr);
  assert.equal(matched.outputs.docs_only, 'true');

  const advancedBase = git(dir, ['commit-tree', git(dir, ['rev-parse', base + '^{tree}']), '-p', base, '-m', 'Main advanced']);
  const stale = detect(code, dir, 'pull_request', { pull_request: { base: { sha: advancedBase }, head: { sha: head } } });
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(stale.outputs.docs_only, 'false');

  git(dir, ['update-ref', 'refs/heads/change', base]);
  const mismatch = detect(code, dir, 'pull_request', event);
  assert.equal(mismatch.status, 0, mismatch.stderr);
  assert.equal(mismatch.outputs.docs_only, 'false');
}));


test('code routing: Dashboard source skips only the Darwin jobs with exact PR evidence', () => temp(dir => {
  const dashboardPath = 'apps/dashboard/src/pages/Example.tsx';
  const { base, head } = fixture(dir, dashboardPath, () => {
    write(dir, dashboardPath, 'old UI\n');
    for (const path of AUTHORING_FILES) write(dir, path, sourceBefore);
  }, () => {
    write(dir, '.dod-cp-example.md', 'verification\n');
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
  });
  const event = { before: base, after: head, merge_group: { base_sha: base, head_sha: head }, pull_request: { base: { sha: base }, head: { sha: head } } };
  const merge = git(dir, ['commit-tree', git(dir, ['rev-parse', head + '^{tree}']), '-p', base, '-p', head, '-m', 'Merge PR']);
  git(dir, ['update-ref', 'refs/heads/change', merge]);
  const workflowConfig = workflow(code);
  const { status, stderr, outputs } = detect(code, dir, 'pull_request', event);
  assert.equal(status, 0, stderr);
  assert.equal(outputs.darwin_unrelated, 'true');
  assert.equal(outputs.docs_only, 'false');
  const jobs = Object.fromEntries(workflowConfig.jobs[code.gate].needs.filter(k => k !== 'changes').map(k => {
    const condition = workflowConfig.jobs[k].if;
    return [k, !condition || Function('needs', 'return (' + condition + ')')({ changes: { outputs } }) ? 'success' : 'skipped'];
  }));
  const macJobs = code.always.filter(job => workflowConfig.jobs[job]['runs-on'] === 'macos-latest');
  assert.equal(macJobs.length, 6);
  for (const job of macJobs) assert.equal(jobs[job], 'skipped', job);
  assert.equal(gate(code, { outputs, jobs }).status, 0);
  for (const job of ['dashboard-build', 'openclaw-scripts-test', 'api-scripts-test', 'security']) {
    assert.equal(jobs[job], 'success', job);
    assert.notEqual(gate(code, { outputs, jobs: { ...jobs, [job]: 'skipped' } }).status, 0);
  }
  for (const job of macJobs) {
    for (const result of ['failure', 'cancelled', '']) assert.notEqual(gate(code, { outputs, jobs: { ...jobs, [job]: result } }).status, 0);
    assert.notEqual(gate(code, { outputs, jobs, absentJobs: [job] }).status, 0);
  }
  assert.notEqual(gate(code, { outputs: { ...outputs, darwin_unrelated: 'false' }, jobs }).status, 0);
  for (const eventName of ['push', 'merge_group']) {
    assert.equal(detect(code, dir, eventName, event, eventName === 'merge_group' ? '' : 'main').outputs.darwin_unrelated, 'false');
    assert.notEqual(gate(code, { outputs, jobs, eventName }).status, 0);
  }
  for (const invalid of [{ dashboard: 'false' }, { api: 'true' }, { ci: 'true' }, { docs_only: 'true' }]) {
    assert.notEqual(gate(code, { outputs: { ...outputs, ...invalid }, jobs }).status, 0);
  }
  const advancedBase = git(dir, ['commit-tree', git(dir, ['rev-parse', base + '^{tree}']), '-p', base, '-m', 'Main advanced']);
  assert.equal(detect(code, dir, 'pull_request', { pull_request: { base: { sha: advancedBase }, head: { sha: head } } }).outputs.darwin_unrelated, 'false');
  git(dir, ['update-ref', 'refs/heads/change', base]);
  assert.equal(detect(code, dir, 'pull_request', event).outputs.darwin_unrelated, 'false');
}));

test('code routing: standalone Dashboard CSS can skip Darwin', () => temp(dir => {
  const { base, head } = fixture(dir, 'apps/dashboard/src/index.css');
  const result = detect(code, dir, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs.darwin_unrelated, 'true');
}));

for (const path of [
  'apps/dashboard/package.json',
  'apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql',
  'services/phone-adb-controller/phone-lock-root.py',
  'scripts/ci/native-103-darwin-tests.mjs',
  '.github/workflows/ci-l3-code.yml',
  '.skills-source.json',
  'package-lock.json',
  'test-registry.yaml',
  'docs/unrelated-but-unproven.md',
]) {
  test('code routing: the Dashboard shortcut keeps Darwin with ' + path, () => temp(dir => {
    const { base, head } = fixture(dir, 'apps/dashboard/src/pages/Example.tsx', () => {}, () => write(dir, path, 'new\n'));
    const result = detect(code, dir, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.darwin_unrelated, 'false');
  }));
}

for (const [name, change] of [
  ['partial contract headers', dir => write(dir, AUTHORING_FILES[0], sourceAfter)],
  ['contract body changes', dir => {
    for (const path of AUTHORING_FILES) write(dir, path, sourceAfter);
    write(dir, AUTHORING_FILES[0], sourceAfter.replace('2.0.0', '2.0.1'));
  }],
  ['a symlink', (dir, path) => {
    rmSync(join(dir, path));
    symlinkSync('../README.md', join(dir, path));
  }],
  ['a mode change', (dir, path) => chmodSync(join(dir, path), 0o755)],
  ['an unclassified side of a rename', (dir, path) => renameSync(join(dir, 'outside.tsx'), join(dir, path))],
]) {
  test('code routing: the Dashboard shortcut keeps Darwin with ' + name, () => temp(dir => {
    const path = 'apps/dashboard/src/pages/Example.tsx';
    const { base, head } = fixture(dir, path, () => {
      write(dir, path, 'old UI\n');
      write(dir, 'outside.tsx', 'outside\n');
      for (const contract of AUTHORING_FILES) write(dir, contract, sourceBefore);
    }, () => change(dir, path));
    const result = detect(code, dir, 'pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.outputs.darwin_unrelated, 'false');
  }));
}

test('code routing: workflow admission and independent security/patrol checks stay required', () => {
  const w = workflow(code);
  for (const event of ['pull_request', 'push', 'merge_group']) {
    assert.ok(Object.hasOwn(w.on, event));
    assert.equal(w.on[event]?.paths, undefined);
    assert.equal(w.on[event]?.['paths-ignore'], undefined);
  }
  const aggregate = w.jobs[code.gate];
  assert.equal(aggregate.name, 'L3 Code Gate Passed');
  assert.equal(aggregate.if, 'always()');
  assert.equal(aggregate['continue-on-error'], undefined);
  assert.equal(aggregate.steps.find(step => step.run).if, undefined);
  for (const job of ['security', 'api-scripts-test']) {
    assert.ok(aggregate.needs.includes(job));
    assert.equal(w.jobs[job].if, undefined);
    assert.equal(w.jobs[job].needs, undefined);
    assert.equal(w.jobs[job]['continue-on-error'], undefined);
  }
  for (const [job, command] of [
    ['security', 'bash .github/workflows/scripts/audit-gate.sh .'],
    ['security', 'bash .github/workflows/scripts/audit-gate.sh apps/dashboard'],
    ['api-scripts-test', 'node --test scripts/phone-account-patrol/implementation-regression.test.mjs'],
  ]) {
    const step = w.jobs[job].steps.find(step => step.run === command);
    assert.ok(step, command);
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
  }
});
