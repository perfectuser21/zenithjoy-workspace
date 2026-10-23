import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const widgetFixture=new URL('./fixtures/honor-douyin-search-widget-0353.xml',import.meta.url).pathname;
const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const fn=name=>controller.match(new RegExp(name+'\\(\\) \\{[\\s\\S]*?\\n\\}'))?.[0]||'';
function run(flags={}) {
 const dir=mkdtempSync(join(tmpdir(),'nonce-context-')),adb=join(dir,'adb');
 writeFileSync(join(dir,'state.json'),JSON.stringify({field:'',clip:'https://v.douyin.com/Old/',selected:false,typed:false,escaped:false,events:[]}));
 writeFileSync(adb,`#!/usr/bin/python3
import os,sys,json,xml.etree.ElementTree as E
from pathlib import Path
p=Path(os.environ['D'])/'state.json';s=json.loads(p.read_text());a=sys.argv[1:];f=json.loads(os.environ['FLAGS'])
if a[:1]==['-s']:a=a[2:]
s['events'].append(' '.join(a))
if a[:1]==['test-ui']:
 r=E.Element('hierarchy')
 if s['escaped'] and f.get('widget'):
  raw=Path(os.environ['WIDGET_FIXTURE']).read_text().replace('抖音搜索',f.get('widgetName','抖音搜索')).replace('com.hihonor.android.launcher',f.get('widgetPackage','com.hihonor.android.launcher'))
  Path(a[1]).write_text(raw)
 elif s['escaped']:
  E.SubElement(r,'node',{'text':'添加到主屏幕','package':'com.hihonor.android.launcher','class':'android.widget.TextView'})
 else:
  attrs={'text':s['field'],'resource-id':'com.ss.android.ugc.aweme:id/et_search_kw','package':'com.ss.android.ugc.aweme','class':'android.widget.EditText','focused':'true','enabled':'true','clickable':'true','password':'false','bounds':'[70,40][557,90]'}
  if s['typed'] and f.get('fieldAttrs'):attrs.update(f['fieldAttrs'])
  E.SubElement(r,'node',attrs)
 if not (s['escaped'] and f.get('widget')):E.ElementTree(r).write(a[1],encoding='unicode')
 if a[1].endswith('-seed-typed.xml'):s['typed']=True
elif a[:1]==['test-foreground']:print(f.get('widgetForeground','com.hihonor.android.launcher/com.hihonor.android.launcher.dragndrop.AddItemActivity') if s['escaped'] and f.get('widget') else 'com.hihonor.android.launcher/.Main' if s['escaped'] else 'com.ss.android.ugc.aweme/.Search')
elif a[:3]==['shell','input','tap'] and s['escaped'] and f.get('widget'):
 if a[3:]==['349','2474']:
  s['dismissals']=s.get('dismissals',0)+1
  if not f.get('cancelFail'):s['escaped']=False;s['field']=''
elif a[:3]==['shell','input','text']:s['field']=a[3]
elif a[:3]==['shell','input','keycombination']:
 s['selected']=not f.get('noSelection')
 if s['typed'] and f.get('escape')=='select':s['escaped']=True
elif a[:3]==['shell','input','swipe']:
 s['selected']=not f.get('noSelection')
 if f.get('escape')=='select':s['escaped']=True
elif a[:3]==['shell','input','keyevent']:
 k=a[3]
 if k=='278':
  if s['selected'] and not f.get('copyFail'):s['clip']=s['field'][:-1] if f.get('partialCopy') else s['field']
  s['selected']=False
  if f.get('escape')=='copy':s['escaped']=True
 elif k=='123':s['selected']=False
 elif k=='67' and not f.get('clearFail'):
  s['field']='' if s['selected'] else s['field'][:-1]
  if f.get('widget') and not s['field'] and (not s.get('injected') or f.get('repeatWidget')):s['escaped']=True;s['injected']=True
 elif k=='279':s['field']+=s['clip']
p.write_text(json.dumps(s))
`,{mode:0o755});
 const script=`set -eu;setopt EXTENDED_GLOB
die(){ print -u2 -- "$1";exit 2; }
wait_ms(){ :; }
require_held_lock(){ [[ -n "$LOCK_OWNER" && "$LOCK_OWNER" != wrong ]] || die CLIPBOARD_NONCE_LOCK_OWNER_REQUIRED; }
require_target_for(){ :; }
foreground_package(){ "$ADB" test-foreground; }
node_center(){ print '200 65'; }
ui_evidence(){ "$ADB" test-ui "$EVIDENCE_ROOT/$1.xml"; }
_leave_scratch_route(){ [[ "$LEAVE_FAIL" != 1 ]]; }
${['nonce_sdk31_field','nonce_native_copy','nonce_sdk31_copy','cancel_nonce_widget','seed_clipboard_nonce_once','seed_clipboard_nonce'].map(fn).join('\n')}
seed_clipboard_nonce fixture`;
 const r=spawnSync('zsh',['-c',script],{encoding:'utf8',timeout:15000,env:{...process.env,D:dir,WIDGET_FIXTURE:widgetFixture,PHONE_CONTROLLER_DIR:new URL('../',import.meta.url).pathname,FLAGS:JSON.stringify(flags),ADB:adb,SERIAL:'FAKE',PYTHON_BIN:'/usr/bin/python3',EVIDENCE_ROOT:dir,DEVICE_SDK:'33',SCREEN_W:flags.widget?'1200':'720',SCREEN_H:flags.widget?'2664':'1280',DOUYIN_PACKAGE:'com.ss.android.ugc.aweme',LOCK_OWNER:flags.noOwner?'':flags.wrongOwner?'wrong':'fixture-only',LEAVE_FAIL:flags.leaveFail?'1':'0'}});
 return {...r,state:JSON.parse(readFileSync(join(dir,'state.json'),'utf8'))};
}
test('成功路径保持完整nonce证明，typed之后不再发送组合键',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/^clipnonce[a-f0-9]{32}\n$/);
 const after=r.state.events.slice(r.state.events.findIndex(x=>x.endsWith('-seed-typed.xml'))+1);
 assert.ok(!after.some(x=>x.includes('keycombination')),JSON.stringify(after));
 assert.equal(r.state.field,r.state.clip);
});
for(const phase of ['select','copy'])test(phase+'后进入系统小组件框必须停止后续输入',()=>{
 const r=run({escape:phase});assert.notEqual(r.status,0);assert.match(r.stderr,/CLIPBOARD_NONCE/);
 const typed=r.state.events.findIndex(e=>e.endsWith('-seed-typed.xml'));
 const marker=phase==='select'?r.state.events.findIndex((x,i)=>i>typed&&(x.includes('input swipe')||x.includes('keycombination'))):r.state.events.findIndex(x=>x.endsWith('keyevent 278'));
 assert.ok(marker>=0,JSON.stringify(r.state.events));
 const after=r.state.events.slice(marker+1);
 assert.ok(!after.some(x=>/input (?:keyevent|keycombination|text|tap|swipe)/.test(x)),JSON.stringify(after));
});
for(const [name,flags] of Object.entries({部分复制:{partialCopy:true},未选中:{noSelection:true},复制失败:{copyFail:true},清空失败:{clearFail:true},回原详情失败:{leaveFail:true}}))test(name+'不能交出成功nonce',()=>{
 const r=run(flags);assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,/CLIPBOARD_NONCE/);
});

test('非SDK31旧无owner入口保留原合同且仍完成完整nonce后验',()=>{
 const r=run({noOwner:true});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/^clipnonce[a-f0-9]{32}\n$/);
 assert.equal(r.state.field,r.state.clip);
});
test('显式错误owner仍拒绝原生复制动作',()=>{
 const r=run({wrongOwner:true});assert.notEqual(r.status,0);assert.match(r.stderr,/CLIPBOARD_NONCE_LOCK_OWNER_REQUIRED/);
 assert.ok(!r.state.events.some(x=>x.includes('input swipe')||x.endsWith('keyevent 278')));
});

// 本次0353真实8节点原XML；仅ADB动作被替身记录，生产nonce函数实际执行。
test('真实HONOR抖音搜索小组件在empty抢前台时，只取消一次并从新nonce完整重新证明',()=>{
 const r=run({widget:true});assert.equal(r.status,0,r.stderr);assert.equal(r.state.dismissals,1);assert.equal(r.state.field,r.state.clip);
 const values=r.state.events.filter(e=>e.startsWith('shell input text ')).map(e=>e.split(' ').at(-1));assert.equal(values.length,2);assert.notEqual(values[0],values[1]);assert.ok(r.state.events.some(e=>e.endsWith('-seed-pasted.xml')));
});
for(const [name,flags]of Object.entries({其它launcher:{widgetPackage:'com.other.launcher'},非抖音widget:{widgetName:'天气'},错误Activity:{widgetForeground:'com.hihonor.android.launcher/.Main'},取消未生效:{cancelFail:true},第二次浮层:{repeatWidget:true},无owner:{noOwner:true}}))test('widget精确守卫拒绝 '+name,()=>{const r=run({widget:true,...flags});assert.notEqual(r.status,0);assert.ok((r.state.dismissals||0)<=1);});
