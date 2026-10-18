// Isolated real stop-function fixture. No device, production lock or real signal.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const stop=source.slice(source.indexOf('record_stop() {'),source.indexOf('record_extract_audio() {'));
const settle=source.match(/record_native_audio_settled\(\) \{[\s\S]*?\n\}/)[0];
for(const failure of ['archive_collision','archive_missing'])test('native evidence '+failure+' must stop its owned recorder before reporting failure',()=>{
 const dir=mkdtempSync(join(tmpdir(),'stop-native-failed-'));
 try{
  writeFileSync(join(dir,'live'),'owned');writeFileSync(join(dir,'rec.pid'),'4321');
  if(failure==='archive_collision')writeFileSync(join(dir,'fixture-playback-end-initial.audio.txt'),'protected');
  const r=spawnSync('zsh',['-c',`set -eu
   require_evidence_id(){ :; }
   record_native_audio(){
    local suffix
    for suffix in audio.txt package-uid.txt uid-owners.txt foreground.txt media-session.txt native-audio.json native-sdk.txt; do
     [[ '${failure}' != archive_missing || "$suffix" != native-sdk.txt ]] || continue
     print proof > "$EVIDENCE_ROOT/$1.$suffix"
    done
    print -- 'native_audio_state=unknown native_audio_transient_notification=true'
   }
   record_pid_file(){ print -- "$EVIDENCE_ROOT/rec.pid"; }
   record_out_file(){ print -- "$EVIDENCE_ROOT/rec.wav"; }
   kill(){ [[ -e "$EVIDENCE_ROOT/live" ]]; }
   record_owned_signal(){ print -r -- "$*" >> "$EVIDENCE_ROOT/signals"; /bin/rm "$EVIDENCE_ROOT/live"; }
   wait_ms(){ :; }
   die(){ print -u2 -- "$*";exit 2; }
   ${settle}
   ${stop}
   record_stop fixture
  `],{encoding:'utf8',env:{...process.env,EVIDENCE_ROOT:dir}});
  assert.equal(r.status,2,r.stderr);assert.match(r.stderr,/native_readback_failed/);
  assert.equal(readFileSync(join(dir,'signals'),'utf8').trim(),'fixture 4321 INT');
  assert.equal(existsSync(join(dir,'live')),false);assert.equal(existsSync(join(dir,'rec.pid')),false);
  if(failure==='archive_collision')assert.equal(readFileSync(join(dir,'fixture-playback-end-initial.audio.txt'),'utf8'),'protected');
  assert.doesNotMatch(r.stdout,/record_stopped|playback_restored=true/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
