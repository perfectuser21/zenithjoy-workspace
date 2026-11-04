import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=new URL('../../../../',import.meta.url), path='sprints/old/tests/contract.test.ts',replacement='apps/api/tests/current.test.ts';
const keys=['current_value','active_status','real_effect','test_and_blocking','duplication_and_obsolescence','runtime_and_maintenance_cost','retirement_and_dependencies'];
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'contract-retirement-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const write=(p,s)=>{mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),s);};
 const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','-q');mkdirSync(join(dir,'empty-fixture-hooks'));git('config','core.hooksPath',join(dir,'empty-fixture-hooks'));git('config','user.name','CI fixture');git('config','user.email','fixture@example.invalid');
 for(const p of ['.github/workflows/scripts/lint-contract-test-immutability.sh','.github/workflows/scripts/validate-test-retirements.py'])write(p,readFileSync(new URL(p,root),'utf8'));
 write(path,"test('immutable',()=>expect(1+1).toBe(2));\n");write(replacement,"test('current',()=>expect(2+2).toBe(4));\n");write('sprints/old/tests/another.test.ts',"test('untouched',()=>expect(3).toBe(3));\n");
 git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');
 const record={path,source_commit:base,source_blob:git('rev-parse',base+':'+path),source_sha256:createHash('sha256').update(readFileSync(join(dir,path))).digest('hex'),reason:'Current implementation has a stronger equivalent test.',dimensions:Object.fromEntries(keys.map(k=>[k,'Concrete fixture review for '+k])),replacement_test_paths:[replacement],evidence_paths:[]};
 return {dir,base,write,git,record,remove:()=>rmSync(join(dir,path)),manifest:r=>write('docs/ci/test-retirements.json',JSON.stringify({schema_version:1,retirements:r})),commit:()=>{git('add','-A');git('commit','-qm','candidate');},run:(b=base)=>spawnSync('bash',['.github/workflows/scripts/lint-contract-test-immutability.sh',b],{cwd:dir,encoding:'utf8',timeout:10000})};
}
test('real lint permits only a documented deletion with matching source content',t=>{const f=fixture(t);f.remove();f.manifest([f.record]);f.commit();const r=f.run();assert.equal(r.status,0,r.stdout+r.stderr);assert.match(r.stdout,/RETIRED:/);});
for(const mode of ['missing-record','wrong-sha256','wrong-blob','wrong-source','missing-dimension','missing-replacement','resurrected','duplicate-record'])test('real lint rejects '+mode,t=>{
 const f=fixture(t);f.remove();const r=structuredClone(f.record);
 if(mode==='wrong-sha256')r.source_sha256='0'.repeat(64);
 if(mode==='wrong-blob')r.source_blob='0'.repeat(40);
 if(mode==='wrong-source')r.source_commit='f'.repeat(40);
 if(mode==='missing-dimension')delete r.dimensions.real_effect;
 if(mode==='missing-replacement')r.replacement_test_paths=['apps/api/tests/absent.test.ts'];
 if(mode==='resurrected')f.write(path,'// resurrected');
 f.manifest(mode==='missing-record'?[]:mode==='duplicate-record'?[r,r]:[r]);f.commit();const result=f.run();assert.notEqual(result.status,0,result.stdout+result.stderr);
});
test('retirement declaration never permits an existing contract modification',t=>{const f=fixture(t);f.write(path,"test('changed',()=>expect(1).toBe(1));\n");f.commit();assert.notEqual(f.run().status,0);});
test('base blob drift cannot reuse an older source approval',t=>{const f=fixture(t);f.write(path,"test('new-base',()=>expect(3).toBe(3));\n");f.commit();const newBase=f.git('rev-parse','HEAD');f.remove();f.manifest([f.record]);f.commit();const r=f.run(newBase);assert.notEqual(r.status,0,r.stdout+r.stderr);assert.match(r.stderr,/base content differs/);});
test('an evidenced historical-only retirement is allowed without inventing a test replacement',t=>{const f=fixture(t);f.remove();f.record.replacement_test_paths=[];f.record.historical_obligation_evidence='Historical fixed-version assertion has no unique present compatibility obligation; current tracked consumer is supplied.';f.record.evidence_paths=[replacement];f.manifest([f.record]);f.commit();assert.equal(f.run().status,0);});
test('absence of unique historical obligations needs current tracked evidence',t=>{const f=fixture(t);f.remove();f.record.replacement_test_paths=[];f.record.historical_obligation_evidence='No current obligation';f.manifest([f.record]);f.commit();assert.notEqual(f.run().status,0);});
test('invalid diff base fails closed',t=>{const f=fixture(t);assert.notEqual(f.run('missing-base').status,0);});
test('renaming an old contract cannot use the deletion channel',t=>{const f=fixture(t);f.git('mv',path,'sprints/old/tests/renamed.test.ts');f.manifest([f.record]);f.commit();assert.notEqual(f.run().status,0);});

test('a valid deletion record cannot waive a separate existing contract edit',t=>{const f=fixture(t);f.remove();f.manifest([f.record]);f.write('sprints/old/tests/another.test.ts',"test('changed',()=>expect(4).toBe(4));\n");f.commit();assert.notEqual(f.run().status,0);});
test('new contracts still cannot change after their introducing commit',t=>{const f=fixture(t);const p='sprints/new/tests/new.test.ts';f.write(p,"test('new',()=>expect(5).toBe(5));\n");f.commit();assert.equal(f.run().status,0);f.write(p,"test('changed',()=>expect(6).toBe(6));\n");f.commit();assert.notEqual(f.run().status,0);});
