import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const fn=name=>controller.match(new RegExp(name+'\\(\\) \\{[\\s\\S]*?\\n\\}'))?.[0] || '';
function run(flags={}) {
 const dir=mkdtempSync(join(tmpdir(),'nonce-sdk31-')),adb=join(dir,'adb');
 writeFileSync(join(dir,'state.json'),JSON.stringify({field:'',clip:'https://v.douyin.com/Old/',ime:'google/.LatinIME',menu:false,selected:false,events:[]}));
 writeFileSync(adb,`#!/usr/bin/python3
import os,sys,json,base64,xml.etree.ElementTree as E
from pathlib import Path
p=Path(os.environ['D'])/'state.json';s=json.loads(p.read_text());args=sys.argv[1:];f=json.loads(os.environ['FLAGS'])
if args[:2]==['-s','FAKE']:args=args[2:]
s['events'].append(' '.join(args))
if args[:1]==['test-ui']:
 r=E.Element('hierarchy');v=s['field'];hint='AI搜索建议' if not v else ''
 E.SubElement(r,'node',{'text':v or hint,'resource-id':'com.ss.android.ugc.aweme:id/et_search_kw','package':'com.ss.android.ugc.aweme','class':'android.widget.EditText','focused':'true','enabled':'true','clickable':'true','password':'false','bounds':'[70,40][721,90]' if f.get('outOfBoundsX') else '[70,40][557,1281]' if f.get('outOfBoundsY') else '[70,40][557,90]' if v else '[70,40][551,90]'})
 E.ElementTree(r).write(args[1],encoding='unicode')
elif args==['shell','settings','get','secure','default_input_method']:print(s['ime'])
elif args[:3]==['shell','ime','enable']:print('Input method already enabled')
elif args[:3]==['shell','ime','set']:
 if not (f.get('restoreFail') and args[3]=='google/.LatinIME'):s['ime']=args[3]
elif args[:4]==['shell','am','broadcast','-a']:
 if args[4]=='ADB_CLEAR_TEXT' and not f.get('inputFail'):s['field']=''
 if args[4]=='ADB_INPUT_B64' and not f.get('inputFail'):s['field']=base64.b64decode(args[-1]).decode()
elif args[:3]==['shell','input','keycombination']:
 s['field']+='a' # Android12真实语义：命令成功，却没有Ctrl+A。
elif args[:3]==['shell','input','text']:s['field']='谷歌输入法转换后的中文'
elif args[:3]==['shell','input','swipe']:s['selected']=not f.get('longpressNoSelection')
elif args[:3]==['shell','input','keyevent']:
 for k in args[3:]:
  if k=='278':
   if s['selected'] and not f.get('copyFail'):
    s['original']=s['field']
    s['clip']=s['field'][10:] if f.get('prefixResidual') else s['field'][:-1] if f.get('partialCopy') else s['field']
   s['selected']=False
  elif k=='123':s['selected']=False
  elif k=='67' and not f.get('clearFail'):
   s['field']=s['original'][:10] if f.get('prefixResidual') else '残留的其他文本' if f.get('otherResidual') else s['field'][:-1]
  elif k=='279':s['field']+='https://v.douyin.com/Old/' if f.get('pasteOld') else s['clip']
p.write_text(json.dumps(s))
`,{mode:0o755});
 const helpers=['nonce_sdk31_field','nonce_sdk31_input','nonce_sdk31_copy','current_ime','ti_restore_ime','seed_clipboard_nonce'].map(fn).join('\n');
 const script=`set -eu;setopt EXTENDED_GLOB
die(){ print -u2 -- "$1";exit 2; }
wait_ms(){ :; }
require_held_lock(){ [[ -n "$LOCK_OWNER" ]] || die CLIPBOARD_NONCE_LOCK_OWNER_REQUIRED; }
require_target_for(){ :; }
foreground_package(){ [[ $WRONG_FOREGROUND != 1 ]] && print 'mCurrentFocus=Window{com.ss.android.ugc.aweme/.Search}' || print 'mCurrentFocus=Window{com.android.launcher/.Main}'; }
node_center(){ print '100 65'; }
ui_evidence(){ "$ADB" test-ui "$EVIDENCE_ROOT/$1.xml"; }
_leave_scratch_route(){ [[ "$LEAVE_FAIL" != 1 ]]; }
${helpers}
proof="$(seed_clipboard_nonce fixture)" || exit 2
[[ "$proof" == clipnonce* ]] || exit 3
print OK`;
 const r=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,D:dir,FLAGS:JSON.stringify(flags),DEVICE_SDK:'31',LOCK_OWNER:flags.noOwner?'':'nonce-test',ADB:adb,SERIAL:'FAKE',PYTHON_BIN:'/usr/bin/python3',ADBKEYBOARD_IME:'com.android.adbkeyboard/.AdbIME',EVIDENCE_ROOT:dir,LEAVE_FAIL:flags.leaveFail?'1':'0',SCREEN_W:'720',SCREEN_H:'1280',DOUYIN_PACKAGE:'com.ss.android.ugc.aweme',WRONG_FOREGROUND:flags.wrongForeground?'1':'0'}});
 return {...r,state:JSON.parse(readFileSync(join(dir,'state.json'),'utf8')),dir};
}

test('SDK31精确输入、原生复制、清空再粘贴；IME还原，字段bounds可因文字微变',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/OK/);
 assert.equal(r.state.ime,'google/.LatinIME');
 assert.equal(r.state.field,r.state.clip);assert.match(r.state.field,/^clipnonce[a-f0-9]{32}$/);
 assert.ok(r.state.events.some(x=>x.includes('ADB_INPUT_B64')));
 assert.ok(!r.state.events.some(x=>x.includes('keycombination')||x.includes('input text')));
 const xmls=['typed','empty','pasted'].map(x=>readFileSync(join(r.dir,`fixture-seed-${x}.xml`),'utf8'));
 assert.match(xmls[0],/clipnonce/);assert.doesNotMatch(xmls[1],/clipnonce/);assert.match(xmls[2],/clipnonce/);
 assert.match(readFileSync(join(r.dir,'fixture-seed-empty-proof.txt'),'utf8'),/verified_by_exact_nonce_append/);
});
for(const [name,flags] of Object.entries({缺owner:{noOwner:true},字段横向越界:{outOfBoundsX:true},字段纵向越界:{outOfBoundsY:true},复制前台切换:{wrongForeground:true},长按未选中:{longpressNoSelection:true},部分复制:{partialCopy:true},复制未生效:{copyFail:true},粘贴旧值:{pasteOld:true},清空失败:{clearFail:true},其他残留文本:{otherResidual:true},前缀残留与后缀复制组合:{prefixResidual:true},输入失败:{inputFail:true},还原输入法失败:{restoreFail:true},回原详情失败:{leaveFail:true}})) {
 test('SDK31'+name+'必须拒绝',()=>{
  const r=run(flags);assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,/CLIPBOARD_NONCE/);assert.doesNotMatch(r.stdout,/OK/);
  if(flags.noOwner)assert.equal(r.state.events.length,0,'缺owner不得开始设备动作');
  const reason=flags.noOwner?'LOCK_OWNER_REQUIRED':flags.outOfBoundsX||flags.outOfBoundsY?'FOCUS_UNVERIFIED':flags.wrongForeground?'WRONG_FOREGROUND':flags.restoreFail?'IME_RESTORE_FAILED':(flags.clearFail||flags.prefixResidual)?'CLEAR_UNVERIFIED':flags.inputFail?'READBACK_MISMATCH:input':flags.leaveFail?'ORIGINAL_DETAIL_UNVERIFIED':'READBACK_MISMATCH:pasted';
  assert.ok(r.stderr.includes('CLIPBOARD_NONCE_'+reason),r.stderr);
  if(!flags.restoreFail)assert.equal(r.state.ime,'google/.LatinIME');
 });
}

for(const condition of ['no-owner','other','expired','free']) test(`SDK31真实CLI取链拒绝${condition}锁且零ADB动作`,()=>{
 const dir=mkdtempSync(join(tmpdir(),'nonce-sdk31-lock-')),adb=join(dir,'adb'),reg=join(dir,'registry.tsv'),lock=join(dir,'tmp','locks','FAKE.lock');
 writeFileSync(reg,'#schema=v2\nprofile\tserial\tmodel\twidth\theight\tdensity\tsdk\ncloud\tFAKE\tMODEL\t720\t1280\t240\t31\n');
 writeFileSync(adb,'#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_DIR/adb.log"\nexit 1\n',{mode:0o755});
 const owner='qiumi-a1234567-1791427263848';
 if(condition==='other'||condition==='expired'){
  mkdirSync(lock,{recursive:true});writeFileSync(join(lock,'owner'),condition==='other'?'qiumi-b1234567-1791427263848':owner);
  writeFileSync(join(lock,'acquired_at'),String(Math.floor(Date.now()/1000)-(condition==='expired'?1900:0)));
 }
 const args=condition==='no-owner'?[]:['--lock-owner',owner];
 const r=spawnSync('zsh',[new URL('../douyin-phone-adb',import.meta.url).pathname,'--profile','cloud',...args,'current-video-link','nonce-lock'],{encoding:'utf8',timeout:15000,env:{...process.env,TEST_DIR:dir,DOUYIN_ADB_BIN:adb,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_PHONE_TMP_ROOT:join(dir,'tmp'),DOUYIN_PYTHON_BIN:'/usr/bin/python3'}});
 assert.notEqual(r.status,0);assert.match(r.stderr,condition==='no-owner'?/CLIPBOARD_NONCE_LOCK_OWNER_REQUIRED/:/required lock owner|lock lease budget/);
 assert.ok(!existsSync(join(dir,'adb.log')),'拒绝锁必须发生在所有ADB动作之前');
});
