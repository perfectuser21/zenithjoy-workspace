import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile), sha='b'.repeat(40), old='a'.repeat(40);
const script=resolve('scripts/deploy/frontend-release.sh');
const lib=resolve('.github/workflows/scripts/deploy-lib.sh');
async function scenario({bad=false,legacy=false,restartFails=false,same=false}={}) {
 const root=await mkdtemp(join(tmpdir(),'frontend-release-'));
 const live=join(root,'live'),built=join(root,'built'),bin=join(root,'bin'),configs=join(root,'configs');
 await Promise.all([live,built,bin,configs].map(p=>mkdir(p,{recursive:true})));
 if(legacy) await mkdir(join(live,'dist')); else {
  await mkdir(join(live,'releases',old),{recursive:true});
  await symlink(old,join(live,'releases','current'));
  await symlink('releases/current',join(live,'dist'));
 }
 await writeFile(join(live,'dist','index.html'),'old page');
 await writeFile(join(live,'dist','release-sha.json'),JSON.stringify({sha:old}));
 await writeFile(join(live,'nginx.conf'),'old config');
 await writeFile(join(live,'common.conf'),'old common');
 await writeFile(join(built,'index.html'),'new page');
 await writeFile(join(built,'release-sha.json'),JSON.stringify({sha:same?old:sha}));
 await writeFile(join(configs,'nginx.conf'),'new config');
 await writeFile(join(configs,'common.conf'),'new common');
 // Docker is the only unavailable external boundary; filesystem and HTTP stay real.
 await writeFile(join(bin,'docker'),`#!/bin/sh\necho "$*" >> "$DOCKER_CALLS"\nif [ "$FAIL_FIRST_RESTART" = true ] && [ ! -e "$DOCKER_CALLS.failed" ]; then touch "$DOCKER_CALLS.failed"; exit 1; fi\n`,{mode:0o755});
 const server=createServer(async(req,res)=>{
  const data=await readFile(join(live,'dist','release-sha.json'),'utf8');
  if(bad && JSON.parse(data).sha===sha){res.statusCode=503;res.end('candidate broken');return;}
  res.end(req.url.startsWith('/release-sha.json')?data:'page');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let result;
 try { result=await exec('bash',[script,live,same?old:sha,built,'frontend',`http://127.0.0.1:${server.address().port}`,lib,configs],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,DOCKER_CALLS:join(root,'calls'),FAIL_FIRST_RESTART:String(restartFails),LC_ALL:'C'}}); }
 catch(error){result=error;}
 const observation={code:result.code??0,page:await readFile(join(live,'dist','index.html'),'utf8'),config:await readFile(join(live,'nginx.conf'),'utf8'),output:result.stdout+' '+result.stderr};
 await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});return observation;
}
for(const legacy of [false,true]) {
 test(`frontend success reads candidate SHA over HTTP (legacy=${legacy})`,async()=>{const r=await scenario({legacy});assert.equal(r.code,0,r.output);assert.equal(r.page,'new page');assert.equal(r.config,'new config');});
 test(`failed HTTP restores old content and configs (legacy=${legacy})`,async()=>{const r=await scenario({legacy,bad:true});assert.notEqual(r.code,0);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});
}
test('container restart failure restores old release',async()=>{const r=await scenario({restartFails:true});assert.notEqual(r.code,0);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});
test('same SHA rebuild cannot erase the live release',async()=>{const r=await scenario({same:true});assert.notEqual(r.code,0);assert.equal(r.page,'old page');assert.equal(r.config,'old config');});
