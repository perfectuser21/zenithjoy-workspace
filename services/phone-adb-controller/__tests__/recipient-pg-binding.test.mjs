import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const evidence=require('../queued-recipient-evidence.js');
const {queueRequest}=require('../leadgen-queue.js');
const pkg='com.ss.android.ugc.aweme',vid='7637880891511528896',run='source102',sourceRun='source101';
const prefix=`${run}-v${vid}-collection`;
const profileXml=`<hierarchy><node package="${pkg}" text="本人" content-desc="本人，复制名字和修改备注"/><node package="${pkg}" text="抖音号：person987"/><node package="${pkg}" text="企业负责人"/></hierarchy>`;
const returnedXml=`<hierarchy><node package="${pkg}" class="android.widget.TextView" resource-id="${pkg}:id/title" text="4条评论"/><node package="${pkg}" class="android.widget.EditText" resource-id="${pkg}:id/ety"/><node package="${pkg}" class="android.widget.FrameLayout" resource-id="${pkg}:id/fhn" text="" content-desc="本人,在哪里报名,09-27, · 山东,回复 按钮,"/></hierarchy>`;
function binding(){return {company_id:'11111111-1111-4111-8111-111111111111',tenant_id:'22222222-2222-4222-8222-222222222222',version:3,run_id:run,line_key:'yuesheng',source_run:sourceRun,profile:'cloud-phone-test',device_serial:'47.100.213.173:10001',douyin_id:'perfect21xx',verification_status:'verified',enabled:true};}
function native(b=binding()){
 const scope={comment_encoding:'canonical',line_key:b.line_key,run,source_run:sourceRun,video_id:vid,video_url:`https://www.douyin.com/video/${vid}`,profile:b.profile,douyin_id:'person987',nickname:'本人',comment_body_sha256:evidence.hash('在哪里报名'),profile_eid:prefix+'-person1-t1',video_identity_eid:prefix+'-after-card1'};
 return {version:1,receipt_id:'33333333-3333-4333-8333-333333333333',status:'verified',scope,company_binding:b,raw:{profile:profileXml,returned:returnedXml},sha256:{profile:evidence.hash(profileXml),returned:evidence.hash(returnedXml)},video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:scope.video_identity_eid}};
}
const scope=e=>({...e.scope,comment_body:'在哪里报名'});
function frozenRow(b=binding()){
 const snapshot={company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,config_status:'enabled',runtime_config:{routing:{line_key:b.line_key,profiles:[b.profile]},platform_accounts:[{profile:b.profile,device_serial:b.device_serial,douyin_id:b.douyin_id,verification_status:'verified',enabled:true}]}};
 return {company_id:b.company_id,tenant_id:b.tenant_id,version:b.version,run_id:b.run_id,source_run:b.source_run,task_inputs:{device_binding:{profile:b.profile,device_serial:b.device_serial}},snapshot};
}
test('已冻结PG云账号context允许真实native证据，caller自报绑定单独不能授权',()=>{
 const e=native();
 assert.equal(evidence.validateEvidence(e,scope(e),{companyBinding:binding()}).native_profile_verified,true);
 assert.throws(()=>evidence.validateEvidence(e,scope(e)),/RECIPIENT_/);
});
test('云capture读取本run私有绑定原件并保留严格XML/VID证明',()=>{
 const d=mkdtempSync(join(tmpdir(),'cloud-recipient-binding-')),runDir=join(d,'run'),phone=join(d,'phone'),root=join(phone,'evidence','cloud-phone-test');mkdirSync(runDir);mkdirSync(root,{recursive:true});
 const e=native(),profilePath=join(root,e.scope.profile_eid+'-profile.xml'),returnedPath=join(root,e.scope.profile_eid+'-returned.xml'),bindingFile=join(runDir,run+'-company-binding.json');
 writeFileSync(profilePath,profileXml);writeFileSync(returnedPath,returnedXml);writeFileSync(join(runDir,run+'-identity-'+vid+'.json'),JSON.stringify(e.video_identity));writeFileSync(bindingFile,JSON.stringify(binding()),{mode:0o600});
 const old=process.env.DOUYIN_PHONE_TMP_ROOT;process.env.DOUYIN_PHONE_TMP_ROOT=phone;
 try{const result=evidence.capture({runDir,line:'yuesheng',run,sourceRun,videoId:vid,videoUrl:e.scope.video_url,profile:'cloud-phone-test',douyinId:'person987',nickname:'本人',commentBody:'在哪里报名',started:Math.floor(Date.now()/1000)-1,profilePath,returnedPath,profileEid:e.scope.profile_eid,videoEid:e.scope.video_identity_eid,companyBindingFile:bindingFile,companyBindingSha:evidence.hash(readFileSync(bindingFile))});assert.deepEqual(JSON.parse(readFileSync(result.file)).company_binding,binding());}
 finally{if(old===undefined)delete process.env.DOUYIN_PHONE_TMP_ROOT;else process.env.DOUYIN_PHONE_TMP_ROOT=old;rmSync(d,{recursive:true,force:true});}
});
test('collect真实队列从原102 PG冻结选定设备派生授权，不接受仅声明profile',async()=>{
 const b=binding(),e=native(b),calls=[];
 const client={release(){},async query(sql,args){calls.push([sql,args]);if(sql.includes('company_config_runs'))return {rows:[frozenRow()]};if(sql.includes('FROM zenithjoy.leadgen_videos'))return {rows:[{video_id:vid,video_url:e.scope.video_url,judgment_status:'matched',url_bindings:1}]};if(sql.includes('INSERT INTO zenithjoy.leadgen_comments'))return {rows:[{id:'comment1'}]};return {rows:[]};}};
 const r=await queueRequest({connect:async()=>client},{op:'collect_partial',line:'yuesheng',run,source_run:sourceRun,video_id:vid,video_url:e.scope.video_url,comments:[{douyinId:'person987',nickname:'本人',commentBody:'在哪里报名',sourceVideoUrl:e.scope.video_url,recipientEvidence:e}]});
 assert.equal(r.inserted,1);assert.ok(calls.some(([sql])=>sql.includes('company_config_runs')));
});
test('MMV102预检把本run选定设备冻结进已有task_inputs，不能事后换同公司账号',async()=>{
 let options;
 const b=binding(),row=frozenRow();
 const r=await queueRequest({}, {op:'company_config',line:'yuesheng',run,source_run:sourceRun,step:'102',device_binding:{profile:b.profile,device_serial:b.device_serial}},{freezeCompanyConfig:async(_pool,o)=>{options=o;return row.snapshot;}});
 assert.deepEqual(options.taskInputs,{device_binding:{profile:b.profile,device_serial:b.device_serial}});
 assert.equal(r.device_binding.douyin_id,b.douyin_id);
});
