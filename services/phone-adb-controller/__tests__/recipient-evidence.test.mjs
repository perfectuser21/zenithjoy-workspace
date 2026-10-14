import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {capture,validateEvidence,hash}=createRequire(import.meta.url)('../queued-recipient-evidence.js');
const pkg='com.ss.android.ugc.aweme',vid='7637880891511528896',prefix='source102-v'+vid+'-collection';
const profile=`<hierarchy><node package="${pkg}" text="本人" content-desc="本人，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person987"/><node package="${pkg}" text="在职学习"/></hierarchy>`;
const returned=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="4条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" text="本人"/><node package="${pkg}" text="在哪里报名"/></hierarchy>`;
function context(){const d=mkdtempSync(join(tmpdir(),'recipient-physical-')),phone=join(d,'phone'),p=join(phone,'evidence','legacy'),runDir=join(d,'run');mkdirSync(p,{recursive:true});mkdirSync(runDir);const profileEid=prefix+'-person1-t1',videoEid=prefix+'-after-card1';
 const profilePath=join(p,profileEid+'-profile.xml'),returnedPath=join(p,profileEid+'-returned.xml');writeFileSync(profilePath,profile);writeFileSync(returnedPath,returned);
 writeFileSync(join(runDir,'source102-identity-'+vid+'.json'),JSON.stringify({verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:videoEid,observed_at:new Date().toISOString()}));
 return {d,phone,args:{runDir,line:'jinuo',run:'source102',sourceRun:'source101',videoId:vid,videoUrl:'https://www.douyin.com/video/'+vid,profile:'legacy',douyinId:'person987',nickname:'本人',commentBody:'在哪里报名',started:Math.floor(Date.now()/1000)-1,profilePath,returnedPath,profileEid,videoEid}};}
function scoped(fn){const f=context(),old=process.env.DOUYIN_PHONE_TMP_ROOT;process.env.DOUYIN_PHONE_TMP_ROOT=f.phone;try{return fn(f);}finally{if(old===undefined)delete process.env.DOUYIN_PHONE_TMP_ROOT;else process.env.DOUYIN_PHONE_TMP_ROOT=old;rmSync(f.d,{recursive:true,force:true});}}
test('实际物理原件capture产生私有工件并可独立验同UID/返回全文/成对实际VID',()=>scoped(f=>{const result=capture(f.args);assert.equal(statSync(result.file).mode&0o777,0o600);const e=JSON.parse(readFileSync(result.file));assert.equal(e.sha256.profile,hash(profile));assert.equal(validateEvidence(e,{...e.scope,comment_body:'在哪里报名'}).native_profile_verified,true);}));
test('capture未知或非法started不能绕过新鲜mtime，真实未知VID bool不能冒verified',()=>scoped(f=>{
 assert.throws(()=>capture({...f.args,started:'unknown'}),/RECIPIENT_/);
}));
test('独立native验收拒绝非bool video证明和跨公司profile，即使UID/nickname正确',()=>scoped(f=>{const e=JSON.parse(readFileSync(capture(f.args).file)),scope={...e.scope,comment_body:'在哪里报名'};
 assert.throws(()=>validateEvidence({...e,video_identity:{...e.video_identity,verified:'false'}},scope),/RECIPIENT_/);
 assert.throws(()=>validateEvidence({...e,scope:{...e.scope,profile:'yueshengyun-work'}},scope),/RECIPIENT_/);
}));

test('原r7真实fhn回复元数据正文在content-desc：同一原生评论卡精准昵称+全文才通过',()=>{
 const a11y=returned.replace(`<node package="${pkg}" text="在哪里报名"/>`,`<node package="${pkg}" class="android.widget.FrameLayout" resource-id="${pkg}:id/fhn" text="" content-desc="本人,在哪里报名,09-27, · 山东,回复 按钮,"/>`);
 const {parseNative}=createRequire(import.meta.url)('../queued-recipient-evidence.js');
 assert.equal(parseNative(profile,a11y,{nickname:'本人',douyinId:'person987',commentBody:'在哪里报名'}).returned_comment_verified,true);
 for(const wrong of [a11y.replace('本人,在哪里报名,','邻居,在哪里报名,'),a11y.replace('本人,在哪里报名,','本人,在哪里报名呢,'),a11y.replace('id/fhn','id/video_desc')])assert.throws(()=>parseNative(profile,wrong,{nickname:'本人',douyinId:'person987',commentBody:'在哪里报名'}),/RECIPIENT_/);
});

import {companyFixture} from './company-config-fixture.mjs';
test('独立recipient模型读取完整native主页与原公司V3排除信号，网络请求有界且不改原A档',async()=>{
 await scoped(async f=>{const e=JSON.parse(readFileSync(capture(f.args).file)),comment={line_key:'jinuo',harvest_batch:'source102',douyin_id:'person987',nickname:'本人',comment_body:'在哪里报名',source_video_url:f.args.videoUrl,source_video:'AI考证',intent_grade:'A',recipient_evidence:e};
 const snapshot=companyFixture();snapshot.version=3;snapshot.runtime_config.comment_scoring.audiences=[{name:'原人群',exclusion_signals:['同行机构','已考仅分享无新需求']}];const old=globalThis.fetch;let called=0;
 globalThis.fetch=async(url,opts)=>{called++;assert.ok(opts.signal,'新独立资格模型不可无限等待');const body=JSON.parse(opts.body),state=JSON.parse(body.state);assert.ok(state.native_profile.includes('在职学习'));assert.ok(body.state.includes('同行机构'));assert.equal(state.original_grade,'A');return {ok:true,json:async()=>({answers:{recipient:{choice:'excluded',confidence:.9}}})};};
 try{const result=await createRequire(import.meta.url)('../judge-recipient.js').qualifyRecipient(comment,snapshot,{apiKey:'fixture-key'});assert.equal(result.status,'excluded');assert.equal(result.company_version,3);assert.equal(comment.intent_grade,'A');assert.equal(called,1);}finally{globalThis.fetch=old;}
 });
});

import {parseCollection} from '../leadgen-workflow.mjs';
test('102 actual native产物必须绑定本run上游scope，跨source proof不能消费到PG',()=>scoped(f=>{
 const r=capture(f.args),out=`RECIPIENT_PROOF\t${vid}\tperson987\t${r.body_sha256}\t${r.file}\t${r.sha256}\nLEAD\t本人\tperson987\tpersonal\t在哪里报名\t09-27\t山东\tAI考证\t关键词\t山东\thttps://www.douyin.com/user/person987\t${f.args.videoUrl}\nCOLLECTION\t${vid}\tcollected\t1`;
 const opts={recipientScope:{runDir:f.args.runDir,lineKey:'jinuo',run:'source102',sourceRun:'source101',profile:'legacy'}};
 assert.equal(parseCollection({code:0,stdout:out},vid,opts)[0].recipientEvidence.status,'verified');
 assert.throws(()=>parseCollection({code:0,stdout:out},vid,{recipientScope:{...opts.recipientScope,sourceRun:'other101'}}),/recipient/);
}));
