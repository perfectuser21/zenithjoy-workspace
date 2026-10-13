import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function invoke({provenance=true,mismatch=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'fake-pg-order-bridge-'));try{
 const input=join(dir,'input.tsv'),proof=join(dir,'provenance.json'),out=join(dir,'writes.json');
 writeFileSync(input,'LEAD\tfake昵称\tFAKE1873867\tpersonal\t想报名\t原时间\t陕西\t原视频\tAI\t原IP\thttps://v.douyin.com/FAKEPROFILE/\thttps://www.douyin.com/video/7597758667794878534\n');
 writeFileSync(proof,JSON.stringify({line_key:'jinuo',source_run:'fake102',lead_id:'e92b90f1-19d1-4121-a434-96e0ee46a493',comment_id:'6db999d1-384c-437b-a86d-6573a27ef9ee',douyin_id:mismatch?'EVIL999':'FAKE1873867',profile_url:'https://v.douyin.com/FAKEPROFILE/',nickname:'fake昵称',comment_body:'想报名',ai_judgment_reason:'[A] 原评分理由',intent_grade:'A',source_account:'jinoshengyuan-work'}));
 const preload=join(dir,'preload.cjs');writeFileSync(preload,`const fs=require('fs'),read=fs.readFileSync;fs.readFileSync=function(p,...a){if(String(p)==='/Users/administrator/.openclaw/clawdbot.json')return JSON.stringify({channels:{feishu:{accounts:{jinoshengyuan:{appId:'explicit-fake-app',appSecret:'explicit-fake-secret'}}}}});return read.call(this,p,...a);};let writes=[];global.fetch=async(url,o={})=>{let b;if(String(url).includes('/auth/'))b={code:0,tenant_access_token:'explicit-fake-token'};else if(o.method==='POST'){writes.push(JSON.parse(o.body).fields);fs.writeFileSync(${JSON.stringify(out)},JSON.stringify(writes));b={code:0,data:{record:{record_id:'recFAKEONLY123'}}};}else b={code:0,data:{items:[],total:writes.length,has_more:false}};return {ok:true,json:async()=>b};};`);
 const args=['--require',preload,new URL('../push-leads.js',import.meta.url).pathname,input,'jinoshengyuan-work',...(provenance?['--provenance',proof]:[])];
 const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});let rows=[];try{rows=JSON.parse(readFileSync(out,'utf8'));}catch{}
 return {r,rows};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('已有官方writer显式PG来源保持真实理由/等级/批次/原采集事实，不套KPI夜默认',()=>{
 const {r,rows}=invoke();assert.equal(r.status,0,r.stderr);assert.equal(rows.length,1);
 assert.equal(rows[0]['AI判断理由'],'[A] 原评分理由');assert.match(rows[0]['合规核验状态'],/fake102/);assert.match(rows[0]['合规核验状态'],/e92b90f1/);assert.ok(!rows[0]['合规核验状态'].includes('KPI夜'));
});
test('显式PG来源身份与TSV不符时官方writer必须零写入',()=>{
 const {r,rows}=invoke({mismatch:true});assert.notEqual(r.status,0);assert.equal(rows.length,0);
});
test('旧writer无来源选项保持原有默认兼容',()=>{
 const {r,rows}=invoke({provenance:false});assert.equal(r.status,0,r.stderr);assert.match(rows[0]['合规核验状态'],/KPI夜直采/);
});
