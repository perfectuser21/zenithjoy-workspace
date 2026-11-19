import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';
import {generateAcceptance,verifyAcceptance} from '../leadgen-foundation/contract-acceptance.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const owners=['douyin_video_discovery','douyin_video_processing','douyin_comment_scoring','douyin_lead_outreach'];
const documents=()=>Object.fromEntries(owners.map(key=>[key,parse(fs.readFileSync(root+'product-map/contracts/'+key+'.yaml','utf8'))]));
const args=(docs=documents(),workflow=owners[1],activity='dedup')=>({documents:docs,workflow,activity});
test('acceptance preserves complete Activity and projects normative fields without promoting implementation steps',()=>{
 const docs=documents(),a=generateAcceptance(args(docs)),original=structuredClone(docs[owners[1]].activities.find(x=>x.key==='dedup'));delete original.implementation_bindings;
 assert.deepEqual(a.document,original);assert.equal(a.source.activity_ref,owners[1]+'.dedup');
 assert.deepEqual(a.criteria.filter(x=>x.source_pointer.startsWith('/preconditions/')).map(x=>x.requirement),original.preconditions);
 assert.deepEqual(a.criteria.filter(x=>x.source_pointer.startsWith('/postconditions/')).map(x=>x.requirement),original.postconditions);
 assert.equal(a.criteria.some(x=>x.source_pointer.startsWith('/steps')),false,'legacy implementation steps are not promoted to new business criteria');
 assert.equal(verifyAcceptance(a,args(docs)),true);
});
test('shared Activity references resolve the authoritative owner rather than cloning an alias description',()=>{
 const a=generateAcceptance(args(documents(),owners[0],'preflight'));
 assert.equal(a.source.activity_ref,owners[1]+'.preflight');assert.ok(a.document.inputs.length);assert.ok(a.document.outputs.length);
 assert.equal(a.source.path,'product-map/contracts/'+owners[1]+'.yaml');
});
test('actual published B semantic drift is rejected even if A document and its own digest agree',()=>{
 const docs=documents(),a=generateAcceptance(args(docs));docs[owners[1]].activities.find(x=>x.key==='dedup').postconditions[0].asserts+=' changed';
 assert.throws(()=>verifyAcceptance(a,args(docs)),/CONTRACT_AUTHORITY_DRIFT/);
});
test('binding-only A/B revisions do not cause circular semantic identity, altered criteria still fail',()=>{
 const docs=documents(),a=generateAcceptance(args(docs));docs[owners[1]].activities.find(x=>x.key==='dedup').implementation_bindings=[{revision:'b'.repeat(40)}];
 assert.equal(verifyAcceptance(a,args(docs)),true);
 const bad=structuredClone(a);bad.criteria[0].requirement='trust the previous verdict';assert.throws(()=>verifyAcceptance(bad,args(docs)),/CONTRACT_ACCEPTANCE_DRIFT/);
 const missing=structuredClone(a);missing.criteria.pop();assert.throws(()=>verifyAcceptance(missing,args(docs)),/CONTRACT_ACCEPTANCE_DRIFT/);
});
test('missing, duplicate or cyclic references and self-referential acceptance descriptions are rejected',()=>{
 for(const mutate of [d=>{d[owners[1]].activities=[];},d=>{d[owners[1]].activities.push(structuredClone(d[owners[1]].activities.find(x=>x.key==='dedup')));},d=>{d[owners[1]].activities=d[owners[1]].activities.map(x=>x.key==='dedup'?{ref:owners[1]+'.dedup'}:x);},d=>{d[owners[1]].activities=[{key:'dedup',acceptance:{description:'check frozen contract'}}];}]){
  const d=documents();mutate(d);assert.throws(()=>generateAcceptance(args(d)),/CONTRACT_/);
 }
});

test('an output or preserved side-effect obligation has its own result criterion',()=>{
 const a=generateAcceptance(args(documents(),owners[0],'collect_videos'));
 for(const field of ['inputs','outputs','side_effects'])for(const [i,value]of a.document[field].entries()){
  const c=a.criteria.find(x=>x.source_pointer===`/${field}/${i}`);assert.ok(c,`missing ${field} ${i}`);assert.deepEqual(c.requirement,value);assert.equal(c.phase,field==='inputs'?'start':'end');
 }
 assert.ok(a.criteria.some(x=>x.source_pointer==='/idempotency'));assert.ok(a.criteria.some(x=>x.source_pointer==='/failure'));
});
