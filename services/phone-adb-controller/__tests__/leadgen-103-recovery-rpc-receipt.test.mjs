import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as rpc from '../leadgen-rpc.mjs';
import {RPC_FILES} from '../leadgen-client.mjs';

test('103 受控恢复内部拒绝码不再坍缩为 RPC_OPERATION_FAILED', t => {
  const dir=mkdtempSync(join(tmpdir(),'leadgen-103-rpc-stage-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=resolve('services/phone-adb-controller');
  const commit='a'.repeat(40);
  const preload=join(dir,'preload.cjs');
  writeFileSync(preload,`const fs=require('fs'),Module=require('module');
const read=fs.readFileSync;
fs.readFileSync=function(path,...args){if(String(path).endsWith('/deployment-manifest.json'))return JSON.stringify({source_commit:'${commit}'});return read.call(this,path,...args)};
Module.syncBuiltinESMExports();
const load=Module._load;
Module._load=function(id,parent,...args){
 if(id==='./leadgen-db-connect.js')return {getPool:()=>({end:async()=>{}})};
 if(id==='./leadgen-queue.js')return {queueRequest:async()=>{throw Error('FALSE_EXCLUSION_AUTHORITY_INVALID')}};
 return load.call(this,id,parent,...args);
};`);
  const source={commit,files:RPC_FILES.map(path=>({path,
    sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}))};
  const result=spawnSync(process.execPath,['--require',preload,join(root,'leadgen-rpc.mjs')],{
    input:JSON.stringify({kind:'queue',source,request:{op:'recover_false_exclusion_102l'}}),
    encoding:'utf8',timeout:10000});
  assert.equal(result.error,undefined);
  assert.equal(result.status,1,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{ok:false,error:'RPC_RECOVERY_STAGE:AUTHORITY_INVALID'});
});

test('103 受控恢复的固定拒绝码跨 RPC 保留，任意内部信息不外泄', () => {
  assert.deepEqual(rpc.rpcFailureReceipt(Error('FALSE_EXCLUSION_AUTHORITY_INVALID')),
    {ok:false,error:'RPC_RECOVERY_STAGE:AUTHORITY_INVALID'});
  assert.deepEqual(rpc.rpcFailureReceipt(Error('FALSE_EXCLUSION_UPDATE_FAILED')),
    {ok:false,error:'RPC_RECOVERY_STAGE:UPDATE_FAILED'});
  assert.deepEqual(rpc.rpcFailureReceipt(Error('FALSE_EXCLUSION_AUDIT_WRITE_FAILED')),
    {ok:false,error:'RPC_RECOVERY_STAGE:AUDIT_WRITE_FAILED'});
  assert.deepEqual(rpc.rpcFailureReceipt(Error('FALSE_EXCLUSION_INJECTED_SECRET=abc')),
    {ok:false,error:'RPC_OPERATION_FAILED'});
  assert.deepEqual(rpc.rpcFailureReceipt(Error('password=secret; SQL connection failed')),
    {ok:false,error:'RPC_OPERATION_FAILED'});
});

test('恢复动作停止状态不明时，RPC 不得把阶段码当成已停或成功', () => {
  const error=Error('FALSE_EXCLUSION_UPDATE_FAILED');error.executionStopped=false;
  assert.deepEqual(rpc.rpcFailureReceipt(error),
    {ok:false,error:'RPC_EXECUTION_STOP_UNKNOWN',execution_stopped:false,external_effect:'unknown'});
});
