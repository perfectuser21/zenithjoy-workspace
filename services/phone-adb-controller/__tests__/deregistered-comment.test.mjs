import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const helper=createRequire(import.meta.url)('../queued-comment-history.js');
const pkg='com.ss.android.ugc.aweme', nick='已注销用户';
const node=(text,desc='')=>`<node package="${pkg}" text="${text}" content-desc="${desc}"/>`;
const xml=s=>'<hierarchy>'+s+'</hierarchy>';
const panel=xml(node('4条评论')+node('','放大评论区')+node('','关闭'));
// 真实 person6 的最小脱敏结构：注销文案/无OID/昵称节点/前后评论面板。
// 原证据 SHA 与路径保存在本 sprint PRD；ADB/PG 均不参与此测试。
function fixture(change={}){
 const d=mkdtempSync(path.join(tmpdir(),'deregistered-proof-')), root=path.join(d,'evidence','legacy'),eid='run-person6-t1';mkdirSync(root,{recursive:true});
 const files=['comments','profile','returned'].map(s=>path.join(root,eid+'-'+s+'.xml'));
 const content=[panel,xml(node(nick)+node('账号已经注销')+node('暂无作品')),panel].map((v,i)=>change[i]??v);
 files.forEach((f,i)=>writeFileSync(f,content[i]));
 if(change.stale)utimesSync(files[1],new Date(0),new Date(0));
 try{return helper.unavailable(root,eid,nick,...files,Math.floor(Date.now()/1000));}finally{rmSync(d,{recursive:true,force:true});}
}
test('真实注销结构可独立核验，明确缺OID不伪造身份',()=>{const r=fixture();assert.equal(r.verified,true);assert.equal(r.reason,'account_deregistered');assert.equal(r.identity_eid,'run-person6-t1');assert.match(r.profile_sha256,/^[a-f0-9]{64}$/);});
for(const [name,change] of Object.entries({wrongPackage:{1:xml(node(nick)+node('账号已经注销')).replaceAll(pkg,'bad.pkg')},partial:{1:'<hierarchy>'+node(nick)+node('账号已经注销')},wrongNick:{1:xml(node('别人')+node('账号已经注销'))},unknown:{1:xml(node(nick)+node('暂无作品'))},genericReturned:{2:xml(node('评论'))},wrongBefore:{0:xml(node('4条评论'))},stale:{stale:true},actualOID:{1:xml(node(nick)+node('账号已经注销')+node('抖音号：real123'))}}))test('拒绝不可信注销证明 '+name,()=>assert.throws(()=>fixture(change)));
