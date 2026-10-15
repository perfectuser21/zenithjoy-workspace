import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parse,stringify} from 'yaml';

const source=fileURLToPath(new URL('../../../',import.meta.url));
const cli=join(source,'scripts/product-map/leadgen-methods.mjs');
const baseline='5235d8f797ec294f947d4b86e6c782c7755af582';
const flows=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const skillRoot='services/phone-adb-controller/skills/';
const lockPath='product-map/contracts/leadgen-activity-methods.lock.json';
const policy=skillRoot+'leadgen-activity-execution.md';
const call=(root,...args)=>spawnSync(process.execPath,[cli,'--root',root,...args],{encoding:'utf8'});
function put(root,path,value){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
function json(root,path){return JSON.parse(readFileSync(join(root,path),'utf8'));}
function git(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();}
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'leadgen-method-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const docs={};put(root,policy,'# Fixture shared execution policy\nNo runtime takeover is implemented.\n');
  // Copy real fixed-base contracts and all their original implementation files;
  // only method documentation/bindings below are isolated test fixtures.
  for(let i=0;i<flows.length;i++){
    const flow=flows[i],p='product-map/contracts/'+flow+'.yaml';
    docs[flow]=parse(git(source,'show',baseline+':'+p));
    for(const a of docs[flow].activities.filter(a=>!a.ref)){
      for(const b of a.implementation_bindings.filter(b=>b.kind==='code'))put(root,b.path,git(source,'show',baseline+':'+b.path)+'\n');
      const name='douyin-leadgen-activity-'+(101+i)+'-'+a.key.replaceAll('_','-'),path=skillRoot+name+'/SKILL.md';
      const b=a.implementation_bindings.find(b=>b.kind==='skill');Object.assign(b,{name,path,version:'0.1.0'});
      put(root,path,'---\n'+stringify({name,metadata:{version:'0.1.0',activity_ref:flow+'.'+a.key,activity_version:a.version,support_files:[policy]}})+'---\n\nFixture activity method; no execution.\n');
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
test('wrong Activity owner, I/O version, or missing code binding digest is rejected',t=>{const {root,base}=fixture(t);const p=skillRoot+'douyin-leadgen-activity-104-preflight/SKILL.md';editFront(root,p,f=>f.metadata.activity_ref='douyin_video_processing.preflight');assert.notEqual(call(root,'--write').status,0);editFront(root,p,f=>{f.metadata.activity_ref='douyin_lead_outreach.preflight';f.metadata.activity_version='0.1.0';});assert.notEqual(call(root,'--write').status,0);editFront(root,p,f=>f.metadata.activity_version='4.0.0');refresh(root);const l=json(root,lockPath);l.activities['douyin_lead_outreach.preflight'].code_bindings.pop();put(root,lockPath,l);assert.notEqual(check(root,base).status,0);});
test('method upgrade rejects stale consumer then requires both Workflow and Commander version bumps',t=>{const {root,base}=fixture(t);const owner='douyin_video_processing',ref=owner+'.preflight',p=skillRoot+'douyin-leadgen-activity-102-preflight/SKILL.md';editFront(root,p,f=>f.metadata.version='0.2.0');const cp='product-map/contracts/'+owner+'.yaml';const c=parse(readFileSync(join(root,cp),'utf8'));c.activities.find(a=>a.key==='preflight').implementation_bindings.find(b=>b.kind==='skill').version='0.2.0';put(root,cp,stringify(c));assert.notEqual(call(root,'--write').status,0,'both shared consumers remain stale');
  for(const number of [101,102]){const rp=skillRoot+'douyin-leadgen-'+number+'/references/activity-methods.json',d=json(root,rp);d.activities.find(a=>a.activity_ref===ref).skill_version='0.2.0';put(root,rp,d);}refresh(root);let r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/WORKFLOW_SKILL_VERSION_NOT_ADVANCED/);
  for(const number of [101,102])editFront(root,skillRoot+'douyin-leadgen-'+number+'/SKILL.md',f=>f.metadata.version='0.3.0');refresh(root);r=check(root,base);assert.notEqual(r.status,0);assert.match(r.stderr,/COMMANDER_SKILL_VERSION_NOT_ADVANCED/);
  for(const flow of flows.slice(0,2)){editFront(root,'services/phone-adb-controller/commander/skills/wf-'+flow+'/SKILL.md',f=>f.version='0.3.0');const cp='product-map/contracts/'+flow+'.yaml',c=parse(readFileSync(join(root,cp),'utf8'));c.commander_skill.version='0.3.0';put(root,cp,stringify(c));}refresh(root);r=check(root,base);assert.equal(r.status,0,r.stderr);
});
test('consumer omissions, reordered slots and 104 references to 102 cannot be generated',t=>{const {root}=fixture(t);const p=skillRoot+'douyin-leadgen-101/references/activity-methods.json',d=json(root,p);d.activities.reverse();put(root,p,d);assert.notEqual(call(root,'--write').status,0);d.activities.reverse();put(root,p,d);const cp='product-map/contracts/douyin_lead_outreach.yaml',c=parse(readFileSync(join(root,cp),'utf8'));c.activities[0]={ref:'douyin_video_processing.preflight'};put(root,cp,stringify(c));assert.notEqual(call(root,'--write').status,0);});
