import test from 'node:test';
import assert from 'node:assert/strict';
import {runDriftCheck} from '../deployment-drift.mjs';

test('真实子进程必须退出0且给出DRIFT_CHECK OK，stdin不能吞外层部署脚本',()=>{
 const call=(code)=>runDriftCheck(process.execPath,['-e',code],process.env);
 assert.match(call("let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',()=>{if(raw)process.exit(1);console.log('DRIFT_CHECK OK')})"),/DRIFT_CHECK OK/);
 assert.throws(()=>call("console.log('all copied')"),/真实成功回执/);
 assert.throws(()=>call("console.log('DRIFT_CHECK OK');process.exit(1)"));
});
