import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('MMV policy-only install smoke: private install, idempotency and failure preservation',()=>{
 const r=spawnSync('python3',[new URL('./adb-mmv-policy-install.test.py',import.meta.url).pathname],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr||r.stdout);
});
