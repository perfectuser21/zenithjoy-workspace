import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const api=await import('../qualification-maintenance-transport.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
test('候选路径仅正规40SHA和两固定target，不能经字符串注入SSH',()=>{
 assert.equal(typeof api?.candidateRuntimeRoot,'function');
 assert.match(api.candidateRuntimeRoot('xian-m4','a'.repeat(40)),/\/phone-candidates\/a{40}\/runtime$/);
 for(const pair of [['other','a'.repeat(40)],['xian-m4','a;id'],['mmv','../a']])assert.throws(()=>api.candidateRuntimeRoot(...pair));
});
test('真实stream actor单请求、响应配对，EOF不发signal',async()=>{
 assert.equal(typeof api?.openMaintenancePeer,'function');
 const child=spawn(process.execPath,['-e',`const rl=require('readline').createInterface({input:process.stdin});let first=true;rl.on('line',x=>{const r=JSON.parse(x);console.log(JSON.stringify(first?(first=false,{status:'guard_held',pid:process.pid,start_identity:'123:4',uid:process.getuid(),script_sha256:'a'.repeat(64)}):{status:'guard_held',local_owner:r.op==='status'?'free':'original_owner'}));});`],{stdio:['pipe','pipe','pipe']});
 const peer=await api.openMaintenancePeer(child,{serial:'SER',profile:'legacy',owner:'tag',deadline_seconds:10});
 assert.equal(peer.identity.pid,child.pid);assert.equal((await peer.request({op:'status'})).local_owner,'free');
 await peer.close();assert.equal(child.signalCode,null);assert.equal(child.exitCode,0);
});
test('actor提前退出/无响应均明确unknown，不能返回虚构guard',async()=>{
 assert.equal(typeof api?.openMaintenancePeer,'function');
 const child=spawn(process.execPath,['-e','process.exit(1)'],{stdio:['pipe','pipe','pipe']});
 await assert.rejects(api.openMaintenancePeer(child,{}, {timeoutMs:1000}),/MAINTENANCE_HOST_UNKNOWN/);
 const quiet=spawn(process.execPath,['-e','process.stdin.resume()'],{stdio:['pipe','pipe','pipe']});
 await assert.rejects(api.openMaintenancePeer(quiet,{}, {timeoutMs:30}),/MAINTENANCE_HOST_UNKNOWN/);
 assert.equal(quiet.signalCode,null);
});
test('远端候选审计执行本人固定reader，只读实际bytes且变更必拒',t=>{
 assert.equal(typeof api?.CANDIDATE_BYTES_READER,'string');const root=realpathSync(mkdtempSync(join(tmpdir(),'remote-bytes-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.from('fixed code');writeFileSync(join(root,'code.py'),bytes);
 const manifest={source_repo:'perfectuser21/zenithjoy-workspace',source_commit:'a'.repeat(40),files:[{path:'source/code.py',deployed_path:'code.py',content_sha256:createHash('sha256').update(bytes).digest('hex')}]};
 const raw=JSON.stringify(manifest);writeFileSync(join(root,'deployment-manifest.json'),raw);
 const run=()=>spawnSync('python3',['-B','-I','-',root],{input:api.CANDIDATE_BYTES_READER,encoding:'utf8',timeout:5000});
 const first=run();assert.equal(first.status,0,first.stderr);const measured=JSON.parse(first.stdout);
 assert.equal(Buffer.from(measured.manifest_raw,'base64').toString(),raw);assert.deepEqual(measured.observed.files,manifest.files);
 writeFileSync(join(root,'code.py'),'drift');assert.notEqual(run().status,0);
});
test('原件压缩通道按实际解压bytes/hash核验，不把observed标签当证明',()=>{
 assert.equal(typeof api?.decodeOriginalPacket,'function');const raw=Buffer.from(JSON.stringify({frozen:{test:true}}));
 const packet={status:'observed',encoding:'gzip-base64',bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),data:gzipSync(raw).toString('base64')};
 assert.deepEqual(api.decodeOriginalPacket(packet),{frozen:{test:true}});
 for(const altered of [{...packet,bytes:raw.length+1},{...packet,sha256:'a'.repeat(64)},{...packet,data:'not_base64'},{...packet,bytes:17*1024*1024}])assert.throws(()=>api.decodeOriginalPacket(altered),/MAINTENANCE_HOST_UNKNOWN/);
});
test('生产guard启动清除测试根/registry/执行器残留，exec保持同PID，不影响primitive私有fixture',t=>{
 assert.equal(typeof api?.GUARD_BOOTSTRAP,'string');const root=mkdtempSync(join(tmpdir(),'guard-bootstrap-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const script=join(root,'host.py');writeFileSync(script,'import os,json\nprint(json.dumps({"pid":os.getpid(),"keys":[k for k in os.environ if k.startswith(("DOUYIN_","LEADGEN_","WF_","WFR_"))],"node_options":os.environ.get("NODE_OPTIONS")}))\n');
 const r=spawnSync('python3',['-B','-I','-c',api.GUARD_BOOTSTRAP,script],{env:{...process.env,DOUYIN_PHONE_TMP_ROOT:'/wrong',DOUYIN_PHONE_REGISTRY:'/wrong',DOUYIN_PYTHON_BIN:'/wrong',LEADGEN_MODE:'wrong',WF_HOME:'/wrong',WFR_HOME:'/wrong',NODE_OPTIONS:'--no-warnings'},encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert.equal(value.pid,r.pid);assert.deepEqual(value.keys,[]);assert.equal(value.node_options,null);
});
