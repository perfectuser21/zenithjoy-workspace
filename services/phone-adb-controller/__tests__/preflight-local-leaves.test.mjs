import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {createHash} from 'node:crypto';import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
const root=dirname(new URL('../leadgen-handlers.mjs',import.meta.url).pathname),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
test('fixed local preflight parser runs only as a pinned nofork leaf and rejects operations after seal',{skip:process.platform!=='darwin'},async t=>{
 const {startPreflightLocalLeaves}=await import('../preflight-local-leaves.mjs');
 const directory=mkdtempSync(join(tmpdir(),'preflight-local-leaf-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const producer=await startPreflightLocalLeaves({root,directory,python:{path:'/usr/bin/python3',sha256:hash('/usr/bin/python3')},sourceFiles:{'preflight-local-step.py':hash(join(root,'preflight-local-step.py'))},deadlineMs:Date.now()+10000});t.after(()=>producer.close());
 const result=await producer.run('ui','<hierarchy><node text="抖音号：actual"/><node text="编辑主页"/></hierarchy>');
 assert.equal(JSON.parse(result).account.douyin_id,'actual');const proof=await producer.seal();
 assert.equal(proof.execution_stopped,true);assert.equal(proof.leaves.length,1);assert.equal(proof.leaves[0].boundary,'darwin-sandbox-deny-process-fork-v1');
 await assert.rejects(()=>producer.run('ui','<hierarchy/>'),/PREFLIGHT_LOCAL_CLOSED/);
});

test('route is inspected by the fixed nofork helper without launching a managed-client outer',{skip:process.platform!=='darwin'},async t=>{
 const {createServer}=await import('node:net'),{writeFileSync}=await import('node:fs'),{startPreflightLocalLeaves}=await import('../preflight-local-leaves.mjs');
 const directory=mkdtempSync(join(tmpdir(),'preflight-local-route-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const sockets=new Set(),server=createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});s.once('data',b=>{const q=b.subarray(4).toString(),body=q==='host:version'?'0029':q==='host:devices'?'SERIAL\tdevice\n':null;if(body===null)return s.end('FAIL0003bad');s.end('OKAY'+Buffer.byteLength(body).toString(16).padStart(4,'0')+body);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();server.close();});
 const policy={schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:'tcp:127.0.0.1:'+server.address().port,forbidden_ports:[]};const config=join(directory,'policy.json');writeFileSync(config,JSON.stringify(policy),{mode:0o600});
 const producer=await startPreflightLocalLeaves({root,directory,python:{path:'/usr/bin/python3',sha256:hash('/usr/bin/python3')},sourceFiles:Object.fromEntries(['preflight-local-step.py','adb-existing-route.py'].map(p=>[p,hash(join(root,p))])),deadlineMs:Date.now()+10000});t.after(()=>producer.close());
 const result=JSON.parse(await producer.run('route',JSON.stringify({config,policy,serial:'SERIAL'})));assert.equal(result.port,server.address().port);
 assert.equal((await producer.seal()).execution_stopped,true);
});
