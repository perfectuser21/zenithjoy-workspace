import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
