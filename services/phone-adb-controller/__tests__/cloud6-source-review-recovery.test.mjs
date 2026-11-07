import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('cloud6 source-only recovery verifies real filesystem and guarded archive transitions',()=>{
 const result=spawnSync('python3',[fileURLToPath(new URL('./cloud6-source-review-recovery.test.py',import.meta.url))],{encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
