import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), sha='b'.repeat(40), old='a'.repeat(40);
const script=resolve('scripts/deploy/frontend-release.sh');
const lib=resolve('.github/workflows/scripts/deploy-lib.sh');
async function scenario({bad=false,legacy=false,restartFails=false,same=false,rollback=false,rollbackFailed=false,legacyNoStamp=false,tamperOld=false,badRollback=false,unverifiedCurrent=false,noOldCommon=false}={}) {
 const root=await mkdtemp(join(tmpdir(),'frontend-release-'));
 const live=join(root,'live'),built=join(root,'built'),bin=join(root,'bin'),configs=join(root,'configs');
 await Promise.all([live,built,bin,configs].map(p=>mkdir(p,{recursive:true})));
 if(legacy) await mkdir(join(live,'dist')); else {
  await mkdir(join(live,'releases',old),{recursive:true});
  await symlink(old,join(live,'releases','current'));
  await symlink('releases/current',join(live,'dist'));
 }
 await writeFile(join(live,'dist','index.html'),'old page');
 if(!legacyNoStamp)await writeFile(join(live,'dist','release-sha.json'),JSON.stringify({sha:old}));
 await writeFile(join(live,'nginx.conf'),'old config');
 if(!noOldCommon)await writeFile(join(live,'common.conf'),'old common');
 await writeFile(join(built,'index.html'),'new page');
 await writeFile(join(built,'release-sha.json'),JSON.stringify({sha:same?old:sha}));
 await writeFile(join(configs,'nginx.conf'),'new config');
 await writeFile(join(configs,'common.conf'),'new common');
 // Docker is the only unavailable external boundary; filesystem and HTTP stay real.
 await writeFile(join(bin,'docker'),`#!/bin/sh\necho "$*" >> "$DOCKER_CALLS"\nif [ "$FAIL_FIRST_RESTART" = true ] && [ ! -e "$DOCKER_CALLS.failed" ]; then touch "$DOCKER_CALLS.failed"; exit 1; fi\n`,{mode:0o755});
 let rollingBack=false;
 const server=createServer(async(req,res)=>{
  let data;try{data=await readFile(join(live,'dist','release-sha.json'),'utf8');}catch{data=null;}
  if(rollingBack && badRollback && data && JSON.parse(data).sha===old){res.statusCode=503;res.end('old version fails');return;}
  if(bad && data && JSON.parse(data).sha===sha){res.statusCode=503;res.end('candidate broken');return;}
  if(req.url.startsWith('/release-sha.json')){res.statusCode=data?200:404;res.end(data||'missing');return;}
  res.end(await readFile(join(live,'dist','index.html'),'utf8'));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let result;
 try { result=await exec('bash',[script,live,same?old:sha,built,'frontend',`http://127.0.0.1:${server.address().port}`,lib,configs],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,DOCKER_CALLS:join(root,'calls'),FAIL_FIRST_RESTART:String(restartFails),ZJ_FRONTEND_VERIFY_RETRIES:'0',LC_ALL:'C'}}); }
 catch(error){result=error;}
 let rollbackResult;
 if(rollback||rollbackFailed){
  rollingBack=true;
  if(unverifiedCurrent)await rm(join(live,'releases',sha,'.release-verified.json')); 
  if(tamperOld)await writeFile(join(live,'releases',old,'index.html'),'tampered old');
  try{rollbackResult=await exec('bash',[script,'--rollback',live,rollbackFailed?sha:'','frontend',`http://127.0.0.1:${server.address().port}`,lib],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,DOCKER_CALLS:join(root,'calls'),ZJ_FRONTEND_VERIFY_RETRIES:'0',LC_ALL:'C'}});}
  catch(error){rollbackResult=error;}
 }
 const failedEntries=await readdir(join(live,'failed')).catch(()=>[]);
 const observation={common:await readFile(join(live,'common.conf'),'utf8').catch(()=>null),failedEntries,rollbackCode:rollbackResult?.code??0,rollbackOutput:rollbackResult?.stderr||'',code:result.code??0,page:await readFile(join(live,'dist','index.html'),'utf8'),config:await readFile(join(live,'nginx.conf'),'utf8'),output:result.stdout+' '+result.stderr};
 await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});return observation;
}
for(const legacy of [false,true]) {
 test(`frontend success reads candidate SHA over HTTP (legacy=${legacy})`,async()=>{const r=await scenario({legacy});assert.equal(r.code,0,r.output);assert.equal(r.page,'new page');assert.equal(r.config,'new config');});
 test(`failed HTTP restores old content and configs (legacy=${legacy})`,async()=>{const r=await scenario({legacy,bad:true});assert.notEqual(r.code,0);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});
}
test('container restart failure restores old release',async()=>{const r=await scenario({restartFails:true});assert.notEqual(r.code,0);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});
test('same SHA rebuild cannot erase the live release',async()=>{const r=await scenario({same:true});assert.notEqual(r.code,0);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});

test('失败候选无法通过人工rollback入口重新上线',async()=>{const r=await scenario({bad:true,rollbackFailed:true});assert.notEqual(r.code,0);assert.notEqual(r.rollbackCode,0);assert.match(r.rollbackOutput,/从未验证/);assert.equal(r.page,'old page');assert.ok(r.failedEntries.some(name=>name.startsWith(sha)));});
for(const legacyNoStamp of [false,true])test(`成功候选能回退到已验证旧内容，支持无SHA旧现场=${legacyNoStamp}`,async()=>{const r=await scenario({legacy:legacyNoStamp,legacyNoStamp,rollback:true});assert.equal(r.code,0,r.output);assert.equal(r.rollbackCode,0,r.rollbackOutput);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});
test('旧版本留存内容被篡改时不切换指针',async()=>{const r=await scenario({rollback:true,tamperOld:true});assert.equal(r.code,0);assert.notEqual(r.rollbackCode,0);assert.equal(r.page,'new page');});

test('回退本身健康失败恢复原当前版本',async()=>{const r=await scenario({rollback:true,badRollback:true});assert.equal(r.code,0);assert.notEqual(r.rollbackCode,0);assert.equal(r.page,'new page');});
test('当前候选缺验证证明仍允许恢复已验证上一版',async()=>{const r=await scenario({rollback:true,unverifiedCurrent:true});assert.equal(r.code,0);assert.equal(r.rollbackCode,0,r.rollbackOutput);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});

test('目标版本没有common.conf时人工回退移除新引入配置',async()=>{const r=await scenario({rollback:true,noOldCommon:true});assert.equal(r.code,0);assert.equal(r.rollbackCode,0,r.rollbackOutput);assert.equal(r.common,null);});
