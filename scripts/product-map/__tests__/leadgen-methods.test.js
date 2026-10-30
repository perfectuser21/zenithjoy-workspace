import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';
import {createHash} from 'node:crypto';
import {checkMethods,collectMethods} from '../leadgen-methods.mjs';

const source=fileURLToPath(new URL('../../../',import.meta.url));
const cli=join(source,'scripts/product-map/leadgen-methods.mjs');
const flows=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const skillRoot='services/phone-adb-controller/skills/';
const lockPath='product-map/contracts/leadgen-activity-methods.lock.json';
const policy=skillRoot+'leadgen-activity-execution.md';
const call=(root,...args)=>spawnSync(process.execPath,[cli,'--root',root,...args],{encoding:'utf8'});
function put(root,path,value){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');}
function json(root,path){return JSON.parse(readFileSync(join(root,path),'utf8'));}
// A disposable fixture repository must not inherit workstation production hooks.
function git(root,...args){return execFileSync('git',['-c','core.hooksPath=.git/fixture-hooks',...args],{cwd:root,encoding:'utf8'}).trim();}
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'leadgen-method-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const docs={};put(root,policy,'# Fixture shared execution policy\nNo runtime takeover is implemented.\n');
  // Reuse the real contracts' business shape (unchanged from base5235) and all
  // current implementation files; no historical Git checkout/network is needed.
  // only method documentation/bindings below are isolated test fixtures.
  for(let i=0;i<flows.length;i++){
    const flow=flows[i],p='product-map/contracts/'+flow+'.yaml';
    docs[flow]=parse(readFileSync(join(source,p),'utf8'));
    for(const a of docs[flow].activities.filter(a=>!a.ref)){
      for(const b of a.implementation_bindings.filter(b=>b.kind==='code'))put(root,b.path,readFileSync(join(source,b.path)));
      const name='douyin-leadgen-activity-'+(101+i)+'-'+a.key.replaceAll('_','-'),path=skillRoot+name+'/SKILL.md';
      const b=a.implementation_bindings.find(b=>b.kind==='skill');Object.assign(b,{name,path,version:'0.1.0'});
      put(root,path,'---\n'+stringify({name,metadata:{version:'0.1.0',activity_ref:flow+'.'+a.key,activity_version:a.version,support_files:[policy]}})+'---\n\nFixture activity method; no execution.\n\n[Workflow](../douyin-leadgen-'+(101+i)+'/SKILL.md)\n[Contract](../../../../product-map/contracts/'+flow+'.yaml)\n');
    }
  }
  for(let i=0;i<flows.length;i++){
    const flow=flows[i],d=docs[flow],business=skillRoot+'douyin-leadgen-'+(101+i)+'/SKILL.md';
    d.commander_skill.version='0.2.0';put(root,'product-map/contracts/'+flow+'.yaml',stringify(d));
    put(root,business,'---\n'+stringify({name:'douyin-leadgen-'+(101+i),metadata:{version:'0.2.0'}})+'---\n\nFixture workflow reads references/activity-methods.json.\n');
    put(root,'services/phone-adb-controller/commander/skills/wf-'+flow+'/SKILL.md','---\n'+stringify({name:'wf-'+flow,version:'0.2.0'})+'---\n\nFixture commander reads references/activity-methods.json.\n');
    put(root,skillRoot+'douyin-leadgen-'+(101+i)+'/references/activity-methods.json',{workflow_key:flow,activities:d.activities.map(a=>{
      const ref=a.ref||flow+'.'+a.key;const [owner,key]=ref.split('.');const b=docs[owner].activities.find(x=>x.key===key).implementation_bindings.find(x=>x.kind==='skill');
      return {activity_ref:ref,skill_name:b.name,skill_version:b.version,skill_path:b.path};
    })});
  }
  const generated=call(root,'--write');assert.equal(generated.status,0,generated.stderr);
  git(root,'init','-q');git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture baseline');
  return {root,base:git(root,'rev-parse','HEAD')};
}
function check(root,base){return call(root,'--base',base);}
function refresh(root){const r=call(root,'--write');assert.equal(r.status,0,r.stderr);}
function editFront(root,path,edit){const text=readFileSync(join(root,path),'utf8');const match=text.match(/^---\n([\s\S]*?)\n---/);const f=parse(match[1]);edit(f);put(root,path,text.replace(match[0],'---\n'+stringify(f)+'---'));}

test('fixed real-contract fixture has 12 methods and 14 exact ordered consumers',t=>{const {root,base}=fixture(t);const r=check(root,base);assert.equal(r.status,0,r.stderr);const m=json(root,lockPath);assert.equal(Object.keys(m.activities).length,12);assert.equal(Object.values(m.workflows).reduce((n,w)=>n+w.activities.length,0),14);});
test('refreshing hashes cannot bless same-version Activity Skill text drift',t=>{const {root,base}=fixture(t);const p=skillRoot+'douyin-leadgen-activity-101-collect-videos/SKILL.md';put(root,p,readFileSync(join(root,p),'utf8')+'\nChanged method.\n');refresh(root);const r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/SKILL_VERSION_NOT_ADVANCED/);});
test('shared support policy changes require every affected method version to advance',t=>{const {root,base}=fixture(t);put(root,policy,'Changed shared safety method.\n');refresh(root);const r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/SKILL_VERSION_NOT_ADVANCED/);});
test('code-only hash refresh needs explicit exact prior/current compatibility assessment',t=>{const {root,base}=fixture(t);const m=json(root,lockPath),p='services/phone-adb-controller/leadgen-workflow.mjs';put(root,p,readFileSync(join(root,p),'utf8')+'\n// fixture internal optimization\n');refresh(root);let r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/CODE_COMPATIBILITY_REQUIRED/);
  const n=json(root,lockPath);const assessments={};for(const [ref,a] of Object.entries(n.activities))if(a.code_digest!==m.activities[ref].code_digest)assessments[ref]={kind:'internal_compatible',reason:'Fixture review: internal implementation only, same business and method contract.',reviewed_by:'fixture-reviewer',previous_code_digest:m.activities[ref].code_digest,current_code_digest:a.code_digest};
  put(root,'compatibility-fixture.json',assessments);r=call(root,'--write','--compatibility','compatibility-fixture.json');assert.equal(r.status,0,r.stderr);r=check(root,base);assert.equal(r.status,0,r.stderr);
  const l=json(root,lockPath),ref=Object.keys(assessments)[0];l.activities[ref].code_compatibility.previous_code_digest='*';put(root,lockPath,l);r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/CODE_COMPATIBILITY/);
});
test('wrong Activity owner, I/O version, or missing code binding digest is rejected',t=>{const {root,base}=fixture(t);const p=skillRoot+'douyin-leadgen-activity-104-preflight/SKILL.md',originalVersion=parse(readFileSync(join(root,'product-map/contracts/douyin_lead_outreach.yaml'),'utf8')).activities.find(a=>a.key==='preflight').version;editFront(root,p,f=>f.metadata.activity_ref='douyin_video_processing.preflight');assert.notEqual(call(root,'--write').status,0);editFront(root,p,f=>{f.metadata.activity_ref='douyin_lead_outreach.preflight';f.metadata.activity_version='0.1.0';});assert.notEqual(call(root,'--write').status,0);editFront(root,p,f=>f.metadata.activity_version=originalVersion);refresh(root);const l=json(root,lockPath);l.activities['douyin_lead_outreach.preflight'].code_bindings.pop();put(root,lockPath,l);assert.notEqual(check(root,base).status,0);});
test('method upgrade rejects stale consumer then requires both Workflow and Commander version bumps',t=>{const {root,base}=fixture(t);const owner='douyin_video_processing',ref=owner+'.preflight',p=skillRoot+'douyin-leadgen-activity-102-preflight/SKILL.md';editFront(root,p,f=>f.metadata.version='0.2.0');const cp='product-map/contracts/'+owner+'.yaml';const c=parse(readFileSync(join(root,cp),'utf8'));c.activities.find(a=>a.key==='preflight').implementation_bindings.find(b=>b.kind==='skill').version='0.2.0';put(root,cp,stringify(c));assert.notEqual(call(root,'--write').status,0,'both shared consumers remain stale');
  for(const number of [101,102]){const rp=skillRoot+'douyin-leadgen-'+number+'/references/activity-methods.json',d=json(root,rp);d.activities.find(a=>a.activity_ref===ref).skill_version='0.2.0';put(root,rp,d);}refresh(root);let r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/WORKFLOW_SKILL_VERSION_NOT_ADVANCED/);
  for(const number of [101,102])editFront(root,skillRoot+'douyin-leadgen-'+number+'/SKILL.md',f=>f.metadata.version='0.3.0');refresh(root);r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/COMMANDER_SKILL_VERSION_NOT_ADVANCED/);
  for(const flow of flows.slice(0,2)){editFront(root,'services/phone-adb-controller/commander/skills/wf-'+flow+'/SKILL.md',f=>f.version='0.3.0');const cp='product-map/contracts/'+flow+'.yaml',c=parse(readFileSync(join(root,cp),'utf8'));c.commander_skill.version='0.3.0';put(root,cp,stringify(c));}refresh(root);r=check(root,base);assert.equal(r.status,0,r.stderr);
});
test('consumer omissions, reordered slots and 104 references to 102 cannot be generated',t=>{const {root}=fixture(t);const p=skillRoot+'douyin-leadgen-101/references/activity-methods.json',d=json(root,p);d.activities.reverse();put(root,p,d);assert.notEqual(call(root,'--write').status,0);d.activities.reverse();put(root,p,d);const cp='product-map/contracts/douyin_lead_outreach.yaml',c=parse(readFileSync(join(root,cp),'utf8'));c.activities[0]={ref:'douyin_video_processing.preflight'};put(root,cp,stringify(c));assert.notEqual(call(root,'--write').status,0);});
test('an unavailable Git baseline is rejected rather than treated as first adoption',t=>{const {root}=fixture(t);const r=check(root,'f'.repeat(40));assert.notEqual(r.status,0);assert.match(r.stderr,/BASE_COMMIT_UNAVAILABLE/);});
test('compatibility declarations cannot bless method text changes or malformed approvals',t=>{const {root,base}=fixture(t);const l=json(root,lockPath),ref='douyin_video_discovery.collect_videos';l.activities[ref].code_compatibility={kind:'internal_compatible',reason:'Unbound fixture claim',reviewed_by:'fixture',previous_code_digest:'*',current_code_digest:l.activities[ref].code_digest};put(root,lockPath,l);let r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/CODE_COMPATIBILITY/);});
test('one ordinary method upgrade affects only its method and actual Workflow consumers',t=>{const {root,base}=fixture(t);const before=json(root,lockPath),owner='douyin_video_processing',ref=owner+'.dedup',a=before.activities[ref];editFront(root,a.skill.path,f=>f.metadata.version='0.2.0');const cp='product-map/contracts/'+owner+'.yaml',c=parse(readFileSync(join(root,cp),'utf8'));c.activities.find(x=>x.key==='dedup').implementation_bindings.find(b=>b.kind==='skill').version='0.2.0';c.commander_skill.version='0.3.0';put(root,cp,stringify(c));const rp=skillRoot+'douyin-leadgen-102/references/activity-methods.json',deps=json(root,rp);deps.activities.find(x=>x.activity_ref===ref).skill_version='0.2.0';put(root,rp,deps);editFront(root,skillRoot+'douyin-leadgen-102/SKILL.md',f=>f.metadata.version='0.3.0');editFront(root,'services/phone-adb-controller/commander/skills/wf-'+owner+'/SKILL.md',f=>f.version='0.3.0');refresh(root);const r=check(root,base);assert.equal(r.status,0,r.stderr);const after=json(root,lockPath);for(const [key,m] of Object.entries(before.activities))if(key!==ref)assert.equal(after.activities[key].method_version,m.method_version);});
test('support declarations reject duplicate, traversal, removal and symlink escape',t=>{const {root}=fixture(t);const p=skillRoot+'douyin-leadgen-activity-101-collect-videos/SKILL.md';for(const paths of [[policy,policy],['../outside.md'],[]]){editFront(root,p,f=>f.metadata.support_files=paths);assert.notEqual(call(root,'--write').status,0);}editFront(root,p,f=>f.metadata.support_files=[policy]);const external=mkdtempSync(join(tmpdir(),'method-outside-fixture-'));t.after(()=>rmSync(external,{recursive:true,force:true}));put(external,'outside.md','Fixture external file.');rmSync(join(root,policy));symlinkSync(join(external,'outside.md'),join(root,policy));const r=call(root,'--write');assert.notEqual(r.status,0);assert.match(r.stderr,/METHOD_SYMLINK_REJECTED/);});
test('business Activity contract drift cannot be passed by merely refreshing lock hashes',t=>{const {root,base}=fixture(t);const p='product-map/contracts/douyin_video_processing.yaml',c=parse(readFileSync(join(root,p),'utf8'));c.activities.find(a=>a.key==='dedup').postconditions.push({probe:'fixture_new_contract',asserts:'A changed business promise'});put(root,p,stringify(c));refresh(root);const r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/ACTIVITY_CONTRACT_VERSION_NOT_ADVANCED/);});
test('explicit but missing or empty --base cannot silently disable history checks',t=>{const {root}=fixture(t);for(const args of [['--base'],['--base','']]){const r=call(root,...args);assert.notEqual(r.status,0);assert.match(r.stderr,/BASE_SHA_INVALID/);}});

// Historical migrated source is read from its pinned Git objects, never the hydrated checkout.
test('migrated baseline still validates every method against pinned central Skill bytes',t=>{
  const {root}=fixture(t),central=mkdtempSync(join(tmpdir(),'method-central-fixture-'));
  t.after(()=>rmSync(central,{recursive:true,force:true}));git(central,'init','-q');
  git(root,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
  const paths=git(root,'ls-files').split('\n').filter(p=>p.endsWith('/SKILL.md'));
  const saved=new Map(),files=[],loader='fixture loader; never executed\n';put(central,'distribution/catalog.json',{});
  put(central,'distribution/skills_source.py',loader);
  for(const [i,path] of paths.entries()){const body=readFileSync(join(root,path)),source='bodies/'+i+'.md';saved.set(path,body);put(central,source,body);files.push({path,source,sha256:createHash('sha256').update(body).digest('hex')});rmSync(join(root,path));}
  put(central,'distribution/catalog.json',{profiles:{zenithjoy:{files}}});git(central,'add','.');git(central,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','central pinned methods');
  put(root,'.skills-source.json',{version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision:git(central,'rev-parse','HEAD'),loader_sha256:createHash('sha256').update(loader).digest('hex')});
  git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','migrated baseline');const base=git(root,'rev-parse','HEAD');
  for(const [path,body] of saved)put(root,path,body);
  assert.equal(checkMethods(root,{base,skillSource:central}).status,'PASS');
  const poisoned=structuredClone(json(root,lockPath));poisoned.activities[Object.keys(poisoned.activities)[0]].skill.sha256='0'.repeat(64);put(root,lockPath,poisoned);git(root,'add',lockPath);git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','corrupt historical lock');const corrupt=git(root,'rev-parse','HEAD');refresh(root);
  assert.throws(()=>checkMethods(root,{base:corrupt,skillSource:central}),/BASE_METHOD_LOCK_DRIFT/);
});
test('first method-lock adoption still checks tracked historical Skills without requiring a source lock',t=>{
  const {root}=fixture(t);rmSync(join(root,lockPath));git(root,'add',lockPath);git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','pre-method-lock baseline');const base=git(root,'rev-parse','HEAD');refresh(root);assert.equal(checkMethods(root,{base}).status,'PASS');
});
test('a Workflow Skill absent before first adoption is allowed only when no historical central lock exists',t=>{
  const {root}=fixture(t),path=skillRoot+'douyin-leadgen-101/SKILL.md',body=readFileSync(join(root,path));rmSync(join(root,lockPath));rmSync(join(root,path));git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','before first workflow skill');const base=git(root,'rev-parse','HEAD');put(root,path,body);refresh(root);assert.equal(checkMethods(root,{base}).status,'PASS');
});

// The extracted implementation is business code, so every frozen method must
// change its code identity when those exact handler bytes change.
test('real extracted handlers belong to every consumer method source closure',t=>{
 for(const name of ['leadgen-handlers.mjs','leadgen-scoring-handler.mjs','leadgen-policy-review.js']){
 const {root}=fixture(t),path='services/phone-adb-controller/'+name;
 put(root,path,readFileSync(join(source,path)));
 const before=collectMethods(root);
 put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated handler-byte mutation\n');
 const after=collectMethods(root);
 for(const [ref,method] of Object.entries(before.activities)){
  assert.notEqual(after.activities[ref].code_digest,method.code_digest,ref+' omitted actual '+name+' bytes');
  assert.equal(after.activities[ref].contract_digest,method.contract_digest);
  assert.equal(after.activities[ref].skill.content_digest,method.skill.content_digest);
 }
 }
});

test('103 scoring method lock changes when its real judge-comment scorer changes',t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/judge-comment.js';
 put(root,path,readFileSync(join(source,path)));
 const before=collectMethods(root);
 put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated scorer-byte mutation\n');
 const after=collectMethods(root);
 const ref='douyin_comment_scoring.scoring';
 assert.notEqual(after.activities[ref].code_digest,before.activities[ref].code_digest,
   'scoring method omitted its real judge-comment.js bytes');
 for(const other of Object.keys(before.activities).filter(key=>key!==ref))
   assert.equal(after.activities[other].code_digest,before.activities[other].code_digest,
     other+' should not own 103 scorer bytes');
});

test('101l 原生观测校验真身只绑定视频发现及103两项消费者',t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/discovery-metrics.js';
 const before=collectMethods(root);
 put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated observation-byte mutation\n');
 const after=collectMethods(root);
 const changed=Object.keys(before.activities).filter(ref=>after.activities[ref].code_digest!==before.activities[ref].code_digest);
 assert.deepEqual(changed,['douyin_video_discovery.collect_videos','douyin_comment_scoring.scoring','douyin_comment_scoring.mark_leads']);
});

test('ADB route verifier bytes belong to every phone-touching leadgen Activity only',t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/adb-existing-route.py';
 const expected=['douyin_video_discovery.collect_videos','douyin_video_processing.preflight',
  'douyin_video_processing.qualification','douyin_video_processing.collection','douyin_video_processing.cleanup',
  'douyin_lead_outreach.preflight','douyin_lead_outreach.send_dm','douyin_lead_outreach.cleanup'];
 const before=collectMethods(root);
 put(root,path,readFileSync(join(source,path),'utf8')+'\n# isolated route-verifier byte mutation\n');
 const after=collectMethods(root);
 const changed=Object.keys(before.activities).filter(ref=>after.activities[ref].code_digest!==before.activities[ref].code_digest);
 assert.deepEqual(changed,expected);
});

test('native operation receipt bytes belong to every consumer method source closure',t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/native-operation-receipt.mjs';
 put(root,path,readFileSync(join(source,path)));
 const before=collectMethods(root);
 put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated native receipt byte mutation\n');
 const after=collectMethods(root);
 for(const [ref,method] of Object.entries(before.activities)){
  assert.notEqual(after.activities[ref].code_digest,method.code_digest,ref+' omitted native stop receipt bytes');
  assert.equal(after.activities[ref].contract_digest,method.contract_digest);
  assert.equal(after.activities[ref].skill.content_digest,method.skill.content_digest);
 }
});

test('verified runtime binding bytes belong to every consumer method source closure',t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/runtime-binding.mjs';
 put(root,path,readFileSync(join(source,path)));
 const before=collectMethods(root);
 put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated verified binding byte mutation\n');
 const after=collectMethods(root);
 assert.equal(Object.keys(before.activities).length,12);
 for(const [ref,method] of Object.entries(before.activities)){
  assert.notEqual(after.activities[ref].code_digest,method.code_digest,ref+' omitted verified runtime binding bytes');
  assert.equal(after.activities[ref].contract_digest,method.contract_digest);
  assert.equal(after.activities[ref].skill.content_digest,method.skill.content_digest);
 }
});

for(const name of ['build-scrcpy-runtime.py','scrcpy-v3.3.4-log-flush.patch'])test('SDK33 qualification tracks actual build source '+name,t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/runtime/'+name;
 put(root,path,readFileSync(join(source,path)));
 const before=collectMethods(root);
 put(root,path,Buffer.concat([readFileSync(join(root,path)),Buffer.from('\n# isolated build-source mutation\n')]));
 const after=collectMethods(root);
 const changed=Object.keys(before.activities).filter(ref=>after.activities[ref].code_digest!==before.activities[ref].code_digest);
 assert.deepEqual(changed,['douyin_video_processing.qualification']);
 for(const ref of Object.keys(before.activities)){
  assert.equal(after.activities[ref].contract_digest,before.activities[ref].contract_digest);
  assert.equal(after.activities[ref].skill.content_digest,before.activities[ref].skill.content_digest);
 }
});

test('collection phone issuer and real leaf producer belong to every consumer source closure',t=>{
 for(const name of ['collection-phone-scope.mjs','collection-leaf-producer.mjs']){
  const {root}=fixture(t),path='services/phone-adb-controller/'+name;put(root,path,readFileSync(join(source,path)));
  const before=collectMethods(root);put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated phone-authority byte mutation\n');const after=collectMethods(root);
  for(const [ref,method] of Object.entries(before.activities))assert.notEqual(after.activities[ref].code_digest,method.code_digest,ref+' omitted '+name);
 }
});

for(const name of ['commander-owner-state.mjs','commander-owner-lock.mjs','commander-owner-reconcile.mjs'])test('owner reservation and maintenance bytes belong to every real Commander consumer '+name,t=>{
 const {root}=fixture(t),path='services/phone-adb-controller/'+name;
 put(root,path,'// isolated owner safety module bytes\n');const before=collectMethods(root);
 put(root,path,readFileSync(join(root,path),'utf8')+'\n// isolated owner safety byte mutation\n');const after=collectMethods(root);
 assert.equal(Object.keys(before.activities).length,12);
 for(const [ref,method] of Object.entries(before.activities)){
  assert.notEqual(after.activities[ref].code_digest,method.code_digest,ref+' omitted owner safety module '+name);
  assert.equal(after.activities[ref].contract_digest,method.contract_digest);assert.equal(after.activities[ref].skill.content_digest,method.skill.content_digest);
 }
});
