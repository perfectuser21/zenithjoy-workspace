import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const read=p=>readFileSync(p,'utf8');
const workflow=()=>YAML.parse(read('.github/workflows/ci-l4-e2e-smoke.yml'));
const retired=['cs-account-workbench-smoke.sh','line04-crm-blacklist-ingest-onboarding-smoke.sh','line04-crm-table-identity-smoke.sh'];
function canonicalStep(){const steps=workflow().jobs['smoke-api-contract'].steps.filter(s=>s.run?.includes('business-contracts-smoke.sh'));assert.equal(steps.length,1,'three retired callers share exactly one strict current API canonical');return steps[0];}
test('API contract job replaces retired workbench/CRM callers with current existing canonical source',()=>{
 const source=JSON.stringify(workflow().jobs['smoke-api-contract']);
 for(const file of retired)assert.ok(!source.includes(file),'stale executable caller: '+file);
 assert.match(canonicalStep().run,/bash \.github\/workflows\/scripts\/smoke\/business-contracts-smoke\.sh api/);
 for(const m of source.matchAll(/(?:\.github\/workflows\/scripts\/smoke\/[A-Za-z0-9_-]+\.sh)/g))assert.ok(existsSync(m[0]),'explicit contract source is missing: '+m[0]);
});
for(const code of [0,73])test('actual canonical invocation propagates exit '+code,t=>{
 const step=canonicalStep();const dir=mkdtempSync(join(tmpdir(),'api-canonical-caller-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const bin=join(dir,'bin');mkdirSync(bin);const capture=join(dir,'args');
 writeFileSync(join(bin,'bash'),'#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_ARGS"\n[ "$#" -eq 2 ] || exit 81\n[ "$1" = ".github/workflows/scripts/smoke/business-contracts-smoke.sh" ] || exit 82\n[ "$2" = api ] || exit 83\nexit "$FIXTURE_CANONICAL_EXIT"\n',{mode:0o755});
 const result=spawnSync('/bin/bash',['-e','-o','pipefail','-c',step.run],{encoding:'utf8',env:{...process.env,PATH:bin+':'+process.env.PATH,FIXTURE_ARGS:capture,FIXTURE_CANONICAL_EXIT:String(code)}});
 assert.ifError(result.error);assert.equal(result.status,code,result.stdout+result.stderr);assert.deepEqual(read(capture).trim().split('\n'),['.github/workflows/scripts/smoke/business-contracts-smoke.sh','api']);assert.equal(step['continue-on-error'],undefined);assert.equal(workflow().jobs['smoke-api-contract']['continue-on-error'],undefined);
});
test('shared API selector includes all three current contracts; real PG and UI replacements stay required',()=>{
 const results=JSON.parse(read('docs/ci/round3-business-results.json'));
 for(const id of ['cs-workbench','crm-blacklist-onboarding','crm-identity']){
  const unit=results.units.find(u=>u.unit_id===id);assert.ok(unit);
  const api=unit.canonical_test_paths.filter(p=>p.startsWith('apps/api/')&&!p.includes('/tests/integration/'));
  assert.ok(api.length,'actual API canonical cannot leave '+id+' empty');
  for(const p of unit.canonical_test_paths)assert.ok(existsSync(p),'missing current replacement '+p);
 }
 const integration=YAML.parse(read('.github/workflows/ci-l4-integration.yml'));
 assert.ok(integration.jobs['api-integration-test'].steps.some(s=>s.run?.includes('vitest.business-pg.config.ts')));
 assert.ok(integration.jobs['integration-gate'].needs.includes('api-integration-test'));
 const runtime=YAML.parse(read('.github/workflows/ci-l4-runtime.yml'));
 assert.ok(runtime.jobs['l4-passed'].needs.includes('api-test'));assert.ok(runtime.jobs['l4-passed'].needs.includes('dashboard-test'));
 const gate=workflow().jobs['l4-e2e-passed'];assert.ok(gate.needs.includes('smoke-api-contract'));
});
