import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readImplementationSource} from '../implementation-skill-source.mjs';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=f@f','-c','commit.gpgsign=false','commit','-qm','fixture');return git(root,'rev-parse','HEAD');};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'trusted-skill-reader-')),business=join(root,'business'),central=join(root,'central');
 for(const dir of [business,central]){mkdirSync(dir);git(dir,'init','-q');git(dir,'config','core.hooksPath','/dev/null');}
 git(business,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const path='scripts/phone-account-patrol/SKILL.md',payload=Buffer.from('real source\n\n');
 mkdirSync(join(business,'scripts/phone-account-patrol'),{recursive:true});writeFileSync(join(business,path),payload);
 const before=commit(business);mkdirSync(join(central,'distribution'));writeFileSync(join(central,'body.md'),payload);
 const catalog={profiles:{zenithjoy:{files:[{path,source:'body.md',sha256:createHash('sha256').update(payload).digest('hex')}]}}};
 writeFileSync(join(central,'distribution/catalog.json'),JSON.stringify(catalog));const revision=commit(central);
 rmSync(join(business,path));writeFileSync(join(business,'.skills-source.json'),JSON.stringify({version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision,loader_sha256:'0'.repeat(64)}));
 writeFileSync(join(business,'scripts/skills-source.py'),"raise Exception('CANDIDATE_MUST_NOT_EXECUTE')\n");
 const after=commit(business);
 return {business,central,path,payload,before,after,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test('reads exact old and migrated Git bytes without executing candidate loader',()=>{
 const f=fixture();try{
  assert.deepEqual(readImplementationSource(f.business,f.before,f.path,{source:f.central}),f.payload);
  assert.deepEqual(readImplementationSource(f.business,f.after,f.path,{source:f.central}),f.payload);
  writeFileSync(join(f.central,'body.md'),'new checkout content must not be read');commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),'poisoned working copy');
  assert.deepEqual(readImplementationSource(f.business,f.after,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
test('rejects missing entries, checksum mismatch and wrong profile',()=>{
 const f=fixture();try{
  assert.throws(()=>readImplementationSource(f.business,f.after,'missing/SKILL.md',{source:f.central}));
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.profile='cecelia';
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const wrong=commit(f.business);
  assert.throws(()=>readImplementationSource(f.business,wrong,f.path,{source:f.central}),/PROFILE/);
  lock.profile='zenithjoy';const catalog={profiles:{zenithjoy:{files:[{path:f.path,source:'body.md',sha256:'0'.repeat(64)}]}}};
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const corrupt=commit(f.business);
  assert.throws(()=>readImplementationSource(f.business,corrupt,f.path,{source:f.central}),/CHECKSUM/);
 }finally{f.cleanup();}
});
test('Git replacement objects cannot change historical business source',()=>{
 const f=fixture();try{
  const original=git(f.business,'rev-parse',`${f.before}:${f.path}`);
  const replacement=execFileSync('git',['-C',f.business,'hash-object','-w','--stdin'],{input:'malicious replacement',encoding:'utf8'}).trim();
  git(f.business,'replace',original,replacement);
  assert.deepEqual(readImplementationSource(f.business,f.before,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
test('Cecelia identity must select the Cecelia profile at the pinned revision',()=>{
 const f=fixture();try{
  git(f.business,'remote','set-url','origin','git@github.com:perfectuser21/cecelia.git');
  const catalog={profiles:{cecelia:{files:[{path:f.path,source:'body.md',sha256:createHash('sha256').update(f.payload).digest('hex')}]}}};
  writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));
  const lock=JSON.parse(git(f.business,'show',`${f.after}:.skills-source.json`));lock.profile='cecelia';lock.revision=commit(f.central);
  writeFileSync(join(f.business,'.skills-source.json'),JSON.stringify(lock));const revision=commit(f.business);
  assert.deepEqual(readImplementationSource(f.business,revision,f.path,{source:f.central}),f.payload);
 }finally{f.cleanup();}
});
