import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {policy,video,comments} from './fixtures/leadgen-103-v14.mjs';

const root=resolve(fileURLToPath(new URL('.',import.meta.url)),'../../..');
const cli=join(root,'services/phone-adb-controller/leadgen-103-quality-probe.mjs');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'leadgen-probe-test-'));
 const cases=[...comments.map((c,i)=>({id:`negative-${i+1}`,comment_body:c.comment_body,source_video:video.title,source_video_url:video.video_url,expected:'不相关'})),
  {id:'positive',comment_body:'人工智能训练师证书怎么报名',source_video:video.title,source_video_url:video.video_url,expected:'A'},
  {id:'control',comment_body:'这是什么背景音乐',source_video:video.title,source_video_url:video.video_url,expected:'不相关'}]
  .map(c=>({...c,sha256:hash(c)}));
 const dataset=join(dir,'dataset.json');writeFileSync(dataset,JSON.stringify({snapshot:policy,cases}));
 return {dir,dataset};
}
test('未显式授权与错候选均 BLOCKED，回执可读且零请求',()=>{
 const {dir,dataset}=fixture();const output=join(dir,'blocked');
 const r=spawnSync(process.execPath,[cli,'--dataset',dataset,'--candidate',root,'--output',output],{encoding:'utf8'});
 assert.notEqual(r.status,0);const receipt=JSON.parse(readFileSync(join(output,'receipt.json')));
 assert.equal(receipt.status,'BLOCKED');assert.equal(receipt.requests.length,0);assert.ok(receipt.dataset_sha256);
 const other=join(dir,'mismatch');const m=spawnSync(process.execPath,[cli,'--dataset',dataset,'--candidate','b8cb50a2449799891629c4e6c4c002bf1e3d82ba','--output',other,'--real-provider'],{encoding:'utf8',env:{...process.env,OPENROUTER_API_KEY:'fixture-only'}});
 assert.notEqual(m.status,0);const mismatch=JSON.parse(readFileSync(join(other,'receipt.json')));
 assert.equal(mismatch.reason,'CANDIDATE_CODE_MISMATCH');assert.equal(mismatch.requests.length,0);
});
test('数据集 SHA 篡改先拒绝，现成空输出目录仍写 BLOCKED 回执',()=>{
 const {dir,dataset}=fixture(),data=JSON.parse(readFileSync(dataset,'utf8'));
 data.cases[0].comment_body='被篡改';writeFileSync(dataset,JSON.stringify(data));
 const output=join(dir,'invalid');mkdirSync(output);
 const r=spawnSync(process.execPath,[cli,'--dataset',dataset,'--candidate',root,'--output',output,'--real-provider'],
  {encoding:'utf8',env:{...process.env,OPENROUTER_API_KEY:'fixture-only'}});
 assert.notEqual(r.status,0);const receipt=JSON.parse(readFileSync(join(output,'receipt.json')));
 assert.equal(receipt.status,'BLOCKED');assert.equal(receipt.reason,'PROBE_DATASET_INVALID');assert.equal(receipt.requests.length,0);
});

test('固定替身四例逐请求留痕，错误 B 为 FAIL，正确四例仅本地通过',()=>{
 const {dir,dataset}=fixture();
 const responses=wrong=>[0,1,2,3].flatMap((i)=>{const negative=i<2,positive=i===2;
  const grade=negative?(wrong?'B':'不相关'):positive?'A':'不相关';
  return [{id:`jev-${i}`,model:'typesafe/jev-1.13',answers:{grade:{choice:grade,confidence:.99}}},
   {id:`response-${i}`,model:'google/gemini-2.5-flash',choices:[{message:{content:`\`\`\`json\n${JSON.stringify({grade,policy_evidence:{audience_id:'recvvcNzUv5rzl',matched_rule:negative?'怎么报':positive?'怎么报':'怎么考',exclusion_rule:negative&&!wrong?'泛失业或创业焦虑但未指向AI学习、考证或转行':null,reason:'按冻结画像及本人诉求判断'}})}\n\`\`\``}}]}];});
 const invoke=(output,wrong)=>{const file=join(dir,`responses-${wrong}.json`);writeFileSync(file,JSON.stringify(responses(wrong)));
  return spawnSync(process.execPath,[cli,'--dataset',dataset,'--candidate',root,'--output',output,'--fixture-responses',file],{encoding:'utf8',env:{...process.env,OPENROUTER_API_KEY:''}});};
  const bad=join(dir,'fail');assert.notEqual(invoke(bad,true).status,0);const failed=JSON.parse(readFileSync(join(bad,'receipt.json')));
  assert.equal(failed.status,'FAIL');assert.equal(failed.cases.length,4);assert.equal(failed.cases.filter(c=>c.passed).length,2);assert.ok(failed.requests.length>=8);
  const good=join(dir,'pass');assert.equal(invoke(good,false).status,0);const passed=JSON.parse(readFileSync(join(good,'receipt.json')));
  assert.equal(passed.status,'SIMULATED_PASS');assert.equal(passed.cases.length,4);assert.equal(passed.requests.length,8);
  assert.ok(!readFileSync(join(good,'receipt.json'),'utf8').includes('43岁'));
});

test('四例 provider 全部失败仍各留一次请求与失败，不冒质量 PASS',()=>{
 const {dir,dataset}=fixture(),responses=join(dir,'responses.json'),output=join(dir,'all-fail');
 writeFileSync(responses,JSON.stringify(Array.from({length:4},()=>({error:{code:429,message:'rate limited'}}))));
 const result=spawnSync(process.execPath,[cli,'--dataset',dataset,'--candidate',root,'--output',output,'--fixture-responses',responses],{encoding:'utf8'});
 assert.notEqual(result.status,0);const receipt=JSON.parse(readFileSync(join(output,'receipt.json')));
 assert.equal(receipt.status,'FAIL');assert.equal(receipt.cases.length,4);assert.equal(receipt.requests.length,4);
 assert.ok(receipt.requests.every(r=>r.response_sha256&&r.response_id===null));
});
