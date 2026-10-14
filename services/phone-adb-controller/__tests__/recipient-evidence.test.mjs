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
