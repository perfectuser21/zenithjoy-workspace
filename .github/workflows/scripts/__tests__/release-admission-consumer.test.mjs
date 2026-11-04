import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseContract } from '../../../../scripts/release-gate/acceptance-record.mjs';
const sha = 'a'.repeat(40), repo = 'perfectuser21/zenithjoy-workspace';
function receipt() { const c=releaseContract(['api','dashboard']);return {run:{id:'run-id',run_key:'release-check',status:'adjudicated',gp_id:'gp',detail:{source_repo:repo,environment:'staging',release_targets:['api','dashboard'],backend_sha:sha,backend_sha_src2:sha,frontend_sha:sha,frontend_sha_src2:sha,spec_sha:c.spec_sha,gate_verdict:'绿'}}, checks:c.checks.map(x=>({...x,run_id:'run-id',result:'通过',note:'evidence://result/'+x.check_key}))}; }

// Exercise the actual mandatory Brain step, with only SSH/HTTP transport isolated.
// No machine, credential store, real Brain endpoint or publication is contacted.
for (const [label,mutate,pass] of [
 ['same-SHA frozen S2/S3',()=>{},true],
 ['missing S2',r=>r.checks=r.checks.filter(c=>c.check_key!=='S2-c1'),false],
 ['missing S3',r=>r.checks=r.checks.filter(c=>c.check_key!=='S3-c1'),false],
 ['different candidate',r=>r.run.detail.backend_sha='b'.repeat(40),false],
]) test('mandatory current business acceptance actual workflow step: '+label,async t=>{
 const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');const {createHash}=await import('node:crypto');
 const {default:YAML}=await import('yaml');
 const workflow=YAML.parse(readFileSync(new URL('../../release-admission.yml',import.meta.url),'utf8'));
 const job=workflow.jobs.admission,step=job.steps.find(s=>s.name==='Read frozen business acceptance from Brain');assert.ok(step);
 assert.equal(job['continue-on-error'],undefined);assert.equal(step['continue-on-error'],undefined);assert.equal(step.if,undefined);
 assert.equal(step.env.SHA,'${{ steps.staging.outputs.sha }}');assert.equal(step.env.RUN_KEY,'${{ inputs.acceptance_run_key }}');
 const dir=mkdtempSync(join(tmpdir(),'mandatory-release-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const bin=join(dir,'bin');mkdirSync(bin);
 const record=receipt();mutate(record);const recordFile=join(dir,'record.json');writeFileSync(recordFile,JSON.stringify(record));const calls=join(dir,'calls.jsonl');
 const preload=join(dir,'http-boundary.mjs');writeFileSync(preload,`import{readFileSync}from'node:fs';globalThis.fetch=async url=>{if(String(url)!=='http://localhost:5221/api/brain/acceptance/runs/release-check')throw Error('Unexpected Brain route');return{ok:true,json:async()=>JSON.parse(readFileSync(process.env.RELEASE_FIXTURE_RECORD,'utf8'))}};`);
 writeFileSync(join(bin,'ssh'),'#!'+process.execPath+'\n'+`const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),args=process.argv.slice(2),source=fs.readFileSync(0);fs.appendFileSync(process.env.RELEASE_FIXTURE_CALLS,JSON.stringify({args,source_sha256:crypto.createHash('sha256').update(source).digest('hex')})+'\\n');const n=args.indexOf('node');if(n<0)process.exit(70);const r=cp.spawnSync(process.execPath,['--import',process.env.RELEASE_FIXTURE_PRELOAD,...args.slice(n+1)],{input:source,stdio:['pipe','inherit','inherit'],env:process.env});process.exit(r.status??71);\n`,{mode:0o755});
 const r=spawnSync('bash',['-e','-o','pipefail','-c',step.run],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:bin+':'+process.env.PATH,SHA:sha,TARGETS:'api,dashboard',RUN_KEY:'release-check',SSH_KEY:'offline-fixture-not-a-key',SSH_USER:'fixture',SSH_HOST:'fixture.invalid',RELEASE_FIXTURE_RECORD:recordFile,RELEASE_FIXTURE_CALLS:calls,RELEASE_FIXTURE_PRELOAD:preload}});
 assert.ifError(r.error);assert.equal(r.status===0,pass,r.stdout+r.stderr);
 const observed=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);assert.equal(observed.length,1);
 assert.equal(observed[0].source_sha256,createHash('sha256').update(readFileSync(new URL('../../../../scripts/release-gate/acceptance-record.mjs',import.meta.url))).digest('hex'));
 assert.equal(existsSync(observed[0].args[observed[0].args.indexOf('-i')+1]),false,'temporary SSH key fixture cleaned');
});
