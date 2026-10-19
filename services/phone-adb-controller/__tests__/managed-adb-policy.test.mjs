import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const helper=new URL('../adb-existing-route.py',import.meta.url).pathname;
async function socket(t,devices){
 const requests=[],connections=new Set();
 const server=net.createServer(c=>{
  connections.add(c);c.on('error',()=>{});c.on('close',()=>connections.delete(c));let input=Buffer.alloc(0);
  c.on('data',b=>{
   input=Buffer.concat([input,b]);if(input.length<4)return;
   const length=parseInt(input.subarray(0,4).toString(),16);if(input.length<4+length)return;
   const service=input.subarray(4,4+length).toString();requests.push(service);
   assert.ok(['host:version','host:devices'].includes(service),'probe must remain read only');
   const value=Buffer.from(service==='host:version'?'0029':devices);
   c.end(Buffer.concat([Buffer.from('OKAY'+value.length.toString(16).padStart(4,'0')),value]));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of connections)c.destroy();server.close();});
 return {port:server.address().port,requests};
}
function fixture(t,primary,forbidden){
 const root=mkdtempSync(join(tmpdir(),'managed-adb-policy-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'adb-host.json');
 writeFileSync(path,JSON.stringify({schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:`tcp:127.0.0.1:${primary}`,forbidden_ports:forbidden}),{mode:0o600});
 return path;
}
async function select(config,ports,configured=''){
 const code=`import importlib.util,sys,json
s=importlib.util.spec_from_file_location('route',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
try: print(m.select_route('431',sys.argv[2],ports=json.loads(sys.argv[3]),budget=1.5))
except Exception as e: print(str(e),file=sys.stderr);sys.exit(2)`;
 return new Promise(resolve=>{
  const child=spawn('python3',['-c',code,helper,configured,JSON.stringify(ports)],{env:{...process.env,ZJ_ADB_HOST_CONFIG:config}});
  let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.on('close',status=>resolve({status,stdout:stdout.trim(),stderr}));
 });
}
test('受管USB宿主发现额外ADB服务时拒绝，不能把唯一目标匹配当作服务无争抢',async t=>{
 const a=await socket(t,'431\tdevice\n'),b=await socket(t,'422\tdevice\n');
 const result=await select(fixture(t,a.port,[b.port]),[a.port,b.port]);
 assert.notEqual(result.status,0,'a second USB-scanning server must make the managed host unhealthy');
 assert.match(result.stderr,/ADB_HOST_EXTRA_SERVER/);
});
test('受管设备出现在错误端口时拒绝，显式socket不能绕过宿主唯一入口',async t=>{
 const a=await socket(t,'422\tdevice\n'),b=await socket(t,'431\tdevice\n');
 const result=await select(fixture(t,a.port,[b.port]),[a.port,b.port],`tcp:127.0.0.1:${b.port}`);
 assert.notEqual(result.status,0,'configured legacy port cannot override the managed endpoint');
 assert.match(result.stderr,/ADB_HOST_ENDPOINT_MISMATCH|ADB_HOST_EXTRA_SERVER/);
});
test('显式受管配置缺失时拒绝，不退回扫描三端口',async t=>{
 const a=await socket(t,'431\tdevice\n');const path=fixture(t,a.port,[])+'-missing';
 const result=await select(path,[a.port]);
 assert.notEqual(result.status,0,'a missing managed policy must not silently enable legacy routing');
 assert.match(result.stderr,/ADB_HOST_CONFIG/);
 assert.deepEqual(a.requests,[],'fail before contacting any device transport');
});
