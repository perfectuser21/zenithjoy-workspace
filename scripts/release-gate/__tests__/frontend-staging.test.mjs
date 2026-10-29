import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const load = file => JSON.parse(execFileSync('python3',['-c',
 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',file],{encoding:'utf8'}));

test('dashboard staging builds the requested commit even after main advances',async()=>{
 const root=await mkdtemp(join(tmpdir(),'staging-fixed-sha-'));
 try {
  const source=join(root,'source'), runner=join(root,'runner'), bin=join(root,'bin'), temp=join(root,'temp');
  await Promise.all([source,bin,temp].map(p=>mkdir(p,{recursive:true})));
  const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
  const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',env}).trim();
  git(source,'init','-b','main');git(source,'config','user.name','Test');git(source,'config','user.email','test@example.invalid');
  await mkdir(join(source,'deploy'));await writeFile(join(source,'deploy','nginx.staging.conf'),'test nginx');
  await writeFile(join(source,'source.txt'),'candidate A');git(source,'add','.');git(source,'commit','-m','candidate A');const candidate=git(source,'rev-parse','HEAD');
  await writeFile(join(source,'source.txt'),'main B');git(source,'commit','-am','main B');const latest=git(source,'rev-parse','HEAD');
  execFileSync('git',['clone','--quiet',source,runner],{env});git(runner,'checkout','--quiet',candidate);
  await writeFile(join(bin,'npm'),'#!/bin/sh\nif [ "$1" = run ]; then mkdir -p apps/dashboard/dist; cp source.txt apps/dashboard/dist/index.html; fi\n',{mode:0o755});
  const workflow=load(resolve('.github/workflows/deploy-dashboard-staging.yml'));
  const job=workflow.jobs['deploy-staging-dashboard'];
  assert.equal(job.steps.find(s=>s.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.sha }}');
  const script=job.steps.find(s=>s.name==='Build exact candidate on runner').run;
  await exec('bash',['-e','-c',script],{cwd:runner,env:{...env,DEPLOY_SHA:candidate,RUNNER_TEMP:temp,PATH:`${bin}:${env.PATH}`}});
  assert.equal(await readFile(join(temp,'dashboard-bundle','dist','index.html'),'utf8'),'candidate A');
  assert.equal(JSON.parse(await readFile(join(temp,'dashboard-bundle','dist','release-sha.json'),'utf8')).sha,candidate);
  assert.equal(git(source,'rev-parse','HEAD'),latest);
  assert.ok((await readFile(join(temp,'dashboard-staging.tar.gz'))).length>0);
  await assert.rejects(exec('bash',['-e','-c',script],{cwd:runner,env:{...env,DEPLOY_SHA:latest,RUNNER_TEMP:temp,PATH:`${bin}:${env.PATH}`}}));
 } finally {await rm(root,{recursive:true,force:true});}
});
