import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('Commander Code/Skill共用动作账、读回与迟到隔离',()=>{
 const r=spawnSync('python3',['-B','services/phone-adb-controller/__tests__/commander-actions.test.py'],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stdout+r.stderr);
});
