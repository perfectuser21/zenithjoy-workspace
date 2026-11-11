import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {seedFrozen} from './fixtures/frozen-runtime.mjs';
import {transportFixture} from './candidate-transport-fixture.mjs';
function importEntry(path,home){return spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(path).href)});`],{env:{HOME:home,PATH:process.env.PATH},encoding:'utf8',timeout:10000});}
test('historical frozen fixture retains actual runtime-receipts static import closure before prepare',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'fixture-frozen-closure-')));t.after(()=>rmSync(root,{recursive:true,force:true}));seedFrozen(root,null);const result=importEntry(join(root,'runtime/runtime-receipts.mjs'),root);assert.equal(result.status,0,result.stderr);
});
test('candidate transport fixture retains actual collector static import closure before any SSH',t=>{
 const f=transportFixture(t),result=importEntry(join(f.source,'services/phone-adb-controller/deployment-manifest.mjs'),f.home);assert.equal(result.status,0,result.stderr);assert.equal(f.calls().length,0);
});
