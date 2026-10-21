// 只用隔离TCP server和本地C客户端；实际managed入口，不连接手机。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const wrapper=new URL('../adb-managed-client.py',import.meta.url).pathname;

async function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'collection-leaf-scope-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const c=join(dir,'client.c'),client=join(dir,'client'),calls=join(dir,'client-calls');
 writeFileSync(c,`#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\nint main(int argc,char **argv){FILE *f=fopen(getenv("LEAF_FIXTURE_CALLS"),"a");if(!f)return 12;for(int i=1;i<argc;i++)fprintf(f,"%s ",argv[i]);fprintf(f,"\\n");fclose(f);if(argc==2&&!strcmp(argv[1],"version"))puts("Android Debug Bridge version 1.0.41");else puts("device");return 0;}\n`);
 const cc=spawnSync('cc',[c,'-o',client],{encoding:'utf8'});assert.equal(cc.status,0,'实际leaf夹具必须成功编译：'+cc.stderr);
 const sockets=new Set(),server=createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});let bytes=Buffer.alloc(0);s.on('data',b=>{bytes=Buffer.concat([bytes,b]);if(bytes.length<4)return;const n=parseInt(bytes.subarray(0,4).toString(),16);if(bytes.length<4+n)return;const q=bytes.subarray(4,4+n).toString(),body=q==='host:version'?'0029':q==='host:devices'?'NO-DEVICE\tdevice\n':null;if(body===null){s.end('FAIL0003bad');return;}s.end('OKAY'+Buffer.byteLength(body).toString(16).padStart(4,'0')+body);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{for(const s of sockets)s.destroy();server.close();});
 const config=join(dir,'policy.json');writeFileSync(config,JSON.stringify({schema_version:1,host_id:'xian-m4',transport:'usb',endpoint:'tcp:127.0.0.1:'+server.address().port,forbidden_ports:[],adb_bin:client,adb_sha256:createHash('sha256').update(readFileSync(client)).digest('hex')}),{mode:0o600});
 const run=(args,extra={})=>new Promise(resolve=>{const p=spawn('python3',[wrapper,...args],{env:{...process.env,HOME:dir,ZJ_ADB_HOST_CONFIG:config,LEAF_FIXTURE_CALLS:calls,...extra}});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('close',code=>resolve({code,stdout,stderr}));});
 return {dir,client,calls,config,run};
}

for(const args of [['version'],['-s','NO-DEVICE','get-state']])test('collection scope声明后缺父broker不可绕到直接实际ADB：'+args.join(' '),async t=>{
 const f=await fixture(t);
 const baseline=await f.run(args);assert.equal(baseline.code,0,baseline.stderr);assert.ok(existsSync(f.calls),'先证明真实managed路径及实际Cleaf可用');rmSync(f.calls);
 const r=await f.run(args,{WFR_COLLECTION_LEAF_SOCKET:join(f.dir,'absent-parent.sock'),WFR_COLLECTION_LEAF_NONCE:'a'.repeat(48)});
 assert.notEqual(r.code,0,'缺父producer不能默默回落到原actualclient');
 assert.equal(existsSync(f.calls),false,'version/route设备分支也必须全部经父producer');
});
