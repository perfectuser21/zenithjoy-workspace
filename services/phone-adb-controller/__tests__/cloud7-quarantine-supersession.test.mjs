import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('cloud7 non-replay supersession preserves historical unknowns and guards the real lock transaction',()=>{
 const result=spawnSync('python3',[fileURLToPath(new URL('./cloud7-quarantine-supersession.test.py',import.meta.url))],{encoding:'utf8',timeout:60000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
