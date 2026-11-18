import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
const source=new URL('../douyin-phone-adb',import.meta.url).pathname;
const root=dirname(source);
const packet=(v=44.026,a=83.253)=>({streams:[{index:0,codec_type:'video'},{index:1,codec_type:'audio'}],packets:[{stream_index:0,pts_time:'0'},{stream_index:0,pts_time:String(v)},{stream_index:1,pts_time:'0'},{stream_index:1,pts_time:String(a)}]});
function fixture(mode='normal',data=packet()){
 const d=mkdtempSync(join(tmpdir(),'record-progress-'));try{
  writeFileSync(join(d,'media.mkv'),'test media');
  writeFileSync(join(d,'proof.json'),JSON.stringify({status:'ready',pid:999999999,parent_pid:1,expected_argv:['/bin/false','--record='+join(d,'media.mkv')],observations:[{ps:process.getuid()+' 1 Wed Nov 18 02:36:03 2026 Ss /bin/false --record='+join(d,'media.mkv')}]}),{mode:0o600});
  writeFileSync(join(d,'probe'),`#!/usr/bin/python3\nimport json,time,sys\n${mode==='timeout'?'time.sleep(12)':mode==='oversize'?"print(' '*9000000)":mode==='corrupt'?"print('bad');sys.exit(1)":'print('+JSON.stringify(JSON.stringify(data))+')'}\n`,{mode:0o700});
  let text=readFileSync(source,'utf8');let fn=text.slice(text.indexOf('record_status() {'),text.indexOf('\nrecord_stop() {'));
  writeFileSync(join(d,'status.zsh'),`set -euo pipefail\nEVIDENCE_ROOT=${JSON.stringify(d)}\nPHONE_CONTROLLER_DIR=${JSON.stringify(root)}\nPYTHON_BIN=/usr/bin/python3\nFFPROBE=${JSON.stringify(join(d,'probe'))}\nrequire_evidence_id(){ true; }\nrecord_pid_file(){ print ${JSON.stringify(join(d,'pid'))}; }\nrecord_out_file(){ print ${JSON.stringify(join(d,'media.mkv'))}; }\n${fn}\nrecord_status proof\n`);
  // Actual status command must consume the same startup filename as production.
  writeFileSync(join(d,'proof.capture-startup.json'),readFileSync(join(d,'proof.json')),{mode:0o600});
  const r=spawnSync('/bin/zsh',[join(d,'status.zsh')],{encoding:'utf8',timeout:8000});assert.equal(r.status,0,r.stderr);
  const line=r.stdout.split('\n').find(x=>x.startsWith('media_progress='));assert.ok(line,'actual record-status omitted actual media progress');return JSON.parse(line.slice('media_progress='.length));
 }finally{rmSync(d,{recursive:true,force:true});}
}
test('actual record-status distinguishes video progress from longer audio/container wall duration',()=>{
 const p=fixture();assert.equal(p.capture_state,'terminal');assert.equal(p.progress_status,'observed');assert.equal(p.video.last_pts_seconds,44.026);assert.equal(p.audio.last_pts_seconds,83.253);assert.equal(p.coverage_verified,false);
});
test('audio advance or absent video cannot invent full video coverage',()=>{
 const p=fixture('normal',packet(8,120));assert.equal(p.video.last_pts_seconds,8);assert.equal(p.audio.last_pts_seconds,120);assert.equal(p.coverage_verified,false);
 const a=fixture('normal',{streams:[{index:1,codec_type:'audio'}],packets:[{stream_index:1,pts_time:'90'}]});assert.equal(a.video,null);assert.equal(a.coverage_verified,false);
});
test('corrupt and oversized probe output stay unknown without killing or writing media',()=>{
 for(const mode of ['corrupt','oversize']){const p=fixture(mode);assert.equal(p.progress_status,'unknown');assert.equal(p.coverage_verified,false);}
});
test('hung local probe has a fixed bound and does not claim progress',()=>{
 const start=Date.now();const p=fixture('timeout');assert.equal(p.progress_status,'unknown');assert.equal(p.reason,'probe_timeout');assert.ok(Date.now()-start<7500);
});
test('bad or backwards packet PTS cannot supply misleading progress',()=>{
 for(const data of [packet('NaN'),{...packet(),packets:[{stream_index:0,pts_time:'5'},{stream_index:0,pts_time:'4'}]}])assert.equal(fixture('normal',data).progress_status,'unknown');
});

test('deployment carries the actual recording progress dependency',()=>{
 assert.match(readFileSync(join(root,'deploy.sh'),'utf8'),/\brecording-progress\.py\b/);
});
test('live matching recorder is recording; foreign argv and missing startup proof remain unknown',()=>{
 const d=mkdtempSync(join(tmpdir(),'record-progress-owner-'));try{
 const script=String.raw`import pathlib,sys,subprocess,importlib.util,json,shlex,os
r=pathlib.Path(sys.argv[2]);s=importlib.util.spec_from_file_location('p',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
media=r/'media.mkv';media.write_bytes(b'x'); sleeper=r/'sleeper.py';sleeper.write_text('import time; time.sleep(20)')
child=subprocess.Popen([sys.executable,str(sleeper),'--record='+str(media)])
try:
 row=subprocess.check_output(['/bin/ps','-ww','-p',str(child.pid),'-o','uid=,ppid=,lstart=,stat=,command='],text=True).strip();args=shlex.split(row.split(None,8)[8])
 p={'status':'ready','pid':child.pid,'parent_pid':os.getpid(),'expected_argv':args,'observations':[{'ps':row}]};proof=r/'proof.json';proof.write_text(json.dumps(p));proof.chmod(0o600)
 assert m.recorder_state(proof,media)=='recording'
 p['expected_argv'].append('foreign');proof.write_text(json.dumps(p));assert m.recorder_state(proof,media)=='unknown'
 proof.unlink();assert m.recorder_state(proof,media)=='unknown'
finally:child.terminate();child.wait(timeout=2)
print('identity verified')`;
 const r=spawnSync('/usr/bin/python3',['-c',script,join(root,'recording-progress.py'),d],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 }finally{rmSync(d,{recursive:true,force:true});}
});
