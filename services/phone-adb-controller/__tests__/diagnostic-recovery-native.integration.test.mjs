import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
test('真实SDK deadline未知/精确终态→新diagnostic-serve→双fresh startup/host/CAS完整main',{timeout:450000},()=>{
 const runner=fileURLToPath(new URL('./fixtures/epoch-resume-native/diagnostic-runner.mjs',import.meta.url)),r=spawnSync(process.execPath,[runner],{encoding:'utf8',timeout:420000,env:process.env,maxBuffer:1048576});
 assert.equal(r.status,0,r.stderr||r.stdout);const summary=JSON.parse(r.stdout.trim().split('\n').at(-1));assert.equal(summary.actual_main,true);assert.equal(summary.status,'fenced');assert.equal(summary.field_actions,0);assert.equal(summary.original_execution_stopped,false);assert.equal(summary.recovery_stop_signals,0);assert.equal(summary.recovery_start_calls,1);assert.equal(summary.recovery_connect_calls,1);
});
