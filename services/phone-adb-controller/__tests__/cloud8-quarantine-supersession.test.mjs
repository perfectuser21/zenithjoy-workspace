import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('cloud8 observer-only non-replay authority rejects incomplete closure without changing old unknown',()=>{
 const r=spawnSync('python3',[fileURLToPath(new URL('./cloud8-quarantine-supersession.test.py',import.meta.url))],{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
