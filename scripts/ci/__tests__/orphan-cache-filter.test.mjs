import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {discoverTests} from '../test-registry.mjs';
test('orphan check excludes pinned source cache while retaining real business tests',t=>{
 const root=mkdtempSync(join(tmpdir(),'orphan-cache-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const file of ['real.test.ts','.skills-source/sprints/fixture.test.ts','.skills-runtime/manual.test.ts']){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'fixture');}
 const actual=discoverTests(root);
 assert.deepEqual(actual,['real.test.ts']);
});
