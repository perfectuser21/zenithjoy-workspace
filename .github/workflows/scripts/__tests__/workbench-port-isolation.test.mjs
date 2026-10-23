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
 for(const script of ['structured-workbench-smoke.sh','unrelated-smoke.sh'])writeFileSync(join(top,script),'#!/bin/sh\nprintf "selected=%s\\n" "${WORKBENCH_SMOKE_PORT:-unset}"\n');
 writeFileSync(join(top,'bin/timeout'),'#!/bin/sh\nprintf "timeout %s %s\\n" "$1" "$2" >> "$TEST_TIMEOUT_TRACE"\nshift 2\nexec "$@"\n',{mode:0o755});
 const env={...process.env,DIR:top,PATH:join(top,'bin')+':'+process.env.PATH,TEST_TIMEOUT_TRACE:join(top,'timeout.trace')};delete env.WORKBENCH_SMOKE_PORT;if(explicit)env.WORKBENCH_SMOKE_PORT=explicit;
 const r=spawnSync('/bin/bash',['-c',functionText('script_timeout')+'\n'+functionText('run_one')+'\nrun_one "$1"','test',name],{env,encoding:'utf8',timeout:5000});return {...r,trace:readFileSync(join(top,'timeout.trace'),'utf8')};
}
test('实际run_one仅structured隔离端口且分配在原180秒内',t=>{const r=invoke(t,'structured-workbench-smoke.sh');assert.equal(r.status,0,r.stderr);const port=Number(r.stdout.match(/selected=(\d+)/)?.[1]);assert.ok(port>0&&port<65535);assert.match(r.trace,/timeout --kill-after=5s 180/);});
test('实际run_one保留显式WORKBENCH_SMOKE_PORT，不静默覆盖',t=>{const r=invoke(t,'structured-workbench-smoke.sh','19327');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/selected=19327/);});
test('实际run_one其他脚本保持原命令/默认90秒且不注入端口',t=>{const r=invoke(t,'unrelated-smoke.sh');assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/selected=unset/);assert.match(r.trace,/timeout --kill-after=5s 90/);});

test('未分配的p+2外来占用不影响p和p+1各自检查，且外来listener保持',async()=>{const r=cli('allocate');assert.equal(r.status,0,r.stderr);const port=Number(r.stdout),foreign=createServer();foreign.listen(port+2,'127.0.0.1');await once(foreign,'listening');try{for(const p of [port,port+1]){const checked=cli('check',String(p));assert.equal(checked.status,0,checked.stderr);}assert.equal(cli('check-pair',String(port)).status,0);assert.equal(foreign.listening,true);}finally{await new Promise(resolve=>foreign.close(resolve));}});
