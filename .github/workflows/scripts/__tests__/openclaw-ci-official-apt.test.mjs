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
function invoke(t,{fail='',drift=false,untrusted=false,badPlan=false,badKey=false,actualSource=false}={}){
 const top=mkdtempSync(join(tmpdir(),'official-apt-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const bin=join(top,'bin'),tmp=join(top,'tmp'),src=join(top,'ubuntu.sources'),mirrors=join(top,'apt-mirrors.txt'),trace=join(top,'trace');mkdirSync(bin);mkdirSync(tmp);
 writeFileSync(src,actualSource?readFileSync(new URL('./fixtures/ubuntu24-20261012.334.sources',import.meta.url),'utf8'):badKey?source.replaceAll('/usr/share/keyrings/ubuntu-archive-keyring.gpg','/tmp/unknown.gpg'):untrusted?source.replace('mirror+file:/etc/apt/apt-mirrors.txt','https://evil.example/ubuntu/'):source);writeFileSync(mirrors,'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\n');
 const before=readFileSync(src,'utf8');
 writeFileSync(join(bin,'sudo'),'#!/bin/sh\nexec "$@"\n',{mode:0o755});
 writeFileSync(join(bin,'apt-get'),`#!/bin/sh
printf 'apt %s\\n' "$*" >> "$APT_TEST_TRACE"
isolated=0; sources=''
for arg in "$@"; do case "$arg" in Dir::Etc::sourcelist=*) isolated=1; sources="\${arg#*=}";; esac; done
if [ "$isolated" = 1 ]; then /bin/cat "$sources" >> "$APT_TEST_TRACE"; fi
case " $* " in
 *' --simulate '*)
  [ "$APT_TEST_FAIL" != simulate ] || exit 41
  if [ "$APT_TEST_BAD_PLAN" = 1 ]; then printf 'Inst unexpected-format\\n'; exit 0; fi
  version=1.0; [ "$isolated:$APT_TEST_DRIFT" != 1:1 ] || version=2.0
  printf 'Inst zsh (%s Ubuntu:24.04/noble [amd64])\\nInst libxml2-utils (2.0 Ubuntu:24.04/noble [amd64])\\nInst ffmpeg (6.1 Ubuntu:24.04/noble [amd64])\\n' "$version";;
 *' update '*) [ "$APT_TEST_FAIL" != update ] || exit 42;;
 *' install '*) [ "$APT_TEST_FAIL" != install ] || exit 43; printf 'INSTALLED\\n' >> "$APT_TEST_TRACE";;
 *) exit 99;;
esac
`,{mode:0o755});
 const r=spawnSync('/bin/bash',[script,tmp,src,mirrors,'zsh','libxml2-utils','ffmpeg'],{encoding:'utf8',timeout:5000,env:{...process.env,PATH:bin+':'+process.env.PATH,APT_TEST_TRACE:trace,APT_TEST_FAIL:fail,APT_TEST_DRIFT:drift?'1':'0',APT_TEST_BAD_PLAN:badPlan?'1':'0'}});
 let log='';try{log=readFileSync(trace,'utf8');}catch{}
 return {...r,log,sourceUnchanged:readFileSync(src,'utf8')===before};
}
test('实际bash仅进程隔离官方Ubuntu源，计划相同才安装，原source不改',t=>{const r=invoke(t);assert.equal(r.status,0,r.stderr);assert.equal(r.sourceUnchanged,true);assert.match(r.log,/URIs: https:\/\/archive\.ubuntu\.com\/ubuntu\//);assert.match(r.log,/URIs: https:\/\/security\.ubuntu\.com\/ubuntu\//);assert.match(r.log,/Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring.gpg/);assert.match(r.log,/Dir::Etc::sourceparts=-/);assert.match(r.log,/Dir::State::lists=/);assert.match(r.log,/APT::Update::Error-Mode=any/);assert.doesNotMatch(r.log,/Dir::Cache::archives=|allow-unauthenticated|AllowInsecure|Trusted: yes/);assert.match(r.log,/INSTALLED/);assert.match(r.stderr,/PREFLIGHT_APT_STAGE .*elapsed_s=/);});
test('签名索引选择的pkg/version计划漂移即拒绝，不安装',t=>{const r=invoke(t,{drift:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_CHANGED/);assert.doesNotMatch(r.log,/INSTALLED/);assert.equal(r.sourceUnchanged,true);});
test('未知源拒绝而不是授予Ubuntu签名信任',t=>{const r=invoke(t,{untrusted:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_SOURCE_UNTRUSTED/);assert.doesNotMatch(r.log,/INSTALLED/);assert.equal(r.sourceUnchanged,true);});
test('未知签名key拒绝且不安装',t=>{const r=invoke(t,{badKey:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_SOURCE_SIGNATURE_REQUIRED/);assert.doesNotMatch(r.log,/INSTALLED/);});
test('两边都有无法解析的Inst也不能被过滤成相同空计划',t=>{const r=invoke(t,{badPlan:true});assert.notEqual(r.status,0);assert.match(r.stderr,/APT_PLAN_UNRECOGNIZED/);assert.doesNotMatch(r.log,/INSTALLED/);});
for(const [phase,code] of [['simulate',41],['update',42],['install',43]])test('真实bash失败保留'+phase+'阶段且不报告完成',t=>{const r=invoke(t,{fail:phase});assert.equal(r.status,code,r.stderr);assert.doesNotMatch(r.stdout,/PREFLIGHT_APT_DONE/);assert.equal(r.sourceUnchanged,true);});

test('真实runner完整source含纯注释分段，仍逐段验证真实源后安装',t=>{const r=invoke(t,{actualSource:true});assert.equal(r.status,0,r.stderr);assert.equal(r.sourceUnchanged,true);assert.match(r.log,/INSTALLED/);});
