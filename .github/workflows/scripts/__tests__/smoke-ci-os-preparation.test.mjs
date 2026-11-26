import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const workflow=YAML.parse(readFileSync(new URL('../../ci-smoke-glob-runner.yml',import.meta.url),'utf8'));
const job=Object.values(workflow.jobs).find(j=>j.steps?.some(s=>s.name?.startsWith('Install ffmpeg')));
const steps=job.steps.filter(s=>s.name?.startsWith('Install ffmpeg')||s.name==='Install capability protocol regression dependencies');
function invoke(t,{present=[],failed='',broken='',missing=''}={}){
 const top=mkdtempSync(join(tmpdir(),'smoke-os-prepare-'));t.after(()=>rmSync(top,{recursive:true,force:true}));const trace=join(top,'trace');writeFileSync(trace,'');
 const put=(name,body)=>writeFileSync(join(top,name),'#!/bin/sh\n'+body+'\n',{mode:0o755});
 const install=`for pair in zsh:zsh python3:python3 jq:jq libxml2-utils:xmllint ffmpeg:ffmpeg; do
 pkg="\${pair%%:*}"; tool="\${pair#*:}"
 case " $* " in *" $pkg "*)
 [ "$TEST_MISSING" != "$tool" ] || continue
 printf '#!/bin/sh\\nprintf "version %s %%s\\\\n" "$*" >> "$TEST_TRACE"\\n[ "$TEST_BROKEN" != "%s" ] || exit 44\\n' "$tool" "$tool" > "$TEST_BIN/$tool"
 /bin/chmod +x "$TEST_BIN/$tool";; esac
 done`;
 put('sudo','exec "$@"');put('head','exec /usr/bin/head "$@"');
 put('apt-get','printf "apt %s\\n" "$*" >> "$TEST_TRACE"; exit 43');
 put('bash',`case "$1" in *prepare-openclaw-os-packages.sh)
 printf "helper %s\\n" "$*" >> "$TEST_TRACE"
 [ "$TEST_FAILED" != helper ] || exit 43
 shift 5
 ${install}
 ;; *) exec /bin/bash "$@";; esac`);
 put('timeout','printf "timeout %s\\n" "$*" >> "$TEST_TRACE"\n[ "$TEST_FAILED" != timeout ] || exit 124\nshift\nexec "$@"');
 for(const name of present)put(name,'printf "version '+name+' %s\\n" "$*" >> "$TEST_TRACE"\n[ "$TEST_BROKEN" != "'+name+'" ] || exit 44');
 let status=0,output='';
 for(const s of steps){const r=spawnSync('/bin/bash',['-e','-o','pipefail','-c',s.run],{cwd:new URL('../../../..',import.meta.url),env:{...process.env,PATH:top,RUNNER_TEMP:top,TEST_BIN:top,TEST_TRACE:trace,TEST_FAILED:failed,TEST_BROKEN:broken,TEST_MISSING:missing},encoding:'utf8',timeout:5000});status=r.status;output+=r.stdout+r.stderr;if(status!==0)break;}
 return {status,output,trace:readFileSync(trace,'utf8')};
}
function validate(w){const j=Object.values(w.jobs).find(j=>j.steps?.some(s=>s.name?.startsWith('Install ffmpeg')));assert.ok(j);const s=j.steps.filter(s=>s.name?.startsWith('Install ffmpeg')||s.name==='Install capability protocol regression dependencies');assert.equal(j['timeout-minutes'],25);assert.equal(s.length,1);assert.equal(s[0]['timeout-minutes'],6);assert.equal(s[0]['continue-on-error'],undefined);assert.equal(s[0].if,undefined);assert.match(s[0].run,/^timeout 300s bash \.github\/workflows\/scripts\/prepare-smoke-os-packages\.sh$/);}
test('Smoke两处原依赖在同一个300秒准备边界内，原job25分钟不变',()=>validate(workflow));
test('原job预算/准备预算/入口断链/失败豁免mutation仍拒绝',()=>{for(const mutate of [j=>{j['timeout-minutes']=26;},j=>{j.steps.find(s=>s.name?.startsWith('Install ffmpeg')).run='true';},j=>{j.steps.find(s=>s.name?.startsWith('Install ffmpeg')).run=j.steps.find(s=>s.name?.startsWith('Install ffmpeg')).run.replace('300s','301s');},j=>{j.steps.find(s=>s.name?.startsWith('Install ffmpeg'))['continue-on-error']=true;},j=>{j.steps.find(s=>s.name?.startsWith('Install ffmpeg')).if='always()';}]){const w=structuredClone(workflow);mutate(Object.values(w.jobs).find(j=>j.steps?.some(s=>s.name?.startsWith('Install ffmpeg'))));assert.throws(()=>validate(w));}});
test('真实bash保留原安装包与每项工具版本检查',t=>{
 const r=invoke(t);assert.equal(r.status,0,r.output);
 const helper=r.trace.split('\n').find(l=>l.startsWith('helper '));
 assert.ok(helper,r.trace);
 assert.match(helper,/zsh python3 jq libxml2-utils fontconfig fonts-noto-cjk postgresql ffmpeg$/);
 assert.equal((r.trace.match(/^timeout /gm)||[]).length,1);
 for(const tool of ['ffmpeg','zsh','python3','jq','xmllint'])assert.match(r.trace,new RegExp('version '+tool+' --?version'));
 assert.match(r.output,/PREFLIGHT_DONE smoke-os-packages/);
});
test('预装ffmpeg不重装，四capability包原无条件APT语义保持',t=>{const r=invoke(t,{present:['ffmpeg','zsh','python3','jq','xmllint']});assert.equal(r.status,0,r.output);const helper=r.trace.split('\n').find(l=>l.startsWith('helper '));assert.ok(helper,r.trace);assert.match(helper,/zsh python3 jq libxml2-utils fontconfig fonts-noto-cjk postgresql$/);assert.doesNotMatch(helper,/ ffmpeg/);assert.match(r.trace,/version ffmpeg -version/);});
for(const [failed,code]of [['helper',43],['timeout',124]])test('真实bash '+failed+'失败仍阻断且不发准备DONE',t=>{const r=invoke(t,{failed});assert.equal(r.status,code,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE smoke-os-packages/);if(failed!=='helper')assert.doesNotMatch(r.trace,/^helper /m);});
for(const tool of ['ffmpeg','zsh','python3','jq','xmllint'])test(tool+'版本命令失败必须拒绝',t=>{const r=invoke(t,{broken:tool});assert.equal(r.status,44,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE smoke-os-packages/);});
test('helper声称成功但xmllint仍缺失不得发准备DONE',t=>{const r=invoke(t,{missing:'xmllint'});assert.notEqual(r.status,0,r.output);assert.doesNotMatch(r.output,/PREFLIGHT_DONE smoke-os-packages/);});

test('Smoke只通过已验证的runner签名源路径安装，绕过 _apt 无法访问的私有目录',t=>{
 const r=invoke(t);
 assert.equal(r.status,0,r.output);
 assert.match(r.trace,/^helper \.github\/workflows\/scripts\/prepare-openclaw-os-packages\.sh --runner-sources \/tmp \/etc\/apt\/sources.list.d\/ubuntu.sources \/etc\/apt\/apt-mirrors.txt /m);
 assert.doesNotMatch(r.trace,/^apt /m);
});
