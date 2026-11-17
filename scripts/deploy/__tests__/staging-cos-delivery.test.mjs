import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('COS 私有传输、完整下载与失败清理回归',()=>{
 const result=spawnSync('python3',['scripts/deploy/__tests__/staging-cos-delivery.test.py'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+result.stderr);
});
