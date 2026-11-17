import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('actual account-preflight fixture inventory remains within the unchanged native source limit',t=>{
 const directory=mkdtempSync(join(tmpdir(),'preflight-inventory-')),root=join(directory,'runtime');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const fixture=readFileSync(new URL('./fixtures/public-code-preflight-native.mjs',import.meta.url),'utf8');
 const copy=fixture.match(/ const sourceRoot=new URL\('\.\.\/\.\.\/',import.meta.url\),[\s\S]*?\n cpSync\([^\n]+\);/)[0];
 // Execute the actual fixture copy/filter, then its actual synthetic ROM review
 // addition. No phone, runtime import, provider or network is involved.
 const executable=copy.replace("new URL('../../',import.meta.url)",'sourceUrl');
 new Function('cpSync','relative','sourceUrl','root',executable)(cpSync,relative,new URL('../',import.meta.url),root);
 const review=fixture.match(/ const reviewPath='[^']+';writeFileSync\([^\n]+\);/)[0];
 new Function('writeFileSync','join','root',review)(writeFileSync,join,root);
 const files=[];function walk(base,prefix=''){for(const e of readdirSync(base,{withFileTypes:true})){const path=prefix+e.name;e.isDirectory()?walk(join(base,e.name),path+'/'):files.push(path);}}walk(root);
 assert.ok(files.includes('config/native-phone-reviews/fixture-public-code.md'));
 assert.ok(files.includes('comment-compose-rows.py'),'queued recipient import requires the shared parser');
 const tracked=new Set(execFileSync('git',['ls-files','--','services/phone-adb-controller'],{cwd:fileURLToPath(new URL('../../../',import.meta.url)),encoding:'utf8'}).trim().split('\n').map(p=>p.replace(/^services\/phone-adb-controller\//,'')));
 assert.ok(files.length<=512,JSON.stringify({files:files.length,synthetic_review:1,qualification:files.filter(x=>x.startsWith('qualification-artifacts.')),extra_source_paths:files.filter(p=>p!=='config/native-phone-reviews/fixture-public-code.md'&&!tracked.has(p)).sort()}));
});
