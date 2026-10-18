import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const self=fileURLToPath(import.meta.url), direct=process.argv[1]===self, worker=direct&&process.argv[2]==='--fixture-worker';
if(worker){
const [file,parent]=process.argv.slice(3);
const s=net.createServer(c=>{let b=Buffer.alloc(0);c.on('error',()=>{});c.on('data',value=>{
 b=Buffer.concat([b,value]);if(b.length<4)return;const n=parseInt(b.subarray(0,4).toString(),16);if(b.length<4+n)return;
 const q=b.subarray(4,4+n).toString(),v=q==='host:version'?'0029':q==='host:devices'?'SER1\tdevice\n47.100.213.173:10001\tdevice\n':null;
 if(v===null){c.end('FAIL0007invalid');return;}const data=Buffer.from(v);c.end(Buffer.concat([Buffer.from('OKAY'+data.length.toString(16).padStart(4,'0')),data]));
});});
s.listen(0,'127.0.0.1',()=>writeFileSync(file,String(s.address().port)));
setInterval(()=>{try{process.kill(Number(parent),0);}catch{process.exit(0);}},500).unref();


}else if(direct){
const helper=new URL('../adb-existing-route.py',import.meta.url).pathname;
async function server(t,devices,{version='0029',hang=false}={}){
 const requests=[];const sockets=new Set();const s=net.createServer(c=>{sockets.add(c);c.on('close',()=>sockets.delete(c));let b=Buffer.alloc(0);c.on('data',v=>{b=Buffer.concat([b,v]);if(b.length<4)return;const n=parseInt(b.subarray(0,4).toString(),16);if(b.length<4+n)return;const q=b.subarray(4,4+n).toString();requests.push(q);assert.ok(['host:version','host:devices'].includes(q));if(hang)return;const value=q==='host:version'?version:devices;const data=Buffer.from(value);c.end(Buffer.concat([Buffer.from('OKAY'+data.length.toString(16).padStart(4,'0')),data]));});});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>{for(const c of sockets)c.destroy();s.close();});return {port:s.address().port,requests};
}
async function route(ports,socket='',serial='431'){
 const code=`import importlib.util,sys,json\ns=importlib.util.spec_from_file_location('route',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntry: print(m.select_route(sys.argv[2],sys.argv[3],ports=json.loads(sys.argv[4]),budget=0.8))\nexcept Exception as e: print(str(e),file=sys.stderr);sys.exit(2)`;
 return new Promise(resolve=>{const c=spawn('python3',['-c',code,helper,serial,socket,JSON.stringify(ports)]);let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('close',status=>resolve({status,out:out.trim(),err}));});
}
test('5037无目标而5042有目标：只读现有server按精确serial选路',async t=>{
 const a=await server(t,'440\tdevice\n'),b=await server(t,'431\tdevice\n422\tdevice\n');const r=await route([a.port,b.port]);assert.equal(r.status,0,r.err);assert.equal(r.out,String(b.port));assert.deepEqual(a.requests,['host:version','host:devices']);assert.deepEqual(b.requests,['host:version','host:devices']);
});
test('显式socket也必须目标一致，不能转到另一台/忽略多义',async t=>{
 const a=await server(t,'440\tdevice\n'),b=await server(t,'431\tdevice\n');assert.notEqual((await route([a.port,b.port],`tcp:127.0.0.1:${a.port}`)).status,0);
 assert.equal((await route([a.port],`tcp:127.0.0.1:${b.port}`)).out,String(b.port));
 const c=await server(t,'431\tdevice\n');assert.notEqual((await route([b.port,c.port],`tcp:127.0.0.1:${b.port}`)).status,0);
});
test('离线、重复行、未知协议、外host及超时均拒绝',async t=>{
 for(const devices of ['431\toffline\n','431x\tdevice\n','431\tdevice\n431\tdevice\n']){const s=await server(t,devices);assert.notEqual((await route([s.port])).status,0);}
 const bad=await server(t,'431\tdevice\n',{version:'0028'});assert.notEqual((await route([bad.port])).status,0);
 assert.notEqual((await route([], 'tcp:evil.example:5037')).status,0);
 const hanging=await server(t,'',{hang:true}),start=Date.now();assert.notEqual((await route([hanging.port])).status,0);assert.ok(Date.now()-start<1800);
 const good=await server(t,'431\tdevice\n');assert.notEqual((await route([good.port,hanging.port])).status,0,'另一既有server未核实不能假定唯一');
 assert.notEqual((await route([good.port,bad.port])).status,0,'另一既有server未知协议不能静默跳过');
});
test('六份旧controller夹具使用child专用Python环境，不依赖Mac默认路径且保留override',()=>{
 const suites=['account-current-nickname','back-to-results','benchmark-profile-discovery','foreground-anr-history','return-safe-desktop','screenshot-jpeg-sidecar'];
 for(const name of suites){
  const source=readFileSync(new URL('./'+name+'.test.mjs',import.meta.url),'utf8');
  assert.match(source,/\.\.\.fixturePythonEnv\(\)/,name+' must select Python explicitly in child env');
 }
 const before=process.env.DOUYIN_PYTHON_BIN;
 assert.deepEqual(fixturePythonEnv({}),{DOUYIN_PYTHON_BIN:'python3'});
 assert.deepEqual(fixturePythonEnv({DOUYIN_PYTHON_BIN:'/explicit/python'}),{DOUYIN_PYTHON_BIN:'/explicit/python'});
 assert.equal(process.env.DOUYIN_PYTHON_BIN,before,'selection must not mutate the test process environment');
 const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
 const assignment=controller.match(/^PYTHON_BIN=.*$/m)[0].replace('/opt/homebrew/bin/python3','/fixture-missing-homebrew/python3');
 const script=assignment+'\nexec "$PYTHON_BIN" -c "print(173)"';
 const env={...process.env};delete env.DOUYIN_PYTHON_BIN;
 const missing=spawnSync('zsh',['-c',script],{env,encoding:'utf8'});
 assert.notEqual(missing.status,0);assert.match(missing.stderr,/fixture-missing-homebrew/);
 const selected=spawnSync('zsh',['-c',script],{env:{...env,...fixturePythonEnv({})},encoding:'utf8'});
 assert.equal(selected.status,0,selected.stderr);assert.equal(selected.stdout.trim(),'173');
});
test('真实controller先验证既有socket再用该路由，customclient也不能免probe；锁命令不探设备',async t=>{
 const s=await server(t,'431\tdevice\n'),dir=mkdtempSync(join(tmpdir(),'adb-route-controller-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const adb=join(dir,'adb'),reg=join(dir,'profiles'),log=join(dir,'calls');writeFileSync(reg,'p\t431\tMODEL\t1199\t2663\n');
 writeFileSync(adb,'#!/usr/bin/env python3\nimport os,sys\na=sys.argv[1:]\nwith open(os.environ["ADB_CALL_LOG"],"a") as f:f.write(" ".join(a)+"\\n")\nif a==["version"]: print("Android Debug Bridge version 1.0.41")\nelif a[-1:]==["get-state"]: print("device" if os.environ.get("ADB_SERVER_SOCKET")==os.environ["EXPECTED_SOCKET"] else "offline")\nelif a[-2:]==["getprop","ro.product.model"]: print("MODEL")\nelse: sys.exit(8)\n',{mode:0o755});
 const base={...process.env,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_ADB_BIN:adb,DOUYIN_PYTHON_BIN:'/usr/bin/python3',DOUYIN_PHONE_TMP_ROOT:join(dir,'tmp'),ADB_CALL_LOG:log,EXPECTED_SOCKET:`tcp:127.0.0.1:${s.port}`};
 const call=(op,socket)=>new Promise(resolve=>{const c=spawn('zsh',[new URL('../douyin-phone-adb',import.meta.url).pathname,'--profile','p',op],{env:{...base,ADB_SERVER_SOCKET:socket}});let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('close',status=>resolve({status,out,err}));});
 const good=await call('status',base.EXPECTED_SOCKET);assert.equal(good.status,0,good.err);assert.match(good.out,/431 device MODEL/);
 const before=readFileSync(log,'utf8');assert.doesNotMatch(before,/start-server|kill-server/);
 const bad=await call('status','tcp:evil.example:5037');assert.notEqual(bad.status,0);assert.equal(readFileSync(log,'utf8'),before);
 const lock=await call('lock-status','tcp:evil.example:5037');assert.equal(lock.status,0,lock.err);assert.match(lock.out,/lock=free/);assert.equal(readFileSync(log,'utf8'),before);
 const refresh=await call('refresh',base.EXPECTED_SOCKET);assert.notEqual(refresh.status,0);assert.equal(readFileSync(log,'utf8'),before);
 writeFileSync(adb,readFileSync(adb,'utf8').replace('1.0.41','1.0.40'));const wrongClient=await call('status',base.EXPECTED_SOCKET);assert.notEqual(wrongClient.status,0);assert.match(wrongClient.err,/ADB_ROUTE_CLIENT_PROTOCOL_MISMATCH/);assert.equal(readFileSync(log,'utf8'),before+'version\n');
});
}
let fixtureRoot, fixture;
function initializeFixture(){
fixtureRoot=mkdtempSync(join(tmpdir(),'adb-socket-fixture-'));
const root=fixtureRoot,ready=join(root,'ready');
const child=spawn(process.execPath,[self,'--fixture-worker',ready,String(process.pid)],{stdio:'ignore'});child.unref();
const deadline=Date.now()+5000;while(!existsSync(ready)&&Date.now()<deadline)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
if(!existsSync(ready))throw Error('fake existing ADB socket did not become ready');
process.env.ADB_SERVER_SOCKET='tcp:127.0.0.1:'+readFileSync(ready,'utf8').trim();
process.on('exit',()=>{try{child.kill('SIGTERM');}catch{}rmSync(root,{recursive:true,force:true});});
fixture=function(bin){
 const file=join(root,createHash('sha256').update(bin).digest('hex'));
 // fake旧客户端显式声明相同ADB协议，其余参数/输出原样交原fixture。
 writeFileSync(file,'#!/bin/sh\nif [ "$#" -eq 1 ] && [ "$1" = version ]; then printf "Android Debug Bridge version 1.0.41\\n"; exit 0; fi\nexec '+"'"+bin.replaceAll("'","'\\''")+"'"+' "$@"\n',{mode:0o755});
 return file;
}

}
if(!direct)initializeFixture();
export function fixtureAdb(bin){if(!fixture)initializeFixture();return fixture(bin);}
