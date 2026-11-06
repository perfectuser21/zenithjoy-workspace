import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

test('CI cancellation closes its owned PostgreSQL before returning and removes only its private directory',{timeout:30000},async t=>{
 assert.equal(process.platform,'darwin','this test is required on the Darwin gate');
 assert.ok(process.env.PREFLIGHT_TEST_PG_BIN,'explicit disposable PG binary is required');
 const child=spawn(process.execPath,['scripts/ci/native-103-darwin-tests.mjs'],{cwd:resolve(import.meta.dirname,'../../..'),env:process.env,stdio:['ignore','pipe','pipe']});
 let output='',error='',cancelled=false;
 t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');});
 child.stdout.on('data',b=>{output+=b.toString();if(!cancelled&&output.includes('"event":"native103-private-pg-ready"')){cancelled=true;child.kill('SIGTERM');}});
 child.stderr.on('data',b=>{error+=b.toString();});
 const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 assert.equal(cancelled,true,output+'\n'+error);
 assert.equal(result.signal,null,'signal must enter the finally cleanup path');
 assert.notEqual(result.code,0,'cancelled is not passing business evidence');
 const records=output.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 const ready=records.find(r=>r.event==='native103-private-pg-ready'),closed=records.find(r=>r.event==='native103-private-pg-close');
 assert.ok(closed,output+'\n'+error);assert.equal(closed.owned_pid,ready.owned_pid);assert.equal(closed.stopped,true);assert.ok(closed.result);
 assert.equal(existsSync(closed.directory),false,'after actual PG close, the owned temporary directory is removed');
});
