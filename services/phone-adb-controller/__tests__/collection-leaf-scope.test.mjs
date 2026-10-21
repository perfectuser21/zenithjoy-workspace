// 只用隔离TCP server和本地C客户端；实际managed入口，不连接手机。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,createConnection} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const wrapper=new URL('../adb-managed-client.py',import.meta.url).pathname;

async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'collection-leaf-scope-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const c=join(dir,'client.c'),client=join(dir,'client'),calls=join(dir,'client-calls');
 writeFileSync(c,`#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n#include <unistd.h>\n#include <errno.h>\nint main(int argc,char **argv){FILE *f=fopen(getenv("LEAF_FIXTURE_CALLS"),"a");if(!f)return 12;for(int i=1;i<argc;i++)fprintf(f,"%s ",argv[i]);fprintf(f,"\\n");fclose(f);if(argc==2&&!strcmp(argv[1],"version"))puts("Android Debug Bridge version 1.0.41");else if(!strcmp(argv[argc-1],"sleep-probe")){sleep(5);return 0;}else if(!strcmp(argv[argc-1],"fork-probe")){int pid=fork();if(pid<0){fprintf(stderr,"fork_denied=%d\\n",errno);return 77;}if(pid==0){FILE *g=fopen(getenv("LEAF_FIXTURE_ESCAPE"),"w");if(g){fputs("escaped",g);fclose(g);}return 0;}return 0;}else puts("device");return 0;}\n`);
 const cc=spawnSync('cc',[c,'-o',client],{encoding:'utf8'});assert.equal(cc.status,0,'实际leaf夹具必须成功编译：'+cc.stderr);
 const sockets=new Set(),server=createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});let bytes=Buffer.alloc(0);s.on('data',b=>{bytes=Buffer.concat([bytes,b]);if(bytes.length<4)return;const n=parseInt(bytes.subarray(0,4).toString(),16);if(bytes.length<4+n)return;const q=bytes.subarray(4,4+n).toString(),body=q==='host:version'?'0029':q==='host:devices'?'NO-DEVICE\tdevice\n':null;if(body===null){s.end('FAIL0003bad');return;}s.end('OKAY'+Buffer.byteLength(body).toString(16).padStart(4,'0')+body);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();server.close();});
 const config=join(dir,'policy.json');writeFileSync(config,JSON.stringify({schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:'tcp:127.0.0.1:'+server.address().port,forbidden_ports:[],adb_bin:client,adb_sha256:createHash('sha256').update(readFileSync(client)).digest('hex')}),{mode:0o600});
 const run=(args,extra={})=>new Promise(resolve=>{const p=spawn('python3',[wrapper,...args],{env:{...process.env,HOME:dir,ZJ_ADB_HOST_CONFIG:config,LEAF_FIXTURE_CALLS:calls,...extra}});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',code=>resolve({code,stdout,stderr}));});
 return {dir,client,calls,config,run,policy:JSON.parse(readFileSync(config,'utf8'))};
}

for(const args of [['version'],['-s','NO-DEVICE','get-state']])test('collection scope声明后缺父broker不可绕到直接实际ADB：'+args.join(' '),async t=>{
 const f=await fixture(t);
 const baseline=await f.run(args);assert.equal(baseline.code,0,baseline.stderr);assert.ok(existsSync(f.calls),'先证明真实managed路径及实际Cleaf可用');rmSync(f.calls);
 const r=await f.run(args,{WFR_COLLECTION_LEAF_SOCKET:join(f.dir,'absent-parent.sock'),WFR_COLLECTION_LEAF_NONCE:'a'.repeat(48)});
 assert.notEqual(r.code,0,'缺父producer不能默默回落到原actualclient');
 assert.equal(existsSync(f.calls),false,'version/route设备分支也必须全部经父producer');
});


for(const mode of ['normal','fork-probe'])test('parent真实producer执行实际Darwin nofork leaf：'+mode,{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t);
 const {startCollectionLeafProducer}=await import('../collection-leaf-producer.mjs');
 const escaped=join(f.dir,'escaped'),p=await startCollectionLeafProducer({directory:f.dir,policy:f.policy,serial:'NO-DEVICE',deadlineMs:Date.now()+30000,env:{...process.env,LEAF_FIXTURE_CALLS:f.calls,LEAF_FIXTURE_ESCAPE:escaped}});
 try{
  const result=await f.run(['-s','NO-DEVICE',...(mode==='normal'?['get-state']:['shell','fork-probe'])],p.env);
  const snapshot=await p.seal();
  assert.ok(snapshot.leaves.length>=2,'version和实际命令都须由父真正执行并登记');
  assert.ok(snapshot.leaves.every(x=>x.intent_at&&x.started_at&&x.ended_at&&Number.isInteger(x.pid)&&x.boundary==='darwin-sandbox-deny-process-fork-v1'));
  assert.equal(existsSync(escaped),false,'实际内核nofork必须挡住原生C fork');
  if(mode==='normal'){assert.equal(result.code,0,result.stderr);assert.equal(snapshot.complete,true);assert.ok(snapshot.leaves.every(x=>x.code===0));}
  else{assert.notEqual(result.code,0);assert.match(result.stderr,/fork_denied=/);assert.equal(snapshot.complete,false);}
 }finally{await p.close();}
});

test('parentproducer必须先核对外部clientpin，不采信当前client自报或callertrue',async t=>{
 const f=await fixture(t);const {startCollectionLeafProducer}=await import('../collection-leaf-producer.mjs');
 await assert.rejects(()=>startCollectionLeafProducer({directory:f.dir,policy:{...f.policy,adb_sha256:'0'.repeat(64)},serial:'NO-DEVICE',deadlineMs:Date.now()+30000,env:process.env,verified:true}),/COLLECTION_CLIENT_PIN_MISMATCH/);
 assert.equal(existsSync(f.calls),false);
});


test('seal封入口并drain已接入但未提交请求，不能先签complete后补污染',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t),{startCollectionLeafProducer}=await import('../collection-leaf-producer.mjs');
 const p=await startCollectionLeafProducer({directory:f.dir,policy:f.policy,serial:'NO-DEVICE',deadlineMs:Date.now()+30000,env:{...process.env,LEAF_FIXTURE_CALLS:f.calls}});
 try{
  assert.equal((await f.run(['version'],p.env)).code,0);
  const c=createConnection(p.env.WFR_COLLECTION_LEAF_SOCKET);c.on('error',()=>{});await new Promise(r=>c.once('connect',r));c.write('{');
  await new Promise(r=>setImmediate(r));
  const sealed=await p.seal();assert.equal(sealed.complete,false);assert.deepEqual(p.snapshot(),sealed);c.destroy();
 }finally{await p.close();}
});

test('父intent账写失败有界退出并保持unknown，不把active泄漏到整条deadline',{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t),{startCollectionLeafProducer}=await import('../collection-leaf-producer.mjs');
 const p=await startCollectionLeafProducer({directory:f.dir,policy:f.policy,serial:'NO-DEVICE',deadlineMs:Date.now()+30000,env:{...process.env,LEAF_FIXTURE_CALLS:f.calls}});
 try{
  mkdirSync(p.snapshot().ledger);const began=Date.now(),result=await f.run(['version'],p.env);assert.notEqual(result.code,0);
  const sealed=await p.seal();assert.equal(sealed.complete,false);assert.ok(Date.now()-began<3000);assert.equal(existsSync(f.calls),false);
 }finally{await p.close();}
});


for(const mode of ['wrong-nonce','wrong-serial','extra-fake-terminal','deadline'])test('父实际leaf失败边界：'+mode,{skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t),{startCollectionLeafProducer}=await import('../collection-leaf-producer.mjs');
 const p=await startCollectionLeafProducer({directory:f.dir,policy:f.policy,serial:'NO-DEVICE',deadlineMs:Date.now()+(mode==='deadline'?800:30000),env:{...process.env,LEAF_FIXTURE_CALLS:f.calls}});
 try{
  if(mode==='deadline'){const r=await f.run(['-s','NO-DEVICE','shell','sleep-probe'],p.env);assert.notEqual(r.code,0);}
  else{
   const q={nonce:p.env.WFR_COLLECTION_LEAF_NONCE,argv:mode==='wrong-serial'?['-H','127.0.0.1','-P',f.policy.endpoint.split(':').at(-1),'-s','OTHER','get-state']:['version']};
   if(mode==='wrong-nonce')q.nonce='0'.repeat(48);if(mode==='extra-fake-terminal'){q.started_at=Date.now();q.code=0;}
   const response=await new Promise((yes,no)=>{const c=createConnection(p.env.WFR_COLLECTION_LEAF_SOCKET);let body='';c.on('connect',()=>c.end(JSON.stringify(q)));c.on('data',b=>body+=b);c.on('error',no);c.on('end',()=>yes(JSON.parse(body)));});assert.equal(response.ok,false);assert.equal(existsSync(f.calls),false);
  }
  assert.equal((await p.seal()).complete,false);
 }finally{await p.close();}
});
