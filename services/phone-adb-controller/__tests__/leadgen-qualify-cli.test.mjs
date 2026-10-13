// 真实CLI→显式本地RPC替身：只核参数传输及拒绝边界，不声称调用模型/数据库/手机。
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RPC_FILES} from '../leadgen-client.mjs';
import {digest} from '../runtime-definition.mjs';

const CLIENT=fileURLToPath(new URL('../leadgen-client.mjs',import.meta.url));
const RUN='codexyellow20261013s121ddc00_102',SOURCE='codexyellow20261013s121ddc00_101';
const BASE=['qualify','judge','--line','AI人工智能训练师','--run',RUN,'--source-run',SOURCE,'--video-id','7637880891511528896','--audio',`/tmp/qv-${RUN}-7637880891511528896.wav`];
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'leadgen-qualify-cli-')),capture=join(dir,'captured.json');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const files={};
 for(const name of RPC_FILES){const p=join(dir,'runtime',name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,'explicit frozen dependency fixture\n');files['runtime/'+name]=digest(readFileSync(p));}
 const body={deployment:{source_commit:'a'.repeat(40)},files};writeFileSync(join(dir,'run-definition.json'),JSON.stringify({...body,snapshot_sha256:digest(body)}));
 writeFileSync(join(dir,'leadgen-rpc.mjs'),`import{readFileSync,writeFileSync}from'node:fs';const body=JSON.parse(readFileSync(0,'utf8'));writeFileSync(${JSON.stringify(capture)},JSON.stringify(body));process.stdout.write(JSON.stringify({ok:true,result:{kind:'explicit-test-rpc',request:body.request}}));`);
 return{capture,run:args=>spawnSync(process.execPath,[CLIENT,...args],{encoding:'utf8',timeout:3000,env:{...process.env,WFR_RUN_DIR:dir,WF_HOME:dir,LEADGEN_LOCAL_RPC:'1'}})};
}
test('102真实取链批次CLI完整转发run/sourceRun与原判断输入',t=>{
 const c=fixture(t),r=c.run(BASE);assert.equal(r.status,0,r.stdout+r.stderr);
 const b=JSON.parse(readFileSync(c.capture,'utf8'));assert.equal(b.kind,'qualify');assert.deepEqual(b.request,{line:'AI人工智能训练师',run:RUN,sourceRun:SOURCE,videoId:'7637880891511528896',audio:`/tmp/qv-${RUN}-7637880891511528896.wav`,cmd:'judge'});
 assert.equal(b.source.commit,'a'.repeat(40));assert.equal(b.source.files.length,RPC_FILES.length);
});
test('102独立判断保留可选上游语义，仍转发本run',t=>{
 const c=fixture(t),args=BASE.filter((_,i)=>![6,7].includes(i)),r=c.run(args);assert.equal(r.status,0,r.stdout+r.stderr);const b=JSON.parse(readFileSync(c.capture,'utf8'));assert.equal(b.request.run,RUN);assert.equal(b.request.sourceRun,undefined);
});
for(const [label,args] of [
 ['未知flag',[...BASE,'--unknown','x']],
 ['缺run',BASE.filter((_,i)=>![4,5].includes(i))],
 ['run选项串',BASE.map((x,i)=>i===5?'--help':x)],
 ['run路径穿越',BASE.map((x,i)=>i===5?'../run':x)],
 ['run超长',BASE.map((x,i)=>i===5?'r'.repeat(121):x)],
 ['缺上游值',BASE.map((x,i)=>i===7?'':x)],
 ['坏上游',BASE.map((x,i)=>i===7?'../source':x)],
 ['上游等于本run',BASE.map((x,i)=>i===7?RUN:x)],
 ['重复run',[...BASE,'--run','different-run']],
])test(`${label}在任何RPC前拒绝`,t=>{
 const c=fixture(t),r=c.run(args);assert.equal(r.status,1);assert.match(r.stdout,/"kind":"rpc_error"/);assert.equal(existsSync(c.capture),false);
});
