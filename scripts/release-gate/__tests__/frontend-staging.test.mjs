import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
const exec=promisify(execFile);
const load = file => JSON.parse(execFileSync('python3',['-c',
 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',file],{encoding:'utf8'}));

test('dashboard staging deploys requested commit even after main advances and leaves shared HEAD untouched',async()=>{
 const root=await mkdtemp(join(tmpdir(),'staging-fixed-sha-'));
 const source=join(root,'source'), stage=join(root,'staging'), bin=join(root,'bin');
 await Promise.all([source,stage,bin].map(p=>mkdir(p,{recursive:true})));
 const git=(...args)=>execFileSync('git',args,{cwd:source,encoding:'utf8'}).trim();
 git('init','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
 await mkdir(join(source,'deploy'));await writeFile(join(source,'deploy','nginx.staging.conf'),'test nginx');
 await writeFile(join(source,'deploy','docker-compose.staging.yml'),'test compose');
 await writeFile(join(source,'source.txt'),'candidate A');git('add','.');git('commit','-m','candidate A');const candidate=git('rev-parse','HEAD');
 await writeFile(join(source,'source.txt'),'main B');git('commit','-am','main B');const latest=git('rev-parse','HEAD');
 git('remote','add','origin',source);
 await writeFile(join(bin,'npm'),'#!/bin/sh\nif [ "$1" = run ]; then mkdir -p apps/dashboard/dist; cp source.txt apps/dashboard/dist/index.html; fi\n',{mode:0o755});
 for(const name of ['docker','sleep'])await writeFile(join(bin,name),'#!/bin/sh\nexit 0\n',{mode:0o755});
 const server=createServer(async(req,res)=>{try{res.end(await readFile(join(stage,'dist',req.url.startsWith('/release-sha.json')?'release-sha.json':'index.html')));}catch{res.statusCode=404;res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const workflow=load(process.env.DASHBOARD_STAGING_WORKFLOW||resolve('.github/workflows/deploy-dashboard-staging.yml'));
 let script=workflow.jobs['deploy-staging-dashboard'].steps.find(s=>s.with?.script).with.script;
 script=script.replaceAll('/opt/zenithjoy/repo',source).replaceAll('/opt/zenithjoy/autopilot-staging',stage)
  .replaceAll('/opt/zenithjoy/dashboard-staging-build.XXXXXX',join(root,'build.XXXXXX'))
  .replaceAll('http://localhost:521',`http://127.0.0.1:${server.address().port}`).replaceAll('${{ github.sha }}',candidate);
 try {
  const result=await exec('bash',['-e','-c',script],{env:{...process.env,DEPLOY_SHA:candidate,PATH:`${bin}:${process.env.PATH}`,LC_ALL:'C'}});
  assert.equal(await readFile(join(stage,'dist','index.html'),'utf8'),'candidate A',result.stdout);
  assert.equal(JSON.parse(await readFile(join(stage,'dist','release-sha.json'),'utf8')).sha,candidate);
  assert.equal(git('rev-parse','HEAD'),latest);
 } finally {await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
