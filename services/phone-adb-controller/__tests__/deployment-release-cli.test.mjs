import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {digest} from '../runtime-definition.mjs';
import {deploymentTarget} from '../deployment-release.mjs';
const quote=x=>`'${x.replaceAll("'","'\\''")}'`;
test('真实部署CLI经过假SSH采集本机文件、HTTP观测及回读后输出可运行manifest',async t=>{
 const root=mkdtempSync(join(tmpdir(),'deployment-cli-')),bin=join(root,'bin');mkdirSync(bin);
 writeFileSync(join(root,'entry.sh'),'original-bytes\n');
 const manifest={schema_version:1,source_repo:'fixture/repo',source_commit:'a'.repeat(40),files:[{path:'services/phone-adb-controller/entry.sh',deployed_path:'entry.sh',content_sha256:digest(Buffer.from('original-bytes\n'))}]};
 const file=join(root,'manifest.json');writeFileSync(file,JSON.stringify(manifest));
 const collector=new URL('../deployment-manifest.mjs',import.meta.url).pathname;
 writeFileSync(join(bin,'ssh'),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(collector)} collect ${quote(root)} -\n`,{mode:0o755});
 const target=deploymentTarget(hostname());
 const release={id:'release-cli',target,environment:'fixture',payload:{components:[{kind:'repo',repo:manifest.source_repo,revision:manifest.source_commit},{kind:'code',repo:manifest.source_repo,path:manifest.files[0].path,revision:manifest.source_commit,digest:'sha256:'+manifest.files[0].content_sha256}]}};
 release.manifest_sha256=digest({environment:release.environment,target:release.target,payload:release.payload});
 const requests=[];let observation;
 const server=createServer(async(req,res)=>{
  requests.push(req.url);let body='';for await(const chunk of req)body+=chunk;
  res.setHeader('Content-Type','application/json');
  if(req.method==='POST'){observation={id:'observation-cli',release_id:release.id,payload:JSON.parse(body)};res.end(JSON.stringify({observation}));}
  else if(req.url.endsWith('/gate'))res.end(JSON.stringify({deployed:true,actual_matches:true,current_observation_id:observation.id}));
  else if(req.url.endsWith('/observations/observation-cli'))res.end(JSON.stringify({observation}));
  else res.end(JSON.stringify({release}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const run=()=>new Promise(resolve=>{
  const child=spawn(process.execPath,[new URL('../deployment-release.mjs',import.meta.url).pathname,target,file],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,WF_RELEASE_IDS:JSON.stringify({[target]:release.id}),WF_DEPLOY_ENVIRONMENT:'fixture',WF_DEPLOY_COLLECTOR:'trusted-fixture',WF_DEPLOY_ATTEMPT_KEY:'deploy-cli',WF_DEPLOY_STATE_DIR:join(root,'state'),BRAIN_URL:`http://127.0.0.1:${server.address().port}`}});
  let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('close',status=>resolve({status,stdout,stderr}));
 });
 const result=await run();assert.equal(result.status,0,result.stderr);const published=JSON.parse(result.stdout);assert.equal(published.observation_id,observation.id);assert.equal(published.release_id,release.id);
 assert.equal(observation.payload.components[1].digest,'sha256:'+digest(readFileSync(join(root,'entry.sh'))));assert.deepEqual(requests.slice(-2),['/api/brain/releases/release-cli/observations/observation-cli','/api/brain/releases/release-cli/gate']);
 writeFileSync(join(root,'entry.sh'),'changed');const changed=await run();assert.notEqual(changed.status,0);assert.match(changed.stderr,/digest/);assert.equal(changed.stdout,'');
});
