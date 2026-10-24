import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('repeatable WeChat Pad QR boundary regressions',()=>{
 const dir=fileURLToPath(new URL('../../wechat-phone-controller/',import.meta.url));
 const r=spawnSync('python3',['-m','unittest','discover','-s',dir+'tests','-p','test_pad_login.py','-v'],{env:{...process.env,PYTHONPATH:dir},encoding:'utf8',timeout:20000,maxBuffer:2000000});
 assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
});
