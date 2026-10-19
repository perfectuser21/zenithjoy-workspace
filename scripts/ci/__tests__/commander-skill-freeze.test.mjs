import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const brainRoot=process.env.COMMANDER_BRAIN_ROOT;
assert.ok(brainRoot,'必须显式提供固定Brain checkout，不得跳过跨仓校验');
const brainRevision='095d81687079f975c65f14babc27364b4da3e374';
const git=(root,args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
assert.equal(git(brainRoot,['rev-parse','HEAD']),brainRevision,'只使用已合并固定Brain校验器');
const {prepareDefinitionFreeze}=await import(pathToFileURL(resolve(brainRoot,'packages/brain/src/workflow-authoring/freeze.js')));
const {validateFixedImplementationBindings}=await import(pathToFileURL(resolve(brainRoot,'packages/brain/src/workflow-authoring/fixed-git-source.js')));
const {readFixedLocalGitBlob}=await import(pathToFileURL(resolve(brainRoot,'scripts/ci/fixed-local-git.mjs')));
const revision=git(sourceRoot,['rev-parse','HEAD']);
const repo='perfectuser21/zenithjoy-workspace';
const prefix='services/phone-adb-controller/commander/';
// reader只交出请求身份对应的原始Git字节；锁、profile、白名单及摘要由真实Brain统一核验。
const skillsLock=JSON.parse(readFixedLocalGitBlob(sourceRoot,{revision,path:'.skills-source.json'}));
const reads=[];
function readFile(source,options){
 let root;
 if(source.repo===repo){
  assert.equal(source.revision,revision);root=sourceRoot;
 }else{
  assert.equal(source.repo,skillsLock.repository);assert.equal(source.revision,skillsLock.revision);
  root=resolve(sourceRoot,'.skills-source');
 }
 const bytes=readFixedLocalGitBlob(root,source,options);
 reads.push({...source});
 return bytes===null?null:bytes.toString('utf8');
}
function definition(name){
 const ref=`${prefix}contracts/${name}.json`;
 return {...JSON.parse(readFile({repo,revision,path:ref})),source:{repo,ref,revision}};
}

test('真实Brain绑定校验器接受原Commander技能2.0.22与固定main续版合同',async()=>{
 const doc=definition('workflow-commander');assert.match(doc.version,/^2\.0\.[0-9]+$/);
 const execution=doc.activities.find(a=>a.implementation_bindings?.some(b=>b.kind==='skill'));
 const rows=await validateFixedImplementationBindings(execution,{repo,commit:revision},{readFile});
 const skill=rows.find(b=>b.kind==='skill');
 assert.equal(skill.name,'workflow-commander');assert.equal(skill.version,'2.0.22');
 assert.equal(skill.status,'verified');assert.equal(skill.revision,revision);
 assert.equal(skill.repo,repo);
 assert.equal(skill.resolved_source.repo,skillsLock.repository);
 assert.equal(skill.resolved_source.revision,skillsLock.revision);
 const central=readFile(skill.resolved_source);
 assert.equal(skill.digest,'sha256:'+createHash('sha256').update(central).digest('hex'));
});
test('真实prepareDefinitionFreeze读取Commander全部固定源码并产出绑定证明',async()=>{
 const doc=definition('workflow-commander');reads.length=0;
 const proof=await prepareDefinitionFreeze(doc,{readFile});
 assert.equal(proof.source.commit,revision);assert.equal(proof.bindings.size,doc.activities.length);
 for(const rows of proof.bindings.values())assert.ok(rows.length&&rows.every(b=>b.status==='verified'));
 const skill=[...proof.bindings.values()].flat().find(b=>b.kind==='skill');
 assert.ok(skill.resolved_source,'冻结证明必须保留实际中央来源');
 assert.ok(reads.some(s=>s.repo===repo&&s.path==='.skills-source.json'));
 assert.ok(reads.some(s=>s.repo===skillsLock.repository&&s.path==='distribution/catalog.json'));
 assert.ok(reads.some(s=>s.repo===skill.resolved_source.repo&&s.path===skill.resolved_source.path&&s.revision===skill.resolved_source.revision));
 assert.ok(!reads.some(s=>s.repo===repo&&s.path===skill.path),'迁出Skill不能再交由业务bootstrap重定向');
});
test('已登记报告续版后可按本次固定源码重新冻结',async()=>{
 const doc=definition('workflow-report');assert.match(doc.version,/^1\.0\.[0-9]+$/);
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
