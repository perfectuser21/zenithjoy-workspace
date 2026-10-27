// Isolated synthetic processes only; no live ADB/device or process.kill mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const target=fileURLToPath(new URL('../native-operation-receipt.mjs',import.meta.url));

// Each case gets a fresh OS process, PATH and actual child. No process.kill mock.
for(const field of ['pid','start_identity','uid','pgid'])test('真实合成子进程身份漂移必须拒TERM：'+field,{timeout:15000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'native-observer-negative-')),bin=join(dir,'bin');mkdirSync(bin);
 const shim=`#!${process.execPath}
const fs=require('fs'),cp=require('child_process'),p=require('path');
const a=process.argv.slice(2),mode=a.at(-1),pid=a.at(-2),d=process.env.NATIVE_CASE_DIR;
if(['identity','children','group'].includes(mode)){
 const count=p.join(d,mode+'-'+pid+'.count');let n=0;try{n=Number(fs.readFileSync(count,'utf8'));}catch{}fs.writeFileSync(count,String(++n));
 const r=cp.spawnSync('/usr/bin/python3',a,{encoding:'utf8',timeout:2000});
 if(r.status!==0){process.stderr.write(r.stderr||'');process.exit(r.status||2);}
 let out=r.stdout;
 if(mode==='identity'&&pid===process.env.NATIVE_ROOT_PID&&n>=3){const v=JSON.parse(out);if(v){const k=process.env.NATIVE_DRIFT_FIELD;v[k]=k==='start_identity'?'wrong-start':v[k]+1;out=JSON.stringify(v);}}
 process.stdout.write(out);process.exit(0);
}
const c=cp.spawn('/usr/bin/python3',a,{stdio:'inherit'});process.on('SIGTERM',()=>c.kill('SIGTERM'));c.on('exit',(code)=>process.exit(code||0));
`;
 writeFileSync(join(bin,'python3'),shim,{mode:0o755});
 const fixture=join(dir,'fixture.mjs');
 writeFileSync(fixture,`import {spawn} from 'node:child_process';import fs from 'node:fs';import {beginNativeOperation} from ${JSON.stringify(pathToFileURL(target).href)};
const child=spawn(process.execPath,['-e',${JSON.stringify("const fs=require('fs');process.on('SIGTERM',()=>fs.writeFileSync(process.env.NATIVE_CASE_DIR+'/signalled','TERM'));fs.writeFileSync(process.env.NATIVE_CASE_DIR+'/target-ready','ready');setTimeout(()=>process.exit(0),5000);setInterval(()=>{},1000)")}],{detached:true,stdio:'ignore'});process.env.NATIVE_ROOT_PID=String(child.pid);
const closed=new Promise(r=>child.once('close',r));const readyDeadline=Date.now()+1500;while(!fs.existsSync(${JSON.stringify(join(dir,'target-ready'))})){if(Date.now()>readyDeadline)throw Error('FIXTURE_TARGET_NOT_READY');await new Promise(r=>setTimeout(r,5));}
try{const op=beginNativeOperation({runDir:${JSON.stringify(dir)},operationId:'synthetic-drift',runId:'synthetic__a1',taskId:'synthetic-task',profile:'synthetic',serial:'NO-DEVICE',sourceCommit:'a'.repeat(40),owner:'synthetic-owner',activity:'preflight'});await op.started(child.pid);const sent=await op.signalTargets('SIGTERM');await new Promise(r=>setTimeout(r,100));const signalled=fs.existsSync(${JSON.stringify(join(dir,'signalled'))});const alive_before_cleanup=child.exitCode===null&&child.signalCode===null;child.kill('SIGKILL');await closed;const proof=await op.stop(null,0,null);console.log(JSON.stringify({sent,signalled,alive_before_cleanup,status:proof.status,execution_stopped:proof.execution_stopped}));}finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
`);
 try{
  const output=await new Promise((resolve,reject)=>{
   const c=spawn(process.execPath,[fixture],{env:{...process.env,PATH:bin+':'+process.env.PATH,NATIVE_CASE_DIR:dir,NATIVE_DRIFT_FIELD:field},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>c.kill('SIGKILL'),12000);
   c.stdout.on('data',b=>stdout+=b);c.stderr.on('data',b=>stderr+=b);c.once('error',reject);c.once('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)reject(Error('fixture exit '+code+'/'+signal+': '+stderr));else resolve(JSON.parse(stdout.trim()));});
  });
  assert.equal(output.alive_before_cleanup,true,'actual target must still be live; TTL/setup failure cannot pass');assert.equal(output.sent,0);assert.equal(output.signalled,false);assert.equal(output.status,'unknown');assert.equal(output.execution_stopped,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
