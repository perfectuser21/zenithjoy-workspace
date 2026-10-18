import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('orphan check excludes pinned source cache while retaining real business tests',t=>{
 const root=mkdtempSync(join(tmpdir(),'orphan-cache-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const file of ['real.test.ts','.skills-source/sprints/fixture.test.ts','.skills-runtime/manual.test.ts']){mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),'fixture');}
 const yaml=readFileSync(new URL('../../../.github/workflows/ci-l2-consistency.yml',import.meta.url),'utf8');
 const command=yaml.match(/FOUND_FILES=\$\((find \.[\s\S]*?)\)\n/)[1].replace(/\\\n\s*/g,' ');
 const actual=execFileSync('bash',['-c',command],{cwd:root,encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(actual,['real.test.ts']);
});
