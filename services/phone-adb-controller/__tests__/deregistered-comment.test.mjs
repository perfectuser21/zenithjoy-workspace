import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,utimesSync,readFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const helper=createRequire(import.meta.url)('../queued-comment-history.js');
const pkg='com.ss.android.ugc.aweme', nick='已注销用户';
const node=(text,desc='')=>`<node package="${pkg}" text="${text}" content-desc="${desc}"/>`;
const profileNick=name=>`<node package="${pkg}" text="${name}" resource-id="${pkg}:id/tj1" content-desc="${name}，复制名字和修改备注"/>`;
const xml=s=>'<hierarchy>'+s+'</hierarchy>';
const panel=xml(node('4条评论')+node('','放大评论区')+node('','关闭'));
// 真实 person6 的最小脱敏结构：注销文案/无OID/昵称节点/前后评论面板。
// 原证据 SHA 与路径保存在本 sprint PRD；ADB/PG 均不参与此测试。
function fixture(change={}){
 const d=mkdtempSync(path.join(tmpdir(),'deregistered-proof-')), root=path.join(d,'evidence','legacy'),eid='run-person6-t1';mkdirSync(root,{recursive:true});
 const files=['comments','profile','returned'].map(s=>path.join(root,eid+'-'+s+'.xml'));
 const content=[panel,xml(profileNick(nick)+node('账号已经注销')+node('暂无作品')),panel].map((v,i)=>change[i]??v);
 files.forEach((f,i)=>writeFileSync(f,content[i]));
 if(change.stale)utimesSync(files[1],new Date(0),new Date(0));
 try{return helper.unavailable(root,eid,nick,...files,Math.floor(Date.now()/1000));}finally{rmSync(d,{recursive:true,force:true});}
}
test('真实注销结构可独立核验，明确缺OID不伪造身份',()=>{const r=fixture();assert.equal(r.verified,true);assert.equal(r.reason,'account_deregistered');assert.equal(r.identity_eid,'run-person6-t1');assert.match(r.profile_sha256,/^[a-f0-9]{64}$/);});
for(const [name,change] of Object.entries({commentImpersonatesProfile:{1:xml(node(nick)+node('账号已经注销')+node('暂无作品'))},missingWorks:{1:xml(profileNick(nick)+node('账号已经注销'))},wrongPackage:{1:xml(node(nick)+node('账号已经注销')).replaceAll(pkg,'bad.pkg')},partial:{1:'<hierarchy>'+node(nick)+node('账号已经注销')},wrongNick:{1:xml(node('别人')+node('账号已经注销'))},unknown:{1:xml(node(nick)+node('暂无作品'))},genericReturned:{2:xml(node('评论'))},wrongBefore:{0:xml(node('4条评论'))},stale:{stale:true},actualOID:{1:xml(node(nick)+node('账号已经注销')+node('抖音号：real123'))}}))test('拒绝不可信注销证明 '+name,()=>assert.throws(()=>fixture(change)));

function controllerIdentity({profile=xml(profileNick(nick)+node('账号已经注销')+node('暂无作品')),returned=panel,stale=false,base64Bin='/usr/bin/base64'}={}){
 const d=mkdtempSync(path.join(tmpdir(),'deregistered-controller-'));
 try{
 const ctl=new URL('../douyin-phone-adb',import.meta.url).pathname;
 const source=readFileSync(ctl,'utf8'),originalEntry=source.match(/^read_commenter_identity\(\) \{[\s\S]*?^\}/m)[0];
 const decoder='/usr/bin/base64 -D',adaptedDecoder=`'${base64Bin}' -D`;
 assert.equal(originalEntry.split(decoder).length,2);
 const entry=originalEntry.replace(decoder,adaptedDecoder);assert.equal(entry.replace(adaptedDecoder,decoder),originalEntry);
 symlinkSync(new URL('../queued-comment-history.js',import.meta.url).pathname,path.join(d,'queued-comment-history.js'));
 writeFileSync(path.join(d,'before'),panel);writeFileSync(path.join(d,'profile'),profile);writeFileSync(path.join(d,'returned'),returned);
 const runner=path.join(d,'runner');
 writeFileSync(runner,`#!/bin/zsh
set -euo pipefail
setopt EXTENDED_GLOB
COMMENT_EVIDENCE_HELPER="${new URL('../queued-comment-history.js',import.meta.url).pathname}"
EVIDENCE_ROOT="$1"; MAX_X=1200; MAX_Y=2600; ADB=/usr/bin/true; SERIAL=stub; DOUYIN_PACKAGE=${pkg}
require_uint(){ [[ "$1" == <-> ]]; }
require_evidence_id(){ [[ "$1" == [a-zA-Z0-9_-]## ]]; }
foreground_package(){ print ${pkg}; }
wait_ms(){ :; }
die(){ print -u2 -- "$1"; exit 2; }
normalize_nickname(){ print -r -- "$1"; }
extract_account_identity(){ :; }
ui_evidence(){
 local suffix=before
 [[ "$1" != *-profile ]] || suffix=profile
 [[ "$1" != *-returned ]] || suffix=returned
 ${stale?'if [[ "$suffix" == profile ]]; then return 0; fi':''}
 cp "$EVIDENCE_ROOT/$suffix" "$EVIDENCE_ROOT/$1.xml"
}
${entry}
read_commenter_identity 100 200 '${Buffer.from(nick).toString('base64')}' run-person6-t1
`);
 if(stale){writeFileSync(path.join(d,'run-person6-t1-profile.xml'),profile);utimesSync(path.join(d,'run-person6-t1-profile.xml'),new Date(0),new Date(0));}
 const r=spawnSync('zsh',[runner,d],{encoding:'utf8',timeout:7000});
 return {...r,profileCaptured:existsSync(path.join(d,'run-person6-t1-profile.xml')),returnedCaptured:existsSync(path.join(d,'run-person6-t1-returned.xml'))};
 }finally{rmSync(d,{recursive:true,force:true});}
}
test('真实controller入口返回显式注销证明，仍无OID且真实返回评论页',()=>{const r=controllerIdentity();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/profile_status=unavailable/);assert.match(r.stdout,/unavailable_reason=account_deregistered/);assert.match(r.stdout,/douyin_id=\n/);assert.match(r.stdout,/return_evidence=.*run-person6-t1-returned.xml/);});
for(const [name,opts] of Object.entries({wrongPackage:{profile:xml(node(nick)+node('账号已经注销')).replaceAll(pkg,'bad.pkg')},partial:{profile:'<hierarchy>'+node(nick)+node('账号已经注销')},unknown:{profile:xml(node(nick)+node('暂无作品'))},wrongPanel:{returned:xml(node('评论'))},stale:{stale:true}}))test('真实controller入口不把未知/失效证据当注销 '+name,()=>{const r=controllerIdentity(opts);assert.doesNotMatch(r.stdout,/profile_status=unavailable/);assert.doesNotMatch(r.stderr,/base64 could not be decoded/);assert.equal(r.profileCaptured,true);assert.equal(r.returnedCaptured,true);});

test('GNU式真实decoder拒绝Mac-D时正反例仍进入注销守卫',()=>{
 const d=mkdtempSync(path.join(tmpdir(),'deregistered-gnu-base64-'));
 try {
  const input=Buffer.from(nick).toString('base64');
  const flag=['-D','--decode'].find(f=>{const r=spawnSync('/usr/bin/base64',[f],{input,encoding:'utf8'});return r.status===0&&r.stdout===nick;});assert.ok(flag);
  const wrapper=path.join(d,'base64');writeFileSync(wrapper,`#!/usr/bin/env node
const {spawnSync}=require('node:child_process'),fs=require('node:fs');
if(process.argv[2]!=='--decode'){console.error('GNU decoder rejects Mac -D');process.exit(64);}
const r=spawnSync('/usr/bin/base64',[${JSON.stringify(flag)}],{input:fs.readFileSync(0)});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status===null?1:r.status);
`,{mode:0o755});
  const good=controllerIdentity({base64Bin:wrapper});assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/profile_status=unavailable/);assert.equal(good.profileCaptured,true);assert.equal(good.returnedCaptured,true);
  const bad=controllerIdentity({base64Bin:wrapper,profile:xml(profileNick(nick)+node('暂无作品'))});assert.doesNotMatch(bad.stdout,/profile_status=unavailable/);assert.doesNotMatch(bad.stderr,/base64 could not be decoded/);assert.equal(bad.profileCaptured,true);assert.equal(bad.returnedCaptured,true);
 } finally {rmSync(d,{recursive:true,force:true});}
});
