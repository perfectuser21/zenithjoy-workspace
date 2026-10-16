import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('pinned SDK31 runtime fixed-byte staging and read-only push regressions',()=>{
 const suite=fileURLToPath(new URL('../runtime/tests/',import.meta.url));
 const r=spawnSync('python3',['-W','error::ResourceWarning','-m','unittest','discover','-s',suite,'-v'],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
});
