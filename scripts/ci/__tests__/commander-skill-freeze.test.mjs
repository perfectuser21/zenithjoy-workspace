import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const brainRoot=process.env.COMMANDER_BRAIN_ROOT;
assert.ok(brainRoot,'必须显式提供固定Brain checkout，不得跳过跨仓校验');
const brainRevision='f99f372689b895751bcb30a8e1bb429aaf8edfaa';
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
assert.equal(git(brainRoot,['rev-parse','HEAD']),brainRevision,'只使用已合并固定Brain校验器');
const {prepareDefinitionFreeze}=await import(pathToFileURL(resolve(brainRoot,'packages/brain/src/workflow-authoring/freeze.js')));
const {validateImplementationBindings}=await import(pathToFileURL(resolve(brainRoot,'packages/brain/src/lib/implementation-bindings.js')));
const revision=git(sourceRoot,['rev-parse','HEAD']);
const repo='perfectuser21/zenithjoy-workspace';
const prefix='services/phone-adb-controller/commander/';
// 业务实现读固定Git提交；技能正文按该提交的lock读取中心Git blob并校验摘要。
// 没有数据库、替身校验器或内存补元数据。
function readFile(source){
 assert.equal(source.repo,repo);assert.equal(source.revision,revision);
 if(source.path.startsWith(`${prefix}skills/`)){
  return execFileSync('python3',[resolve(sourceRoot,'scripts/skills-source.py'),'cat',
   '--workspace',sourceRoot,'--ref',revision,'--path',source.path],{encoding:'utf8'});
 }
 return execFileSync('git',['-C',sourceRoot,'show',`${revision}:${source.path}`],{encoding:'utf8'});
}
function definition(name){
 const ref=`${prefix}contracts/${name}.json`;
 return {...JSON.parse(readFile({repo,revision,path:ref})),source:{repo,ref,revision}};
}

test('真实Brain绑定校验器接受原Commander技能2.0.22与续版合同2.0.32',async()=>{
 const doc=definition('workflow-commander');assert.equal(doc.version,'2.0.32');
 const execution=doc.activities.find(a=>a.implementation_bindings?.some(b=>b.kind==='skill'));
 const rows=await validateImplementationBindings(execution,readFile,{repo,commit:revision});
 const skill=rows.find(b=>b.kind==='skill');
 assert.equal(skill.name,'workflow-commander');assert.equal(skill.version,'2.0.22');
 assert.equal(skill.status,'verified');assert.equal(skill.revision,revision);
});
test('真实prepareDefinitionFreeze读取Commander全部固定源码并产出绑定证明',async()=>{
 const doc=definition('workflow-commander'),proof=await prepareDefinitionFreeze(doc,{readFile});
 assert.equal(proof.source.commit,revision);assert.equal(proof.bindings.size,doc.activities.length);
 for(const rows of proof.bindings.values())assert.ok(rows.length&&rows.every(b=>b.status==='verified'));
});
test('已登记报告升至1.0.33后可按本次固定源码重新冻结',async()=>{
 const doc=definition('workflow-report');assert.equal(doc.version,'1.0.33');
 const proof=await prepareDefinitionFreeze(doc,{readFile});
 assert.equal(proof.source.commit,revision);assert.equal(proof.bindings.size,doc.activities.length);
});

test('注入reader按原始中央repo/commit/path读目录与Skill，拒绝伪造身份',()=>{
 const lock=JSON.parse(readFile({repo,revision,path:'.skills-source.json'}));
 const catalogSource={repo:lock.repository,revision:lock.revision,path:'distribution/catalog.json'};
 const catalog=JSON.parse(readFile(catalogSource));
 const entry=catalog.profiles[lock.profile].files.find(row=>row.path===`${prefix}skills/workflow-commander/SKILL.md`);
 assert.ok(entry,'固定profile必须分发Commander Skill');
 const location={repo:lock.repository,revision:lock.revision,path:entry.source};
 const bytes=readFile(location);
 assert.match(bytes,/name: workflow-commander/);
 assert.throws(()=>readFile({...location,repo:'other/repo'}));
 assert.throws(()=>readFile({...location,revision:'0'.repeat(40)}));
 assert.equal(readFile({repo,revision,path:'.absent-skill-source-lock.json'},{allowMissing:true}),null);
 assert.throws(()=>readFile({repo,revision,path:'.absent-skill-source-lock.json'}));
});
