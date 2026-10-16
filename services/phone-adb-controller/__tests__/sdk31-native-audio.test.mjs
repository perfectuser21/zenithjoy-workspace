import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const native=source.match(/record_native_audio\(\) \{[\s\S]*?\n\}/)[0];
const fixture=name=>readFileSync(new URL('./fixtures/sdk31-native/'+name,import.meta.url),'utf8');
const original=fixture('actual-current-audio.txt'),pkg='com.ss.android.ugc.aweme';
const track=original.split('\n').find(l=>l.includes('piid:303 '));
function run({audio=original,packages=fixture('actual-package-uid.txt'),owners=fixture('actual-uid-owners.txt'),sdk='31',foreground=pkg+'/'+pkg+'.detail.ui.DetailActivity'}={}) {
 const dir=mkdtempSync(join(tmpdir(),'sdk31-native-'));
 for(const [file,text] of Object.entries({'audio.txt':audio,'package-uid.txt':packages,'uid-owners.txt':owners}))writeFileSync(join(dir,file),text);
 const adb=join(dir,'adb');writeFileSync(adb,`#!/bin/sh
case "$*" in
 *'getprop ro.build.version.sdk'*) printf '%s\\n' "$SDK";;
 *'cmd package list packages -U --uid'*) cat "$FIXTURE/uid-owners.txt";;
 *'cmd package list packages -U com.ss.android.ugc.aweme'*) cat "$FIXTURE/package-uid.txt";;
 *'dumpsys audio'*) cat "$FIXTURE/audio.txt";;
 *) exit 12;;
esac
`,{mode:0o755});
 const script=`set -eu
require_evidence_id(){ :; }
foreground_package(){ print -- "$FOREGROUND"; }
_foreground_is_exact_douyin(){ [[ "$1" == "com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity" ]]; }
record_playback_state(){ print -- "$FOREGROUND" > "$EVIDENCE_ROOT/$1.foreground.txt";print -- 'state=1' > "$EVIDENCE_ROOT/$1.media-session.txt";print 1; }
record_playback_hash(){ "$PYTHON_BIN" -c 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$EVIDENCE_ROOT/$1"; }
${native}
record_native_audio actual`;
 const r=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,SDK:sdk,FIXTURE:dir,FOREGROUND:foreground,EVIDENCE_ROOT:dir,PYTHON_BIN:'/usr/bin/python3',ADB:adb,SERIAL:'FAKE',DOUYIN_PACKAGE:pkg}});
 assert.equal(r.status,0,r.stderr);
 return {...r,proof:JSON.parse(readFileSync(join(dir,'actual.native-audio.json'),'utf8'))};
}
test('真实SDK31片段：前缀包查询两行仍精确识别主UID及原生started',()=>{
 const r=run();assert.equal(r.proof.state,'started');assert.equal(r.proof.uid,10095);assert.equal(r.proof.pid,28604);assert.equal(r.proof.piid,303);assert.equal(r.proof.package_uid_verified,true);assert.match(r.stdout,/native_audio_state=started/);assert.match(r.stdout,/media_session_state=1/);
});
test('SDK31相同精确主包即使无前缀包也必须解析真实旧格式',()=>assert.equal(run({packages:'package:'+pkg+' uid:10095\n'}).proof.state,'started'));
test('SDK31原生paused是inactive，不以MediaSession state=1冒充started',()=>assert.equal(run({audio:original.replace('state:started','state:paused')}).proof.state,'inactive'));
for(const [name,options] of Object.entries({
 缺静音段:{audio:original.replace('  muted player piids:\n','')},
 缺banned段:{audio:original.replace('  banned uids:\n','')},
 静音列表有目标:{audio:original.replace('  muted player piids:\n','  muted player piids: 303\n')},
 banned列表有目标:{audio:original.replace('  banned uids:\n','  banned uids: 10095\n')},
 外来started:{audio:original.replace(track,track+'\n'+track.replace('piid:303','piid:304').replace('10095/28604','10087/9900'))},
 多个目标started:{audio:original.replace(track,track+'\n'+track.replace('piid:303','piid:304'))},
 只有前缀包:{packages:'package:'+pkg+'.mobile uid:10087\n'},
 重复精确主包:{packages:'package:'+pkg+' uid:10095\npackage:'+pkg+' uid:10096\n'},
 共享UID:{owners:'package:'+pkg+' uid:10095\npackage:'+pkg+'.mobile uid:10095\n'},
 当前媒体字段损坏:{audio:original.replace('state:started','state:not_a_state')},
 外来非AudioTrack活跃:{audio:original.replace('10072/1398 state:idle','10072/1398 state:started')},
 前台换包:{foreground:'com.android.launcher3/.Launcher'},
 SDK未知:{sdk:''}
}))test('SDK31拒绝'+name,()=>assert.equal(run(options).proof.state,'unknown'));
test('SDK31只看当前players，不采信日志中的外来started',()=>assert.equal(run({audio:original+'Audio event log: history only\n'+track.replace('10095/28604','10087/9900')+'\n'}).proof.state,'started'));
test('SDK>=33原mutedState解析仍可用',()=>{
 const audio=original.replace('sessionId:273','mutedState:none FormatInfo{codec=pcm}');
 assert.equal(run({sdk:'36',audio}).proof.state,'started');
});
