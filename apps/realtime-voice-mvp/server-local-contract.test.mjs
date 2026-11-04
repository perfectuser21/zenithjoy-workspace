import {test} from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
const serverSource=fileURLToPath(new URL('./server.js',import.meta.url));
test('prototype serves local page and exact missing-key JSON without inheriting credentials or making provider requests',{timeout:15000},async()=>{
 const directory=await mkdtemp('/tmp/zj-realtime-contract-');let child;let externalAttempts=0;let logs='';
 try{
  const launcher=directory+'/launcher.mjs';
  await writeFile(launcher,`import http from 'node:http';import https from 'node:https';
const blocked=()=>{process.send?.({externalAttempt:true});throw new Error('external transport blocked by local contract');};
for(const transport of [http,https]) { transport.request=blocked;transport.get=blocked; }
const {createServer,attachDomesticWebSocket}=await import(${JSON.stringify(serverSource)});
const server=createServer();attachDomesticWebSocket(server);server.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('message',message=>{if(message==='stop')server.close(()=>process.exit(0));});`);
  // Whitelist only process mechanics: no inherited OpenAI, Volcengine or other provider credentials.
  child=fork(launcher,[],{env:{PATH:process.env.PATH,NODE_ENV:'test',TMPDIR:directory},stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
  const port=await new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error('prototype startup deadline')),5000);child.on('message',message=>{if(message.externalAttempt)externalAttempts++;if(message.port){clearTimeout(deadline);resolve(message.port);}});child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('prototype process failed'));});});
  const base=`http://127.0.0.1:${port}`;const page=await fetch(base,{signal:AbortSignal.timeout(3000)});assert.equal(page.status,200);assert.match(await page.text(),/OpenAI Realtime/);
  const session=await fetch(base+'/session',{method:'POST',signal:AbortSignal.timeout(3000)});assert.equal(session.status,500);assert.deepEqual(await session.json(),{error:'OPENAI_API_KEY not configured'});assert.equal(externalAttempts,0);assert.doesNotMatch(logs,/client_secret|Bearer |sk-/);
 }finally{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;}await rm(directory,{recursive:true,force:true});}
});
