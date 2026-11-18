import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{parseNativeCommentXml,parseNative}=require('../queued-recipient-evidence.js');
const raw=readFileSync(new URL('./fixtures/compose-comments/cloud-v34-raw.xml',import.meta.url),'utf8');
const provenance=JSON.parse(readFileSync(new URL('./fixtures/compose-comments/cloud-v34-raw.provenance.json',import.meta.url)));
const nickname='土豆丝',body='想问下本地部署隐私会不会好很多';
const profile='<hierarchy><node package="com.ss.android.ugc.aweme" text="抖音号：person123"/><node package="com.ss.android.ugc.aweme" text="土豆丝" content-desc="土豆丝，复制名字和修改备注"/></hierarchy>';
test('real Compose panel has four complete top-level rows and no clipped or expand-reply pseudo-row',()=>{
 assert.equal(createHash('sha256').update(raw).digest('hex'),provenance.sha256);assert.equal(Buffer.byteLength(raw),provenance.bytes);
 const r=parseNativeCommentXml(raw);assert.equal(r.rows.length,4);assert.deepEqual(r.rows[0],{nickname,author:false,body,time:'1天前',region:'内蒙古',x:'51',y:'539',nickname_b64:Buffer.from(nickname).toString('base64')});
 assert.ok(!r.rows.some(x=>x.nickname==='飞*'||x.nickname.includes('展开')));
});
test('returned Compose original verifies the same exact nickname/body while keeping profile UID proof',()=>{
 const r=parseNative(profile,raw,{nickname,douyinId:'person123',commentBody:body});assert.equal(r.native_profile_verified,true);assert.equal(r.returned_comment_verified,true);
 assert.throws(()=>parseNative(profile,raw,{nickname,douyinId:'foreign',commentBody:body}),/RECIPIENT_NATIVE/);
 assert.throws(()=>parseNative(profile,raw,{nickname,douyinId:'person123',commentBody:body+'?'}),/RECIPIENT_NATIVE/);
});
function transformed(code){const r=spawnSync('python3',['-c',`import sys,copy,xml.etree.ElementTree as E\nr=E.fromstring(sys.stdin.read());cv=next(n for n in r.iter('node') if n.get('class')=='androidx.compose.ui.platform.ComposeView');lst=next(n for n in cv.iter('node') if n.get('scrollable')=='true');row=lst[0][0]\n${code}\nprint(E.tostring(r,encoding='unicode'))`],{input:raw,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout;}
const withoutFirst={
 'missing same-row avatar':"row.remove(row[0])",
 'ambiguous blank avatar':"row.append(copy.deepcopy(row[0]))",
 'cropped avatar':"row[0].set('bounds','[24,512][78,540]')",
 'control avatar cannot replace leaf':"row.remove(row[0]);row[-1].set('bounds','[24,512][78,566]')",
 'incomplete metadata':"row.remove(row[5])",
 'control characters cannot break seven columns':"row[2][0].set('text','body\\tother')",
};
for(const[name,code]of Object.entries(withoutFirst))test(name,()=>{const xml=transformed(code),r=parseNativeCommentXml(xml);assert.ok(!r.rows.some(x=>x.nickname===nickname));assert.throws(()=>parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);});
test('nested reply and marketing slots never become extra top-level clients',()=>{const xml=transformed("slot=E.SubElement(lst,'node',{'package':'com.ss.android.ugc.aweme','class':'android.view.View'});a=E.SubElement(slot,'node',{'package':'com.ss.android.ugc.aweme','class':'android.view.View'});a.append(copy.deepcopy(row));row2=copy.deepcopy(row);row2.set('text','查看团购');lst.append(row2)");assert.equal(parseNativeCommentXml(xml).rows.length,4);});
test('author marker is preserved and cannot pass as a client returned original',()=>{const xml=transformed("badge=E.SubElement(row,'node',{'package':'com.ss.android.ugc.aweme','class':'android.widget.TextView','text':'作者','clickable':'false','bounds':'[150,512][190,541]'})");assert.equal(parseNativeCommentXml(xml).rows[0].author,true);assert.throws(()=>parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);});
test('duplicate exact nickname/body originals are ambiguous; mismatched nickname/body/profile order reject',()=>{const xml=transformed("other=lst[2][0];other[1].set('text',row[1].get('text'));other[2][0].set('text',row[2][0].get('text'))");assert.throws(()=>parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);assert.throws(()=>parseNative(raw,profile,{nickname,douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);assert.throws(()=>parseNative(profile,raw,{nickname:'someone',douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);});
test('foreign package and multiple Compose panels are not inferred from convenient text',()=>{for(const xml of [raw.replace('com.ss.android.ugc.aweme','foreign.package'),transformed('r.append(copy.deepcopy(cv))')])assert.throws(()=>parseNativeCommentXml(xml),/RECIPIENT_COMMENT_PANEL/);});
const hash=b=>createHash('sha256').update(b).digest('hex');
function recipient(){const vid='7707600173446204723',run='compose-run';const scope={line_key:'fixture',run,source_run:null,profile:'cloud',douyin_id:'person123',nickname,comment_body_sha256:hash(body),video_id:vid,video_url:'https://www.douyin.com/video/'+vid,profile_eid:run+'-v'+vid+'-collection-person1-t1',video_identity_eid:run+'-v'+vid+'-collection-after-card1',comment_encoding:'canonical'};const company={company_id:'company',tenant_id:'tenant',profile:'cloud',device_serial:'physical',douyin_id:'sender',enabled:true,line_key:'fixture',run_id:run,source_run:null,verification_status:'verified',version:34};return {scope,company,e:{version:1,status:'verified',scope:{...scope},company_binding:company,raw:{profile,returned:raw},sha256:{profile:hash(profile),returned:hash(raw)},video_identity:{verified:true,content_type:'video',expected_video_id:vid,observed_video_id:vid,evidence_id:scope.video_identity_eid}}};}
test('full recipient validateEvidence replays Compose originals and preserves UID/VID/SHA/source batch',()=>{const {validateEvidence}=require('../queued-recipient-evidence.js');const f=recipient();assert.equal(validateEvidence(f.e,{...f.scope,comment_body:body},{companyBinding:f.company}).returned_comment_verified,true);for(const change of [x=>x.scope.nickname='foreign',x=>x.scope.comment_body_sha256='a'.repeat(64),x=>x.scope.video_id='7707600173446204000',x=>x.sha256.returned='f'.repeat(64),x=>x.scope.source_run='foreign',x=>{x.raw.profile=profile.replace('person123','foreign');x.sha256.profile=hash(x.raw.profile);}]){const g=recipient();change(g.e);assert.throws(()=>validateEvidence(g.e,{...g.scope,comment_body:body},{companyBinding:g.company}),/RECIPIENT_/);}});

test('extracted CLI parser preserves grep I/O failure without entering fallback',()=>{const dir=mkdtempSync(join(tmpdir(),'compose-read-error-'));try{const marker=join(dir,'called'),stub=join(dir,'python');writeFileSync(stub,'#!/bin/sh\ntouch "'+marker+'"\n',{mode:0o755});const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8'),fn=source.match(/^comments_from_xml\(\) \{[\s\S]*?^\}/m)[0];const r=spawnSync('zsh',['-c',fn+'; comments_from_xml "$1" 720','zsh',dir],{env:{...process.env,PYTHON_BIN:stub,PHONE_CONTROLLER_DIR:new URL('../',import.meta.url).pathname},encoding:'utf8'});assert.equal(r.status,2,r.stderr);assert.equal(existsSync(marker),false);}finally{rmSync(dir,{recursive:true,force:true});}});
test('native XML entities decode exactly once with UTF8 nickname base64 and returned identity',()=>{const nick='小&<"🌟',comment='实体 & < > " &amp;';const xml=transformed(`row[1].set('text',${JSON.stringify(nick)});row[2][0].set('text',${JSON.stringify(comment)})`),row=parseNativeCommentXml(xml).rows[0];assert.equal(row.nickname,nick);assert.equal(row.body,comment);assert.equal(row.nickname_b64,Buffer.from(nick).toString('base64'));const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');const p='<hierarchy><node package="com.ss.android.ugc.aweme" text="抖音号：person123"/><node package="com.ss.android.ugc.aweme" text="'+esc(nick)+'" content-desc="'+esc(nick)+'，复制名字和修改备注"/></hierarchy>';assert.equal(parseNative(p,xml,{nickname:nick,douyinId:'person123',commentBody:comment}).returned_comment_verified,true);});
test('DOCTYPE and entity declarations never become native panel evidence',()=>{const xml=raw.replace('<hierarchy','<!DOCTYPE hierarchy [<!ENTITY injected "body">]><hierarchy');assert.throws(()=>parseNativeCommentXml(xml),/RECIPIENT_COMMENT_PANEL/);assert.throws(()=>parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);});

test('real dynamic input placeholder uses owned toolbar structure for enumeration and complete identity replay',()=>{const xml=readFileSync(new URL('./fixtures/compose-comments/cloud-v34-dynamic-input.xml',import.meta.url),'utf8'),p=JSON.parse(readFileSync(new URL('./fixtures/compose-comments/cloud-v34-dynamic-input.provenance.json',import.meta.url)));assert.equal(hash(xml),p.sha256);assert.equal(Buffer.byteLength(xml),p.bytes);assert.equal(parseNativeCommentXml(xml).rows.length,4);const f=recipient();f.e.raw.returned=xml;f.e.sha256.returned=hash(xml);const {validateEvidence}=require('../queued-recipient-evidence.js');assert.equal(validateEvidence(f.e,{...f.scope,comment_body:body},{companyBinding:f.company}).returned_comment_verified,true);});
function toolbarChanged(code){return transformed("parents={n:p for p in r.iter() for n in p};icon=next(n for n in cv.iter('node') if n.get('content-desc')=='image');group=parents[parents[icon]];field=group[0];label=field[0]\n"+code);}
const invalidToolbars={
 'missing icon':"group.remove(group[2])",
 'duplicate icon':"group[2][0].set('content-desc','image')",
 'foreign icon parent':"group.remove(group[2]);cv.append(icon)",
 'nonclickable input':"field.set('clickable','false')",
 'multiple inputs':"group.append(copy.deepcopy(field))",
 'cropped input':"field.set('bounds','[12,1135][510,1300]')",
 'disabled group':"group.set('enabled','false')",
 'ambiguous label':"field.append(copy.deepcopy(label))",
 'label outside input':"label.set('bounds','[0,0][100,100]')",
 'interactive input descendant':"label.set('clickable','true')",
 'unexpected field description':"field.set('content-desc','unrelated action')",
 'forged toolbar inside list':"parents[group].remove(group);lst.append(group)",
 'body text cannot be input capability':"group.remove(field);row[2][0].set('text','期待你的评论')",
 'actual editing state':"E.SubElement(cv,'node',{'package':'com.ss.android.ugc.aweme','class':'android.widget.EditText','text':'typing','bounds':'[12,1135][510,1202]'})",
};
for(const[name,code]of Object.entries(invalidToolbars))test('input region rejects '+name,()=>{const xml=toolbarChanged(code);assert.throws(()=>parseNativeCommentXml(xml),/RECIPIENT_COMMENT_PANEL/);assert.throws(()=>parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}),/RECIPIENT_NATIVE/);});
test('arbitrary placeholder text is not used as an identity anchor',()=>{const xml=toolbarChanged("label.set('text','动态文本随时改变')");assert.equal(parseNativeCommentXml(xml).rows.length,4);assert.equal(parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}).returned_comment_verified,true);});

test('noninteractive input wrappers preserve the unique visible label',()=>{const xml=toolbarChanged("field.remove(label);wrapper=E.SubElement(field,'node',{'package':'com.ss.android.ugc.aweme','class':'android.view.View','enabled':'true','clickable':'false','bounds':field.get('bounds')});wrapper.append(label)");assert.equal(parseNativeCommentXml(xml).rows.length,4);assert.equal(parseNative(profile,xml,{nickname,douyinId:'person123',commentBody:body}).returned_comment_verified,true);});
