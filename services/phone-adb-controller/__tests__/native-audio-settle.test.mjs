import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
function run(states,{finalUnknown=false}={}){
 const fn=source.match(/record_native_audio_settled\(\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(fn,'bounded native readback helper must exist');
 const r=spawnSync('zsh',['-c',`set -eu
 states=(${states.join(' ')})
 index=0
 record_native_audio(){ print -u2 -- "read:$1"; if [[ "$1" == fixture && '${finalUnknown}' == true ]]; then print -- 'native_audio_state=unknown native_audio_uid=10095 '; else print -- "native_audio_state=$states[1] native_audio_uid=10095 "; fi; }
 wait_ms(){ print -u2 -- wait; if (( \${#states} > 1 )); then shift states; fi; }
 ${fn}
 record_native_audio_settled fixture`],{encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r;
}
test('notification focus transient requires new native proof and keeps initial evidence',()=>{
 const r=run(['unknown','unknown','started']);
 assert.match(r.stdout,/native_audio_state=started/);
 assert.match(r.stderr,/read:fixture-initial/);assert.match(r.stderr,/read:fixture-wait2/);
 assert.match(r.stderr,/read:fixture\n/);
});
test('persistent unknown remains unknown after bounded passive reads',()=>{
 const r=run(['unknown']);assert.match(r.stdout,/native_audio_state=unknown/);
 assert.equal((r.stderr.match(/^wait$/gm)||[]).length,4);
});
test('stable inactive does not trigger wait or UI interaction',()=>{
 const r=run(['inactive']);assert.match(r.stdout,/native_audio_state=inactive/);
 assert.doesNotMatch(r.stderr,/wait/);
});
test('last fixed-name native readback cannot be replaced by prior success',()=>{
 const r=run(['unknown','started'],{finalUnknown:true});
 assert.match(r.stdout,/native_audio_state=unknown/);
 assert.match(r.stderr,/read:fixture-wait1/);assert.match(r.stderr,/read:fixture\n/);
});
