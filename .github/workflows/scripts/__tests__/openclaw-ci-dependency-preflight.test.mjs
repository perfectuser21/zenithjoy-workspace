import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const workflow=YAML.parse(readFileSync(new URL('../../ci-l3-code.yml',import.meta.url),'utf8'));
const ids=['openclaw-apt-index','openclaw-os-packages','openclaw-pillow'];
function setup(w=workflow){return ids.map(id=>w.jobs['openclaw-scripts-test'].steps.find(s=>s.id===id));}
function validate(w){
 assert.equal(w.jobs['openclaw-scripts-test']['timeout-minutes'],10);
 for(const [i,s] of setup(w).entries()){
  assert.ok(s,`missing separately visible dependency phase ${ids[i]}`);
  assert.equal(s['timeout-minutes'],2);assert.equal(s['continue-on-error'],undefined);assert.equal(s.if,undefined);
  assert.match(s.run,/PREFLIGHT_START/);assert.match(s.run,/PREFLIGHT_DONE/);assert.match(s.run,/timeout (90s|60s) /);
 }
 assert.match(setup(w)[0].run,/apt-get.*update/);assert.match(setup(w)[1].run,/for pair in zsh:zsh xmllint:libxml2-utils ffmpeg:ffmpeg/);assert.match(setup(w)[1].run,/apt-get install.*"\$\{missing\[@\]\}"/);
 assert.match(setup(w)[2].run,/pip install.*Pillow/);
}
test('依赖准备拆成可定位有界三阶段，原10分钟和全量门禁保持',()=>validate(workflow));
function invoke(t,failed='',present=[],broken='',expired=false){
 validate(workflow);const top=mkdtempSync(join(tmpdir(),'ci-dependency-preflight-'));t.after(()=>rmSync(top,{recursive:true,force:true}));
 const trace=join(top,'trace');
 const put=(name,script)=>writeFileSync(join(top,name),'#!/bin/sh\n'+script+'\n',{mode:0o755});
 put('timeout','printf "timeout %s\\n" "$*" >> "$DEPENDENCY_TRACE"; case "$*" in *" install "*) [ "$DEPENDENCY_EXPIRED" != 1 ] || exit 124;; esac; shift; exec "$@"');put('sudo','exec "$@"');
 put('env','exec /usr/bin/env "$@"');
 put('apt-get',`printf "apt %s\\n" "$*" >> "$DEPENDENCY_TRACE"
 case "$*" in *update*) phase=apt-index;; *) phase=os-packages;; esac
 [ "$DEPENDENCY_FAILED" != "$phase" ] || exit 43
 if [ "$phase" = os-packages ]; then
  for pair in zsh:zsh libxml2-utils:xmllint ffmpeg:ffmpeg; do
   pkg="\${pair%%:*}"; tool="\${pair#*:}"
   case " $* " in *" $pkg "*)
    printf '#!/bin/sh\n' > "$DEPENDENCY_BIN/$tool"
    printf 'printf "tool %s %%s\\n" "$*" >> "$DEPENDENCY_TRACE"\n' "$tool" >> "$DEPENDENCY_BIN/$tool"
    printf '[ "$DEPENDENCY_BROKEN" != "%s" ] || exit 44\n' "$tool" >> "$DEPENDENCY_BIN/$tool"
    /bin/chmod +x "$DEPENDENCY_BIN/$tool";;
   esac
  done
 fi`);
 put('python3','printf "python %s\\n" "$*" >> "$DEPENDENCY_TRACE"; [ "$DEPENDENCY_FAILED" != pillow ] || exit 43');
 for(const name of present)put(name,'printf "tool '+name+' %s\\n" "$*" >> "$DEPENDENCY_TRACE"; [ "$DEPENDENCY_BROKEN" != "'+name+'" ] || exit 44');
 let output='',status=0;
 for(const s of setup()){
  const r=spawnSync('/bin/bash',['-e','-o','pipefail','-c',s.run],{env:{...process.env,PATH:top,DEPENDENCY_BIN:top,DEPENDENCY_TRACE:trace,DEPENDENCY_FAILED:failed,DEPENDENCY_BROKEN:broken,DEPENDENCY_EXPIRED:expired?'1':'0'},encoding:'utf8',timeout:5000});
  output+=r.stdout+r.stderr;status=r.status;if(status!==0)break;
 }
 return {status,output,trace:readFileSync(trace,'utf8')};
}
test('实际阶段命令包含所有原依赖，成功才发DONE',t=>{const r=invoke(t);assert.equal(r.status,0,r.output);assert.match(r.trace,/apt .*update/);assert.match(r.trace,/apt .*install.*zsh libxml2-utils ffmpeg/);assert.match(r.trace,/pip install.*Pillow/);assert.equal((r.output.match(/PREFLIGHT_DONE/g)||[]).length,3);});
for(const [i,phase] of ['apt-index','os-packages','pillow'].entries())test('依赖失败保留精确阶段且不执行后续：'+phase,t=>{const r=invoke(t,phase);assert.equal(r.status,43,r.output);assert.equal((r.output.match(/PREFLIGHT_START/g)||[]).length,i+1);assert.equal((r.output.match(/PREFLIGHT_DONE/g)||[]).length,i);});
test('准备阶段缺失/放行失败/扩大总时限仍被守卫拒绝',()=>{
 for(const mutate of [w=>{w.jobs['openclaw-scripts-test']['timeout-minutes']=11;},w=>{w.jobs['openclaw-scripts-test'].steps=w.jobs['openclaw-scripts-test'].steps.filter(s=>s.id!==ids[0]);},w=>{setup(w)[1]['continue-on-error']=true;}]){const w=structuredClone(workflow);mutate(w);assert.throws(()=>validate(w));}
});

test('已有ffmpeg不重复下载其依赖，确实缺zsh/xmllint仍安装',t=>{const r=invoke(t,'',['ffmpeg']);assert.equal(r.status,0,r.output);const install=r.trace.split('\n').find(l=>l.startsWith('apt ')&&l.includes(' install '));assert.ok(install);assert.match(install,/zsh libxml2-utils/);assert.doesNotMatch(install,/\bffmpeg\b/);});
test('三工具已存在不发apt install，但必须真实执行三种版本核验',t=>{const r=invoke(t,'',['zsh','xmllint','ffmpeg']);assert.equal(r.status,0,r.output);assert.doesNotMatch(r.trace,/apt .*install/);for(const name of ['zsh','xmllint','ffmpeg']){assert.match(r.output,new RegExp('PREFLIGHT_TOOL '+name+' path='));assert.match(r.trace,new RegExp('tool '+name+' --?version'));}});
test('只有xmllint缺失只安装libxml2-utils，不重新安装其余两种工具',t=>{const r=invoke(t,'',['zsh','ffmpeg']);assert.equal(r.status,0,r.output);const install=r.trace.split('\n').find(l=>l.startsWith('apt ')&&l.includes(' install '));assert.match(install,/libxml2-utils/);assert.doesNotMatch(install,/\bzsh\b|\bffmpeg\b/);});
test('install请求超时20秒/失败文件仅重试1次，外层仍90秒不扩大',t=>{const r=invoke(t);assert.equal(r.status,0,r.output);const line=r.trace.split('\n').find(l=>l.startsWith('timeout ')&&l.includes(' install '));assert.match(line,/^timeout 90s /);for(const option of ['Acquire::Retries=1','Acquire::http::Timeout=20','Acquire::https::Timeout=20','DPkg::Lock::Timeout=20'])assert.ok(line.includes(option),option);});
test('PATH可找到但真实工具不可执行时硬失败，不发OS完成或进Pillow',t=>{const r=invoke(t,'',['zsh','xmllint','ffmpeg'],'ffmpeg');assert.equal(r.status,44,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE os-packages|PREFLIGHT_START pillow/);assert.doesNotMatch(r.trace,/pip install/);});
test('安装失败前也保留三工具实际已有路径/缺失证据',t=>{const r=invoke(t,'os-packages',['ffmpeg']);assert.equal(r.status,43,r.output);assert.match(r.output,/PREFLIGHT_TOOL ffmpeg existing_path=\S+/);assert.match(r.output,/PREFLIGHT_TOOL zsh existing_path=missing/);assert.match(r.output,/PREFLIGHT_TOOL xmllint existing_path=missing/);assert.doesNotMatch(r.output,/PREFLIGHT_DONE os-packages/);});

test('仅OS安装采用300秒外层与6分钟step，job和其余阶段预算保持',()=>{const steps=setup();assert.equal(steps[1]['timeout-minutes'],6);assert.match(steps[1].run,/timeout 300s /);assert.equal(workflow.jobs['openclaw-scripts-test']['timeout-minutes'],10);assert.equal(steps[0]['timeout-minutes'],2);assert.equal(steps[2]['timeout-minutes'],2);});
test('实际bash中OS外层300秒耗尽仍硬失败且不执行Pillow/测试',t=>{const r=invoke(t,'',[], '',true);assert.equal(r.status,124,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE os-packages|PREFLIGHT_START pillow/);assert.doesNotMatch(r.trace,/pip install/);assert.match(r.trace,/timeout 300s .*apt-get install/);});
