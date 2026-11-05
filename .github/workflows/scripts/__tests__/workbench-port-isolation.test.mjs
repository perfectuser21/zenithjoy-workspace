import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import YAML from 'yaml';
const tool=fileURLToPath(new URL('../smoke/lib/workbench-port.mjs',import.meta.url));
const cli=(...args)=>spawnSync(process.execPath,[tool,...args],{encoding:'utf8',timeout:5000});
test('自动选择实际API与相邻mutation两端口，范围合法；释放后竞争必须如实拒绝',()=>{const r=cli('allocate');assert.equal(r.status,0,r.stderr);const port=Number(r.stdout);assert.ok(Number.isInteger(port)&&port>0&&port<65535);const checked=cli('check-pair',String(port));if(checked.status!==0)assert.match(checked.stderr,/WORKBENCH_PORT_BUSY/);});
test('相邻mutation端口被真实外来listener占用也必须拒绝',async()=>{const r=cli('allocate');assert.equal(r.status,0,r.stderr);const port=Number(r.stdout),foreign=createServer();foreign.listen(port+1,'127.0.0.1');await once(foreign,'listening');try{const checked=cli('check-pair',String(port));assert.equal(checked.status,1);assert.match(checked.stderr,/WORKBENCH_PORT_BUSY/);assert.equal(foreign.listening,true);}finally{await new Promise(resolve=>foreign.close(resolve));}});
test('显式65535或无效端口拒绝，不能令MUT_PORT溢出',()=>{for(const value of ['65535','0','-1','auto','123;true']){const r=cli('check',value);assert.equal(r.status,1);assert.match(r.stderr,/WORKBENCH_PORT_RANGE/);}});
const workflow=YAML.parse(readFileSync(new URL('../../ci-smoke-glob-runner.yml',import.meta.url),'utf8'));
const run=Object.values(workflow.jobs).flatMap(j=>j.steps||[]).find(s=>s.run?.includes('run_one()')).run;
const functionText=name=>{const text=run.match(new RegExp(name+'\\(\\) \\{[\\s\\S]*?\\n\\}'))?.[0];assert.ok(text,name);return text;};
function invoke(t,name,explicit){
 const top=mkdtempSync(join(tmpdir(),'workbench-run-one-'));t.after(()=>rmSync(top,{recursive:true,force:true}));mkdirSync(join(top,'lib'));mkdirSync(join(top,'bin'));copyFileSync(tool,join(top,'lib/workbench-port.mjs'));
 for(const script of ['structured-workbench-smoke.sh','staff-workbench-smoke.sh','staff-acceptance-smoke.sh','knowledge-hub-path1-smoke.sh','staff-workbench-near-smoke.sh','unrelated-smoke.sh'])writeFileSync(join(top,script),'#!/bin/sh\nprintf "selected=%s\\n" "${WORKBENCH_SMOKE_PORT:-${STAFF_WORKBENCH_SMOKE_PORT:-${STAFF_ACCEPTANCE_SMOKE_PORT:-${KNOWLEDGE_SMOKE_PORT:-unset}}}}"\n');
 writeFileSync(join(top,'bin/timeout'),'#!/bin/sh\nprintf "timeout %s %s\\n" "$1" "$2" >> "$TEST_TIMEOUT_TRACE"\nshift 2\nexec "$@"\n',{mode:0o755});
 const env={...process.env,DIR:top,PATH:join(top,'bin')+':'+process.env.PATH,TEST_TIMEOUT_TRACE:join(top,'timeout.trace')};for(const name of ['WORKBENCH_SMOKE_PORT','STAFF_WORKBENCH_SMOKE_PORT','STAFF_ACCEPTANCE_SMOKE_PORT','KNOWLEDGE_SMOKE_PORT'])delete env[name];if(explicit){const key=name==='staff-workbench-smoke.sh'?'STAFF_WORKBENCH_SMOKE_PORT':name==='staff-acceptance-smoke.sh'?'STAFF_ACCEPTANCE_SMOKE_PORT':name==='knowledge-hub-path1-smoke.sh'?'KNOWLEDGE_SMOKE_PORT':'WORKBENCH_SMOKE_PORT';env[key]=explicit;}
 const r=spawnSync('/bin/bash',['-c',functionText('script_timeout')+'\n'+functionText('run_one')+'\nrun_one "$1"','test',name],{env,encoding:'utf8',timeout:5000});return {...r,trace:readFileSync(join(top,'timeout.trace'),'utf8')};
}
test('实际run_one仅structured隔离端口且分配在原180秒内',t=>{const r=invoke(t,'structured-workbench-smoke.sh');assert.equal(r.status,0,r.stderr);const port=Number(r.stdout.match(/selected=(\d+)/)?.[1]);assert.ok(port>0&&port<65535);assert.match(r.trace,/timeout --kill-after=5s 180/);});
test('实际run_one保留显式WORKBENCH_SMOKE_PORT，不静默覆盖',t=>{const r=invoke(t,'structured-workbench-smoke.sh','19327');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/selected=19327/);});
test('实际run_one其他脚本保持原命令/默认90秒且不注入端口',t=>{const r=invoke(t,'unrelated-smoke.sh');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/selected=unset/);assert.match(r.trace,/timeout --kill-after=5s 90/);});

test('未分配的p+2外来占用不影响p和p+1各自检查，且外来listener保持',async()=>{const r=cli('allocate');assert.equal(r.status,0,r.stderr);const port=Number(r.stdout),foreign=createServer();foreign.listen(port+2,'127.0.0.1');await once(foreign,'listening');try{for(const p of [port,port+1]){const checked=cli('check',String(p));assert.equal(checked.status,0,checked.stderr);}assert.equal(cli('check-pair',String(port)).status,0);assert.equal(foreign.listening,true);}finally{await new Promise(resolve=>foreign.close(resolve));}});
for(const [name,fixed]of [['staff-workbench-smoke.sh',52112],['staff-acceptance-smoke.sh',52108],['knowledge-hub-path1-smoke.sh',52310]]){
 test('精确CI wrapper默认选择合法pair，旧固定端口真实被占仍不干扰：'+name,async t=>{
  const foreign=createServer();let owned=false;
  await new Promise((resolve,reject)=>{foreign.once('error',error=>error.code==='EADDRINUSE'?resolve():reject(error));foreign.listen(fixed,'127.0.0.1',()=>{owned=true;resolve();});});
  if(owned)t.after(()=>new Promise(resolve=>foreign.close(resolve)));else assert.equal(cli('check',String(fixed)).status,1,'既有外来占用不归本测试清理');
  const r=invoke(t,name);assert.equal(r.status,0,r.stderr);const selected=Number(r.stdout.match(/selected=(\d+)/)?.[1]);assert.ok(selected>0&&selected<65535);assert.notEqual(selected,fixed);
  assert.equal(cli('check-pair',String(selected)).status,0);if(owned)assert.equal(foreign.listening,true);assert.match(r.trace,/timeout --kill-after=5s 90/);
 });
 test('精确CI wrapper显式端口保留，真实占用拒绝且不另选/杀进程：'+name,async t=>{
  const allocated=cli('allocate');assert.equal(allocated.status,0,allocated.stderr);const port=Number(allocated.stdout);
  const allowed=invoke(t,name,String(port));assert.equal(allowed.status,0,allowed.stderr);assert.match(allowed.stdout,new RegExp('selected='+port+'\\n'));
  const foreign=createServer();foreign.listen(port,'127.0.0.1');await once(foreign,'listening');t.after(()=>new Promise(resolve=>foreign.close(resolve)));
  const blocked=invoke(t,name,String(port));assert.equal(blocked.status,1);assert.match(blocked.stderr,/WORKBENCH_PORT_BUSY/);assert.doesNotMatch(blocked.stdout,/selected=/);assert.equal(foreign.listening,true);assert.match(blocked.trace,/timeout --kill-after=5s 90/);
 });
}
test('knowledge显式p空闲但p+1真实占用，原90秒范围内拒绝且foreign保持',async t=>{
 const allocated=cli('allocate');assert.equal(allocated.status,0,allocated.stderr);const port=Number(allocated.stdout),foreign=createServer();foreign.listen(port+1,'127.0.0.1');await once(foreign,'listening');t.after(()=>new Promise(resolve=>foreign.close(resolve)));
 const r=invoke(t,'knowledge-hub-path1-smoke.sh',String(port));assert.equal(r.status,1);assert.match(r.stderr,/WORKBENCH_PORT_BUSY/);assert.doesNotMatch(r.stdout,/selected=/);assert.equal(foreign.listening,true);assert.match(r.trace,/timeout --kill-after=5s 90/);
});
test('近似名不获得CI端口注入或额外预算',t=>{const r=invoke(t,'staff-workbench-near-smoke.sh');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/selected=unset/);assert.match(r.trace,/timeout --kill-after=5s 90/);});
