import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
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
  // A tiny local wheel exercises the real extractor without external network.
  const wheel=join(root,'fixture.whl');
  execFileSync('python3',['-c',`import sys,zipfile
names=['assets/index-CqDKM-zt.js','assets/rolldown-runtime-CM1DJQSe.js','assets/vendor-datadog-CS-2l-KQ.js','fonts/inter-latin-normal.woff2','fonts/inter-latin-italic.woff2','fonts/materialdesignicons-webfont.woff2']
with zipfile.ZipFile(sys.argv[1],'w') as z:
 for name in names: z.writestr('comfyui_frontend_package/static/'+name,'candidate wheel '+name)
 z.writestr('comfyui_frontend_package/static/assets/index-CqDKM-zt.js.map','do not publish')`,wheel]);
  const wheelSha=createHash('sha256').update(await readFile(wheel)).digest('hex');
  const extractor=await readFile(resolve('scripts/deploy/comfy_official_assets.py'),'utf8');
  const fixtureExtractor=extractor.replace(/WHEEL_SHA256 = '[a-f0-9]{64}'/,`WHEEL_SHA256 = '${wheelSha}'`);
  assert.notEqual(fixtureExtractor,extractor,'fixture must pin the local wheel digest');
  await mkdir(join(source,'scripts/deploy'),{recursive:true});
  await writeFile(join(source,'scripts/deploy/comfy_official_assets.py'),fixtureExtractor);
  await mkdir(join(source,'deploy'));await writeFile(join(source,'deploy','nginx.staging.conf'),'test nginx');
  await writeFile(join(source,'source.txt'),'candidate A');git(source,'add','.');git(source,'commit','-m','candidate A');const candidate=git(source,'rev-parse','HEAD');
  await writeFile(join(source,'scripts/deploy/comfy_official_assets.py'),fixtureExtractor.replace(wheelSha,'0'.repeat(64)));
  await writeFile(join(source,'source.txt'),'main B');git(source,'commit','-am','main B');const latest=git(source,'rev-parse','HEAD');
  execFileSync('git',['clone','--quiet',source,runner],{env});git(runner,'checkout','--quiet',candidate);
  await writeFile(join(bin,'npm'),'#!/bin/sh\nif [ "$1" = run ]; then mkdir -p apps/dashboard/dist; cp source.txt apps/dashboard/dist/index.html; printf fixture-precache > apps/dashboard/dist/sw.js; fi\n',{mode:0o755});
  await writeFile(join(bin,'curl'),'#!/bin/sh\nset -eu\nout=\nurl=\nwhile [ "$#" -gt 0 ]; do case "$1" in -o) out="$2"; shift 2;; https://files.pythonhosted.org/*) url="$1"; shift;; --retry|--max-time|--max-filesize) shift 2;; *) shift;; esac; done\n[ -n "$out" ] && [ -n "$url" ]\ncp "$TEST_WHEEL" "$out"\n',{mode:0o755});
  const workflow=load(resolve('.github/workflows/deploy-dashboard-staging.yml'));
  const job=workflow.jobs['deploy-staging-dashboard'];
  assert.equal(job.steps.find(s=>s.uses?.startsWith('actions/checkout@')).with.ref,'${{ github.sha }}');
  const script=job.steps.find(s=>s.name==='Build exact candidate on runner').run;
  await exec('bash',['-e','-c',script],{cwd:runner,env:{...env,DEPLOY_SHA:candidate,RUNNER_TEMP:temp,TEST_WHEEL:wheel,PATH:`${bin}:${env.PATH}`}});
  assert.equal(await readFile(join(temp,'dashboard-bundle','dist','index.html'),'utf8'),'candidate A');
  assert.equal(JSON.parse(await readFile(join(temp,'dashboard-bundle','dist','release-sha.json'),'utf8')).sha,candidate);
  const assetRoot=join(temp,'dashboard-bundle','dist','assets/comfy',wheelSha);
  assert.equal(await readFile(join(assetRoot,'assets/index-CqDKM-zt.js'),'utf8'),'candidate wheel assets/index-CqDKM-zt.js');
  assert.equal(await readFile(join(assetRoot,'fonts/inter-latin-normal.woff2'),'utf8'),'candidate wheel fonts/inter-latin-normal.woff2');
  assert.equal(JSON.parse(await readFile(join(assetRoot,'manifest.json'),'utf8')).wheel_sha256,wheelSha);
  await assert.rejects(readFile(join(assetRoot,'assets/index-CqDKM-zt.js.map')));
  assert.doesNotMatch(await readFile(join(temp,'dashboard-bundle','dist/sw.js'),'utf8'),/assets\/comfy\//);
  assert.equal(git(source,'rev-parse','HEAD'),latest);
  assert.ok((await readFile(join(temp,'dashboard-staging.tar.gz'))).length>0);
  assert.equal(execFileSync('tar',['-xOzf',join(temp,'dashboard-staging.tar.gz'),`dist/assets/comfy/${wheelSha}/assets/index-CqDKM-zt.js`],{encoding:'utf8'}),'candidate wheel assets/index-CqDKM-zt.js');
  await assert.rejects(exec('bash',['-e','-c',script],{cwd:runner,env:{...env,DEPLOY_SHA:latest,RUNNER_TEMP:temp,TEST_WHEEL:wheel,PATH:`${bin}:${env.PATH}`}}));
  await writeFile(wheel,Buffer.concat([await readFile(wheel),Buffer.from('tampered')]));
  await assert.rejects(exec('bash',['-e','-c',script],{cwd:runner,env:{...env,DEPLOY_SHA:candidate,RUNNER_TEMP:temp,TEST_WHEEL:wheel,PATH:`${bin}:${env.PATH}`}}));
 } finally {await rm(root,{recursive:true,force:true});}
});
