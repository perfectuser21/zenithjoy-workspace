import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../prepare-openclaw-os-packages.sh',import.meta.url));
test('既有OS步骤仅用一个300秒边界调用真实隔离脚本',()=>{const text=readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8');assert.match(text,/timeout 300s bash \.github\/workflows\/scripts\/prepare-openclaw-os-packages\.sh/);});
const source='Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n';
function invoke(t,{fail='',drift=false,untrusted=false,badPlan=false,badKey=false,actualSource=false,sourceText,mesaSuffix,staleCache=false,runnerSources=false}={}){
 const top=mkdtempSync(join(tmpdir(),'official-apt-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const bin=join(top,'bin'),tmp=join(top,'tmp'),src=join(top,'ubuntu.sources'),mirrors=join(top,'apt-mirrors.txt'),trace=join(top,'trace');mkdirSync(bin);mkdirSync(tmp);
 writeFileSync(src,sourceText??(actualSource?readFileSync(new URL('./fixtures/ubuntu24-20261012.334.sources',import.meta.url),'utf8'):badKey?source.replaceAll('/usr/share/keyrings/ubuntu-archive-keyring.gpg','/tmp/unknown.gpg'):untrusted?source.replace('mirror+file:/etc/apt/apt-mirrors.txt','https://evil.example/ubuntu/'):source));writeFileSync(mirrors,'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n');
 const before=readFileSync(src,'utf8');
 writeFileSync(join(bin,'sudo'),'#!/bin/sh\nexec "$@"\n',{mode:0o755});
 writeFileSync(join(bin,'apt-get'),`#!/bin/sh
printf 'apt %s\\n' "$*" >> "$APT_TEST_TRACE"
isolated=cached; sources=''
for arg in "$@"; do case "$arg" in Dir::Etc::sourcelist=*) sources="\${arg#*=}"; case "$sources" in */original.sources) isolated=original;; *) isolated=official;; esac;; esac; done
if [ "$isolated" != cached ]; then /bin/cat "$sources" >> "$APT_TEST_TRACE"; fi
case " $* " in
 *' --simulate '*)
  [ "$APT_TEST_FAIL" != simulate ] || exit 41
  if [ "$APT_TEST_BAD_PLAN" = 1 ]; then printf 'Inst unexpected-format\\n'; exit 0; fi
  if [ "$APT_TEST_MESA" = 1 ]; then printf '%s%s\\n' 'Inst libgl1-mesa-dri [25.2.8-0ubuntu0.24.04.4] (25.2.8-0ubuntu0.24.04.5 Ubuntu:24.04/noble-updates [amd64])' "$APT_TEST_MESA_SUFFIX"; fi
  version=1.0; if [ "$APT_TEST_STALE_CACHE" = 1 ] && [ "$isolated" != cached ]; then version=1.1; fi; [ "$isolated:$APT_TEST_DRIFT" != official:1 ] || version=2.0
  printf 'Inst zsh (%s Ubuntu:24.04/noble [amd64])\\nInst libxml2-utils (2.0 Ubuntu:24.04/noble [amd64])\\nInst ffmpeg (6.1 Ubuntu:24.04/noble [amd64])\\n' "$version";;
 *' update '*) [ "$APT_TEST_FAIL" != update ] || exit 42; [ "$APT_TEST_FAIL" != "$isolated-update" ] || exit 42;;
 *' install '*) [ "$APT_TEST_FAIL" != install ] || exit 43; printf 'INSTALLED\\n' >> "$APT_TEST_TRACE";;
 *) exit 99;;
esac
`,{mode:0o755});
 const r=spawnSync('/bin/bash',[script,...(runnerSources?['--runner-sources']:[]),tmp,src,mirrors,'zsh','libxml2-utils','ffmpeg'],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:bin+':'+process.env.PATH,APT_TEST_TRACE:trace,APT_TEST_FAIL:fail,APT_TEST_DRIFT:drift?'1':'0',APT_TEST_BAD_PLAN:badPlan?'1':'0',APT_TEST_MESA:mesaSuffix===undefined?'0':'1',APT_TEST_MESA_SUFFIX:mesaSuffix||'',APT_TEST_STALE_CACHE:staleCache?'1':'0'}});
 let log='';try{log=readFileSync(trace,'utf8');}catch{}
 return {...r,log,sourceUnchanged:readFileSync(src,'utf8')===before};
}
test('实际bash仅进程隔离官方Ubuntu源，计划相同才安装，原source不改',t=>{const r=invoke(t);assert.equal(r.status,0,r.stderr);assert.equal(r.sourceUnchanged,true);assert.match(r.log,/URIs: https:\/\/archive\.ubuntu\.com\/ubuntu\//);assert.match(r.log,/URIs: https:\/\/security\.ubuntu\.com\/ubuntu\//);assert.match(r.log,/Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/);assert.match(r.log,/Dir::Etc::sourceparts=-/);assert.match(r.log,/Dir::State::lists=/);assert.match(r.log,/APT::Update::Error-Mode=any/);assert.doesNotMatch(r.log,/Dir::Cache::archives=|allow-unauthenticated|AllowInsecure|Trusted: yes/);assert.match(r.log,/INSTALLED/);assert.match(r.stderr,/PREFLIGHT_APT_STAGE .*elapsed_s=/);});
test('签名索引选择的pkg/version计划漂移即拒绝，不安装',t=>{const r=invoke(t,{drift:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_CHANGED/);assert.doesNotMatch(r.log,/INSTALLED/);assert.equal(r.sourceUnchanged,true);});
test('未知源拒绝而不是授予Ubuntu签名信任',t=>{const r=invoke(t,{untrusted:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_SOURCE_UNTRUSTED/);assert.doesNotMatch(r.log,/INSTALLED/);assert.equal(r.sourceUnchanged,true);});
test('未知签名key拒绝且不安装',t=>{const r=invoke(t,{badKey:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_SOURCE_SIGNATURE_REQUIRED/);assert.doesNotMatch(r.log,/INSTALLED/);});
test('两边都有无法解析的Inst也不能被过滤成相同空计划',t=>{const r=invoke(t,{badPlan:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_UNRECOGNIZED/);assert.match(r.stderr,/APT_PLAN_REJECTED.*"plan": "original.plan".*"line": "Inst unexpected-format"/);assert.doesNotMatch(r.log,/INSTALLED/);});
for(const [phase,code] of [['simulate',41],['update',42],['install',43]])test('真实bash失败保留'+phase+'阶段且不报告完成',t=>{const r=invoke(t,{fail:phase});assert.equal(r.status,code,r.stderr);assert.doesNotMatch(r.stdout,/PREFLIGHT_APT_DONE/);assert.equal(r.sourceUnchanged,true);});

test('真实runner完整source含纯注释分段，仍逐段验证真实源后安装',t=>{const r=invoke(t,{actualSource:true});assert.equal(r.status,0,r.stderr);assert.equal(r.sourceUnchanged,true);assert.match(r.log,/INSTALLED/);});

test('Shard 0真实runner无尾斜线官方security源仍验证签名与计划后安装',t=>{
 const sourceText=readFileSync(new URL('./fixtures/ubuntu24-20261018.96.sources',import.meta.url),'utf8');
 const r=invoke(t,{sourceText});
 assert.equal(r.status,0,r.stderr);
 assert.equal(r.sourceUnchanged,true);
 assert.match(r.log,/URIs: https:\/\/security\.ubuntu\.com\/ubuntu\//);
 assert.match(r.log,/Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/);
 assert.match(r.stdout,/PREFLIGHT_APT_PLAN identical packages=3/);
 assert.match(r.log,/INSTALLED/);
});

for(const uri of ['https://security.ubuntu.com/ubuntu.evil','https://security.ubuntu.com:8443/ubuntu','https://security.ubuntu.com/ubuntu?mirror=evil','https://security.ubuntu.com@evil.example/ubuntu','https://security.ubuntu.com/ubuntu//'])test('官方源兼容不得信任相近URI '+uri,t=>{
 const r=invoke(t,{sourceText:source.replace('https://security.ubuntu.com/ubuntu/',uri)});
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/APT_SOURCE_UNTRUSTED/);
 assert.doesNotMatch(r.log,/INSTALLED/);
 assert.equal(r.sourceUnchanged,true);
});

// Ubuntu noble apt-get(8), --simulate: empty [] denotes inconsequential breaks.
// Exact rejected official.plan line from GitHub job 134132859528; no broad suffix normalization.
test('真实official.plan空[]只作为已证标准附注，不改变包版本计划',t=>{
 const r=invoke(t,{mesaSuffix:' []'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PREFLIGHT_APT_PLAN identical packages=4/);assert.match(r.log,/INSTALLED/);
});
test('空[]兼容仍拒绝两源候选版本变化',t=>{const r=invoke(t,{mesaSuffix:' []',drift:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_CHANGED/);assert.doesNotMatch(r.log,/INSTALLED/);});
for(const suffix of [' [broken-package]',' [ ]',' [] trailing',' [] []',' garbage'])test('非空破损列表或未知附注仍拒绝 '+suffix,t=>{
 const r=invoke(t,{mesaSuffix:suffix});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_UNRECOGNIZED/);assert.doesNotMatch(r.log,/INSTALLED/);
});

test('两来源各自独立临时索引刷新，不以旧缓存判定新官方计划',t=>{
 const r=invoke(t,{staleCache:true});assert.equal(r.status,0,r.stderr);const updates=r.log.split('\n').filter(x=>x.startsWith('apt ')&&/ update$/.test(x));assert.equal(updates.length,2);assert.ok(updates.some(x=>x.includes('/original.sources')&&x.includes('/original-lists')));assert.ok(updates.some(x=>x.includes('/ubuntu.sources')&&x.includes('/lists')));assert.ok(updates.every(x=>x.includes('Dir::Etc::sourceparts=-')&&x.includes('Dir::State::lists=')));assert.match(r.log,/URIs: mirror\+file:\/etc\/apt\/apt-mirrors.txt/);assert.equal(r.sourceUnchanged,true);assert.match(r.log,/INSTALLED/);
});
for(const fail of ['original-update','official-update'])test('独立来源刷新失败不得安装 '+fail,t=>{const r=invoke(t,{fail});assert.equal(r.status,42,r.stderr);assert.doesNotMatch(r.log,/INSTALLED/);assert.equal(r.sourceUnchanged,true);});
test('两份fresh索引实际版本漂移仍拒绝，不复制official给原来源',t=>{const r=invoke(t,{staleCache:true,drift:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_CHANGED/);assert.doesNotMatch(r.log,/INSTALLED/);});

test('runner来源仍需Ubuntu签名，缺失或未知信任均不得刷新与安装',t=>{
 for(const options of [{badKey:true},{untrusted:true}]){
  const r=invoke(t,{runnerSources:true,...options});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/APT_SOURCE_(SIGNATURE_REQUIRED|UNTRUSTED)/);
  assert.equal(r.log,'');
  assert.equal(r.sourceUnchanged,true);
 }
});
