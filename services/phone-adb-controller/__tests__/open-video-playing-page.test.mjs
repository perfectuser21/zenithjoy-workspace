import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, accessSync, constants} from 'node:fs';
import {join, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';

const script = new URL('../douyin-phone-adb', import.meta.url).pathname;
const fixture = new URL('./fixtures/video-detail-from-search.xml', import.meta.url).pathname;
const pythonProbe=spawnSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'});
assert.equal(pythonProbe.status,0,pythonProbe.stderr);
const pythonBin=pythonProbe.stdout.trim();assert.ok(isAbsolute(pythonBin));accessSync(pythonBin,constants.X_OK);

test('open-video pauses an autoplaying detail before reading its UI and restores playback', () => {
  const dir = mkdtempSync(join(tmpdir(), 'open-video-autoplay-'));
  try {
    writeFileSync(join(dir, 'registry.tsv'), 'legacy\tSER1\tANY-MODEL\t1200\t2664\n');
    writeFileSync(join(dir, 'state'), 'playing');
    const adb = join(dir, 'adb');
    writeFileSync(adb, `#!/usr/bin/env node
const fs=require('fs'),p=require('path');const d=process.env.FAKE_PHONE_DIR,a=process.argv.slice(2).join(' '),state=p.join(d,'state');
fs.appendFileSync(p.join(d,'calls'),a+'\\n');
if(a.includes('get-state'))console.log('device');
else if(a.includes('getprop'))console.log('ANY-MODEL');
else if(a.includes('dumpsys'))console.log('mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}');
else if(a.includes('am start'))fs.writeFileSync(state,'playing');
else if(a.includes('input keyevent 127'))fs.writeFileSync(state,'paused');
else if(a.includes('input keyevent 126'))fs.writeFileSync(state,'playing');
else if(a.includes('uiautomator dump')){
 const playing=fs.readFileSync(state,'utf8')==='playing';fs.appendFileSync(p.join(d,'dump-states'),playing?'playing\\n':'paused\\n');
 if(playing){console.error('ERROR: could not get idle state');process.exit(1);}
 fs.copyFileSync(process.env.FAKE_DETAIL_XML,p.join(d,'remote.xml'));
}else if(a.includes('shell rm -f')){try{fs.unlinkSync(p.join(d,'remote.xml'));}catch{}}
else if(a.includes('stat -c %s'))console.log(fs.existsSync(p.join(d,'remote.xml'))?fs.statSync(p.join(d,'remote.xml')).size:0);
else if(a.includes(' pull ')){const n=process.argv.indexOf('pull');if(process.argv[n+1].endsWith('.xml'))fs.copyFileSync(p.join(d,'remote.xml'),process.argv[n+2]);else fs.writeFileSync(process.argv[n+2],'png');}
`, {mode: 0o755});
    const r = spawnSync('zsh', [script, '--profile', 'legacy', 'open-video', '7681632828384394202', 'fresh-after-card-open'], {
      env: {...process.env, HOME: dir, DOUYIN_PYTHON_BIN: pythonBin, DOUYIN_PHONE_REGISTRY: join(dir,'registry.tsv'), DOUYIN_ADB_BIN: adb,
        DOUYIN_SIPS_BIN: '/usr/bin/true', DOUYIN_PHONE_TMP_ROOT: join(dir,'tmp'), FAKE_PHONE_DIR: dir, FAKE_DETAIL_XML: fixture},
      encoding: 'utf8', timeout: 8000,
    });
    assert.equal(r.status, 0, `autoplay UI must not exhaust retries: ${r.stderr}; ${r.error?.code || ''}`);
    assert.match(r.stdout, /video_opened=1/);
    assert.equal(readFileSync(join(dir,'state'),'utf8'), 'playing');
    assert.ok(readFileSync(join(dir,'dump-states'),'utf8').trim().split('\n').every(s => s === 'paused'));
    assert.doesNotMatch(readFileSync(join(dir,'calls'),'utf8'), /input tap|input keyevent 85/);
  } finally {rmSync(dir, {recursive:true, force:true});}
});

// 实际控制器CLI；只在临时副本替换既有等待函数，业务函数与守卫字节保持。
function pausedIdle({command='open-video',policy='paused-detail',error='idle',wrongPackage=false,wrongFocus=false,ambiguousFocus=false,pauseFails=false,toggleFails=0,partial=false,freshOnFirst=false,stale=false,panelFails=false,fallbackFails=false,focusChangesAfterPause=false,gateDismiss=false,visionFallback=false,unknownStat=false,androidStat=false,statError='enoent',absence='absent'}={}) {
  const dir=mkdtempSync(join(tmpdir(),'paused-detail-idle-'));
  try {
    const source=readFileSync(script,'utf8'),wait=source.match(/^wait_ms\(\) \{[\s\S]*?^\}/m)?.[0];
    assert.ok(wait);assert.equal(source.match(/^wait_ms\(\) \{/gm)?.length,1);
    const controlled='wait_ms() { require_uint "$1"; (( $1 <= 5000 )) || die "wait must be <= 5000 ms"; }';
    const patched=source.replace(wait,controlled);assert.equal(patched.replace(controlled,wait),source);
    const runner=join(dir,'controller');writeFileSync(runner,patched,{mode:0o755});
    writeFileSync(join(dir,'registry.tsv'),'legacy\tSER1\tANY-MODEL\t1200\t2664\n');
    writeFileSync(join(dir,'state.json'),JSON.stringify({play:command==='wave'?'paused':'playing',toggled:false,dumps:0,toggles:0,page:'detail'}));
    const panel='<hierarchy><node package="com.ss.android.ugc.aweme" text="23条评论"/><node package="com.ss.android.ugc.aweme" class="android.widget.EditText" text="发条评论"/></hierarchy>';
    writeFileSync(join(dir,'panel.xml'),panel);
    const detail=readFileSync(fixture,'utf8');writeFileSync(join(dir,'detail.xml'),wrongPackage?detail.replaceAll('com.ss.android.ugc.aweme','com.other.app'):partial?'<hierarchy><node package="com.ss.android.ugc.aweme"/>':detail);
    const adb=join(dir,'adb');writeFileSync(adb,`#!/usr/bin/env node
const fs=require('fs'),p=require('path'),d=process.env.FAKE_PHONE_DIR,a=process.argv.slice(2),sfile=p.join(d,'state.json');let s=JSON.parse(fs.readFileSync(sfile));const has=v=>a.join(' ').includes(v),save=()=>fs.writeFileSync(sfile,JSON.stringify(s));
fs.appendFileSync(p.join(d,'calls'),a.join(' ')+'\\n');
if(has('get-state'))console.log('device');
else if(has('getprop'))console.log('ANY-MODEL');
else if(has('dumpsys'))console.log(${focusChangesAfterPause}?s.pauseDone?'mCurrentFocus=Window{u0 com.other.app/Other}':'mCurrentFocus=Window{u0 com.ss.android.ugc.aweme/Detail}':${JSON.stringify(ambiguousFocus?'mCurrentFocus=Window{u0 com.ss.android.ugc.aweme/Detail com.other.app/Other}':wrongFocus?'mCurrentFocus=Window{u0 com.ss.android.ugc.aweme.evil/Detail}':'mCurrentFocus=Window{u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity}')});
else if(has('am start'))s.play='playing';
else if(has('input keyevent 127')){if(${pauseFails})process.exit(9);s.play='paused';s.pauseDone=true;}
else if(has('input keyevent 126'))s.play='playing';
else if(has('input keyevent 85')){s.toggles++;save();if(s.toggles===${toggleFails})process.exit(9);s.toggled=!s.toggled;s.play=s.toggled?'playing':'paused';}
else if(has('input tap')){if(${gateDismiss}){s.dismissed=true;s.page='detail';s.play='playing';}else s.page='panel';}
else if(has('shell rm -f')){try{fs.unlinkSync(p.join(d,'remote.xml'));}catch{}}
else if(has('uiautomator dump')){s.dumps++;save();
 if(s.page==='panel'){fs.writeFileSync(p.join(d,'remote.xml'),${panelFails}?'<hierarchy><node package="com.ss.android.ugc.aweme" text="unrelated"/></hierarchy>':fs.readFileSync(p.join(d,'panel.xml')));}
 else if((s.toggled&&!${fallbackFails})||${freshOnFirst}||(${JSON.stringify(error)}==='nonidle'&&s.dumps%3===0)){if(${gateDismiss}&&!s.dismissed)fs.writeFileSync(p.join(d,'remote.xml'),'<hierarchy><node package="com.ss.android.ugc.aweme" text="关闭" clickable="true" bounds="[10,10][110,110]"/></hierarchy>');else fs.copyFileSync(p.join(d,'detail.xml'),p.join(d,'remote.xml'));if(${freshOnFirst}){console.error('ERROR: could not get idle state');process.exit(1);}}
 else {console.error(${JSON.stringify(error)}==='idle'?'ERROR: could not get idle state':'ERROR: transport unavailable');process.exit(1);}
}else if(has('exec-out screencap'))process.stdout.write('fixture-image');
else if(has('stat -c %s')){
 if(${androidStat}&&!fs.existsSync(p.join(d,'remote.xml'))){if(${JSON.stringify(statError)}==='numeric_failure'){console.log('0');process.exit(1);}console.error(${JSON.stringify(statError)}==='enoent'?"stat: '"+a[a.length-1]+"': No such file or directory":'stat: Permission denied');process.exit(1);}
 console.log(${unknownStat}?'unknown':fs.existsSync(p.join(d,'remote.xml'))?fs.statSync(p.join(d,'remote.xml')).size:0);
}else if(has('REMOTE_UI_ABSENT_V1')){
 if(fs.existsSync(p.join(d,'remote.xml'))||${JSON.stringify(absence)}==='exists'||${JSON.stringify(absence)}==='dangling')process.exit(1);
 if(${JSON.stringify(absence)}==='permission'||${JSON.stringify(absence)}==='timeout'){console.error('absence probe unavailable');process.exit(${JSON.stringify(absence)}==='timeout'?124:1);}
 process.stdout.write(${JSON.stringify(absence)}==='absent'?'REMOTE_UI_ABSENT_V1':${JSON.stringify(absence)}==='malformed'?'REMOTE_UI_ABSENT_V1 extra':${JSON.stringify(absence)}==='duplicate'?'REMOTE_UI_ABSENT_V1\\nREMOTE_UI_ABSENT_V1':'');
}
else if(a.includes('pull')){const i=a.indexOf('pull');if(a[i+1].endsWith('.xml'))fs.copyFileSync(p.join(d,'remote.xml'),a[i+2]);else fs.writeFileSync(a[i+2],'png');}
save();
`,{mode:0o755});
    const evidence=join(dir,'evidence');mkdirSync(evidence,{recursive:true});
    if(stale){writeFileSync(join(evidence,'read.xml'),detail);writeFileSync(join(dir,'remote.xml'),detail);}
    const key=join(dir,'fixture-key');writeFileSync(key,'FIXTURE_ONLY=1\n');const locator=join(dir,'locate.py');writeFileSync(locator,`import os\nwith open(os.path.join(os.environ['FAKE_PHONE_DIR'],'calls'),'a') as f:f.write('LOCATE\\n')\nprint('1100 1600')\n`);
    const env={...process.env,HOME:dir,DOUYIN_PYTHON_BIN:pythonBin,FAKE_PHONE_DIR:dir,DOUYIN_PHONE_REGISTRY:join(dir,'registry.tsv'),DOUYIN_ADB_BIN:adb,DOUYIN_SIPS_BIN:'/usr/bin/true',DOUYIN_PHONE_TMP_ROOT:join(dir,'tmp'),...(visionFallback?{DOUYIN_LOCATE_SCRIPT:locator,DOUYIN_LOCATE_KEY_FILE:key}:{})};
    let args=[runner,'--profile','legacy',command,...(command==='open-video'?['7681632828384394202','idle-open']:['idle-comments'])];
    if(command==='wave'){
      const names=['_is_video_detail_xml','_is_fresh_share_detail_xml','_is_complete_douyin_xml','_foreground_is_exact_douyin','_ui_evidence_wave'];
      const functions=names.map(n=>source.match(new RegExp('^'+n+'\\(\\) \\{[\\s\\S]*?^\\}','m'))?.[0]||'').join('\n');
      args=['-c',`set -eu; require_evidence_id(){ :; }; wait_ms(){ :; }; foreground_package(){ "$ADB" -s "$SERIAL" shell dumpsys window; }; ${functions}\n_ui_evidence_wave read "$TEST_POLICY"`];
      Object.assign(env,{ADB:adb,SERIAL:'SER1',EVIDENCE_ROOT:evidence,REMOTE_UI:'/sdcard/ui.xml',PYTHON_BIN:pythonBin,DOUYIN_PACKAGE:'com.ss.android.ugc.aweme',TEST_POLICY:policy});
    }
    const r=spawnSync('zsh',args,{env,encoding:'utf8',timeout:15000});
    return {...r,state:JSON.parse(readFileSync(join(dir,'state.json'))),calls:existsSync(join(dir,'calls'))?readFileSync(join(dir,'calls'),'utf8'):''};
  }finally{rmSync(dir,{recursive:true,force:true});}
}

test('open-video两次本命令暂停取证首idle即85成对兜底，仍两张独立新树后默认恢复PLAY',()=>{
  const r=pausedIdle();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/video_opened=1/);
  assert.equal(r.state.dumps,4,'两个局部阶段各首次失败+一次新鲜兜底，不再各失败3次');
  assert.equal(r.state.toggles,4);assert.equal(r.state.play,'playing');
});
test('open-comments先本命令PAUSE取新详情，首idle兜底且面板另读新树',()=>{
  const r=pausedIdle({command:'open-comments'});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/comments_opened=1/);
  assert.equal(r.state.dumps,3);assert.equal(r.state.toggles,2);assert.equal(r.state.play,'paused');
});
test('首dump已有完整新树即使idle警告也不toggle，非idle错误保原三尝试',()=>{
  const fresh=pausedIdle({command:'wave',freshOnFirst:true});assert.equal(fresh.status,0,fresh.stderr);assert.equal(fresh.state.dumps,1);assert.equal(fresh.state.toggles,0);
  const nonidle=pausedIdle({command:'wave',error:'nonidle'});assert.equal(nonidle.status,0,nonidle.stderr);assert.equal(nonidle.state.dumps,3);assert.equal(nonidle.state.toggles,0);
});
for(const options of [{wrongFocus:true},{ambiguousFocus:true},{pauseFails:true},{focusChangesAfterPause:true},{policy:'typo'}])test('无可信本命令前台或PAUSE/非法策略在快速dump前拒绝 '+JSON.stringify(options),()=>{
  const r=pausedIdle({command:'wave',...options});assert.notEqual(r.status,0);assert.equal(r.state.dumps,0);assert.equal(r.state.toggles,0);
});
for(const options of [{wrongPackage:true},{partial:true},{toggleFails:1},{toggleFails:2}])test('错误新树或85失败绝不成功 '+JSON.stringify(options),()=>{
  const r=pausedIdle({command:'wave',...options});assert.notEqual(r.status,0);assert.equal(r.stdout,'');
  if(options.toggleFails===2)assert.equal(r.state.toggles,2,'dump后恢复85失败必须真实拒绝');
});
test('旧remote/local XML被清除，不能当本次新鲜取证',()=>{
  const r=pausedIdle({command:'wave',stale:true,toggleFails:1});assert.notEqual(r.status,0);assert.equal(r.stdout,'');assert.match(r.calls,/shell rm -f/);
});
test('open-comments返回错误面板不打印成功，即便首详情兜底已核',()=>{
  const r=pausedIdle({command:'open-comments',panelFails:true});assert.notEqual(r.status,0);assert.doesNotMatch(r.stdout,/comments_opened=1/);
});

test('兜底dump失败仍执行第二85恢复本次暂停，普通策略保原三次失败再兜底',()=>{
 const fail=pausedIdle({command:'wave',fallbackFails:true});assert.notEqual(fail.status,0);assert.equal(fail.stdout,'');assert.equal(fail.state.toggles,2);assert.equal(fail.state.play,'paused');
 const old=pausedIdle({command:'wave',policy:'standard'});assert.equal(old.status,0,old.stderr);assert.equal(old.state.dumps,4);assert.equal(old.state.toggles,2);assert.doesNotMatch(old.calls,/input keyevent 127/);
});

test('foreground gate关闭弹窗后下一round重新前台与PAUSE，不能沿用旧许可',()=>{
 const r=pausedIdle({gateDismiss:true});assert.equal(r.status,0,r.stderr);const calls=r.calls.trim().split('\n');const tap=calls.findIndex(s=>s.includes('input tap'));assert.ok(tap>=0);const nextDump=calls.findIndex((s,i)=>i>tap&&s.includes('uiautomator dump'));assert.ok(nextDump>tap);assert.ok(calls.slice(tap+1,nextDump).some(s=>s.includes('input keyevent 127')));assert.ok(calls.slice(tap+1,nextDump).filter(s=>s.includes('dumpsys')).length>=2);assert.equal(r.state.play,'playing');
});

for(const options of [{wrongFocus:true},{ambiguousFocus:true},{pauseFails:true},{toggleFails:1},{toggleFails:2},{wrongPackage:true},{partial:true}])test('真实open-comments安全前提失败不得视觉定位或点评论 '+JSON.stringify(options),()=>{
 const r=pausedIdle({command:'open-comments',visionFallback:true,...options});assert.notEqual(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/comments_opened=1/);assert.doesNotMatch(r.calls,/LOCATE|input tap/);
});
test('可信本次前台及PAUSE成立但无树，保原合法视觉定位并新核评论面板',()=>{
 const r=pausedIdle({command:'open-comments',visionFallback:true,fallbackFails:true});assert.equal(r.status,0,r.stderr);assert.match(r.calls,/LOCATE/);assert.match(r.stdout,/comments_opened=1/);assert.equal(r.state.play,'paused');
});
test('paused策略remote stat未知不得首idle提前兜底',()=>{
 const r=pausedIdle({command:'wave',unknownStat:true});assert.notEqual(r.status,0);assert.equal(r.state.dumps,4);assert.equal(r.state.toggles,2);assert.doesNotMatch(r.stderr,/paused-idle:/);
});

for(const options of [{wrongFocus:true},{ambiguousFocus:true},{pauseFails:true},{toggleFails:1},{toggleFails:2},{wrongPackage:true},{partial:true}])test('真实open-video硬错误不重试软归位也不输出已打开 '+JSON.stringify(options),()=>{
 const r=pausedIdle(options);assert.notEqual(r.status,0,r.stderr);assert.doesNotMatch(r.stdout,/video_opened=1/);assert.doesNotMatch(r.calls,/input tap|input keyevent 126/);
 if(options.wrongFocus||options.ambiguousFocus||options.pauseFails)assert.equal(r.state.dumps,0);
});

test('CLI夹具显式使用实际Python，外界错误DOUYIN_PYTHON_BIN不能使正例失败或负例假绿',()=>{
 const previous=process.env.DOUYIN_PYTHON_BIN;
 process.env.DOUYIN_PYTHON_BIN='/fixture-invalid-python-bin/python3';
 try {
  const good=pausedIdle({command:'open-comments'});assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/comments_opened=1/);
  const bad=pausedIdle({command:'open-comments',visionFallback:true,wrongPackage:true});assert.notEqual(bad.status,0);assert.doesNotMatch(bad.stdout,/comments_opened=1/);assert.doesNotMatch(bad.calls,/LOCATE|input tap/);
  assert.doesNotMatch(good.stderr+bad.stderr,/no such file|not found|fixture-invalid-python/);
 } finally {
  if(previous===undefined)delete process.env.DOUYIN_PYTHON_BIN;else process.env.DOUYIN_PYTHON_BIN=previous;
 }
});

// Android真实stat ENOENT语义：无文件退出1、stdout空，而非伪造大小0。
test('Android ENOENT加本次独立absence ACK使真实open-video首idle仅一次失败后成对兜底',()=>{
 const r=pausedIdle({androidStat:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/video_opened=1/);
 assert.equal(r.state.dumps,4,'两阶段各首次idle失败+新鲜兜底，不能仍各3失败');assert.equal(r.state.toggles,4);assert.equal(r.state.play,'playing');
 assert.match(r.calls,/REMOTE_UI_ABSENT_V1/);assert.match(r.stderr,/paused-idle:/);
 const statCall=r.calls.split('\n').find(l=>l.includes('stat -c %s'));const path=statCall.split(' ').at(-1);
 const absenceCalls=r.calls.split('\n').filter(l=>l.includes('REMOTE_UI_ABSENT_V1'));assert.ok(absenceCalls.every(l=>l.includes(`[ ! -e '${path}' ] && [ ! -L '${path}' ]`)));
});
test('stat非零即使stdout伪数字0也不能当成功大小0',()=>{
 const r=pausedIdle({command:'wave',androidStat:true,statError:'numeric_failure'});assert.equal(r.status,0,r.stderr);assert.equal(r.state.dumps,4);assert.doesNotMatch(r.stderr,/paused-idle:/);assert.doesNotMatch(r.calls,/REMOTE_UI_ABSENT_V1/);
});
for(const absence of ['permission','timeout','exists','dangling','empty','malformed','duplicate'])test('Android ENOENT但absence不可信保三次尝试 '+absence,()=>{
 const r=pausedIdle({command:'wave',androidStat:true,absence});assert.equal(r.status,0,r.stderr);
 assert.equal(r.state.dumps,4);assert.equal(r.state.toggles,2);assert.doesNotMatch(r.stderr,/paused-idle:/);
});
test('stat权限错误不能靠absence ACK提速，非idle和standard/share保持原策略',()=>{
 const permission=pausedIdle({command:'wave',androidStat:true,statError:'permission'});assert.equal(permission.state.dumps,4);assert.doesNotMatch(permission.calls,/REMOTE_UI_ABSENT_V1/);assert.doesNotMatch(permission.stderr,/paused-idle:/);
 const nonidle=pausedIdle({command:'wave',androidStat:true,error:'nonidle'});assert.equal(nonidle.status,0,nonidle.stderr);assert.equal(nonidle.state.dumps,3);assert.doesNotMatch(nonidle.calls,/REMOTE_UI_ABSENT_V1/);
 const standard=pausedIdle({command:'wave',policy:'standard',androidStat:true});assert.equal(standard.status,0,standard.stderr);assert.equal(standard.state.dumps,4);assert.doesNotMatch(standard.calls,/REMOTE_UI_ABSENT_V1/);
 const share=pausedIdle({command:'wave',policy:'verified-seed-share',androidStat:true});assert.equal(share.status,0,share.stderr);assert.equal(share.state.dumps,2);assert.doesNotMatch(share.calls,/REMOTE_UI_ABSENT_V1/);
});
