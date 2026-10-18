import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
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
});
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
});
