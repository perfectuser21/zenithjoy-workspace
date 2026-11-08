import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('cloud9固定只读源未知非重放迁移永久回归',()=>{
 const r=spawnSync('python3',[fileURLToPath(new URL('./cloud9-quarantine-supersession.test.py',import.meta.url))],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
