import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=new URL('../../../../',import.meta.url);
const path=p=>new URL(p,root);
const smoke=readFileSync(path('.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh'),'utf8');
const guard=smoke.slice(smoke.indexOf('# 层27:'),smoke.indexOf('# 层28:'));
const controller=readFileSync(path('services/phone-adb-controller/douyin-phone-adb'),'utf8');
const decoder=readFileSync(path('services/phone-adb-controller/decode-recording.py'),'utf8');
function run(c=controller,d=decoder){const dir=mkdtempSync(join(tmpdir(),'recording-level-smoke-'));try{
 for(const [name,data] of [['douyin-phone-adb',c],['decode-recording.py',d],['harvest-keyword.sh',readFileSync(path('services/phone-adb-controller/harvest-keyword.sh'))]])writeFileSync(join(dir,name),data);
 mkdirSync(join(dir,'__tests__'));writeFileSync(join(dir,'__tests__/decoded-recording.test.mjs'),readFileSync(path('services/phone-adb-controller/__tests__/decoded-recording.test.mjs')));
 return spawnSync('bash',['-c','set -euo pipefail\nD="$1"\nC="$D/douyin-phone-adb"\nfail(){ echo "$*" >&2; exit 1; }\n'+guard,'guard',dir],{encoding:'utf8'});
}finally{rmSync(dir,{recursive:true,force:true});}}
test('录音电平闸接受SDK31真实decoder与SDK33内联双路径',()=>{const r=run();assert.equal(r.status,0,r.stderr);});
test('录音电平闸实际拒绝伪造的legacy电平、decoder电平和断开的decoder调用',()=>{
 for(const [c,d] of [[controller.replace('-af volumedetect','-af anull'),decoder],[controller,decoder.replace("'-af','volumedetect'","'-af','anull'")],[controller.replace('$PHONE_CONTROLLER_DIR/decode-recording.py','$PHONE_CONTROLLER_DIR/unbound.py'),decoder]]){
  const r=run(c,d);assert.notEqual(r.status,0,'mutated real guard must fire');
 }
});
test('OpenClaw CI安装实际decoder回归的ffmpeg依赖',()=>{
 const ci=readFileSync(path('.github/workflows/ci-l3-code.yml'),'utf8').split('  openclaw-scripts-test:')[1].split('\n  api-scripts-test:')[0];
 assert.match(ci,/apt-get install[^\n]*\bffmpeg\b/);
});
