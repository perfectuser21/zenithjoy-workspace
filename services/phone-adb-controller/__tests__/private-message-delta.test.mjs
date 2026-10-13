import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const message='明示fake批准正文';
const node=(value,input=false)=>`<node text="${value}" resource-id="${input?'com.ss.android.ugc.aweme:id/msg_et':'fake_bubble'}" class="${input?'android.widget.EditText':'android.widget.TextView'}"/>`;
function check(before,after,phase){const dir=mkdtempSync(join(tmpdir(),'fake-dm-delta-'));try{
 const fn=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8').match(/^_verify_private_message_delta\(\) \{[\s\S]*?^\}/m)?.[0];
 assert.ok(fn,'必须核验发送前后新气泡，旧grep不足以判定本轮成功');
 writeFileSync(join(dir,'before.xml'),'<hierarchy>'+before+'</hierarchy>');writeFileSync(join(dir,'after.xml'),'<hierarchy>'+after+'</hierarchy>');
 return spawnSync('zsh',['-c',`PYTHON_BIN=python3\n${fn}\n_verify_private_message_delta "$1" "$2" "$3" "$4"`,'fake',join(dir,'before.xml'),join(dir,'after.xml'),message,phase],{encoding:'utf8',timeout:5000});
 }finally{rmSync(dir,{recursive:true,force:true});}}
test('输入框同文不是旧消息；旧历史气泡在Send前必须拒绝',()=>{
 assert.equal(check(node(message,true),'','before').status,0);
 assert.notEqual(check(node(message,true)+node(message),'','before').status,0);
});
test('发送成功须新非输入气泡且输入已清空；未清空与旧气泡假成功被拒绝',()=>{
 assert.equal(check(node(message,true),node('',true)+node(message),'after').stdout.trim(),'sent');
 assert.notEqual(check(node(message,true),node(message,true),'after').status,0);
 assert.notEqual(check(node(message,true)+node(message),node('',true)+node(message),'after').status,0);
});
test('新互关/限流提示如实归类，不声称送达',()=>{
 assert.equal(check(node(message,true),node('',true)+node('暂无法给对方发送消息'),'after').stdout.trim(),'restricted');
 assert.equal(check(node(message,true),node('',true)+node('给陌生人发送消息过于频繁'),'after').stdout.trim(),'rate_limited');
});
test('二次fresh风险XML能覆盖延迟互关提示，读不到不能把首帧气泡当最终发送',()=>{
 assert.equal(check(node(message,true),node('',true)+node(message),'risk').stdout.trim(),'sent');
 assert.equal(check(node(message,true),node('',true)+node(message)+node('暂无法给对方发送消息'),'risk').stdout.trim(),'restricted');
 assert.notEqual(check(node(message,true),'','risk').status,0);
});

// 104 实机仅证实 chat/typed 未入焦；这里实际模拟IME变更布局的可触发旧坐标缺陷。
function dmFocusFlow(mode='moved'){
 const d=mkdtempSync(join(tmpdir(),'dm-ime-layout-'));try{
  const source=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
  const fn=name=>{const f=source.match(new RegExp('^'+name+'\\(\\) \\{[\\s\\S]*?^\\}','m'))?.[0];assert.ok(f,name);return f;};
  const python=spawnSync('python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).stdout.trim();assert.ok(python.startsWith('/'));
  const state=join(d,'state.json');writeFileSync(state,JSON.stringify({ime:'original/.IME',layout:'old',focused:false,text:'',sent:false,mode}));
  const adb=join(d,'adb');writeFileSync(adb,`#!${python}
import sys,json,base64,pathlib
p=pathlib.Path(${JSON.stringify(state)});s=json.loads(p.read_text());a=sys.argv[1:];a=a[a.index('shell')+1:]
with open(${JSON.stringify(join(d,'calls'))},'a') as f:f.write(json.dumps(a)+'\\n')
if a[:4]==['settings','get','secure','default_input_method']:print(s['ime'])
elif a[:2]==['ime','enable']:print('Input method now enabled')
elif a[:2]==['ime','set']:
 s['ime']=a[2]
 if 'adbkeyboard' in a[2]:s['layout']='new';s['focused']=False
elif a[:2]==['input','tap']:
 x,y=map(int,a[2:4]);s['focused']=(s['layout']=='new' and 157<x<777 and 1600<y<1733 and s['mode']!='no_focus')
 if s['text'] and x==1100 and y==1666:s['sent']=True;s['text']=''
elif a[:2]==['am','broadcast']:
 if 'ADB_CLEAR_TEXT' in a and s['focused']:s['text']=''
 if 'ADB_INPUT_B64' in a and s['focused']:s['text']=base64.b64decode(a[-1]).decode()
p.write_text(json.dumps(s))
`,{mode:0o755});
  const dump=join(d,'dump.py');writeFileSync(dump,`import sys,json,pathlib,xml.sax.saxutils as X
s=json.loads(pathlib.Path(${JSON.stringify(state)}).read_text());eid=sys.argv[1];out=pathlib.Path(${JSON.stringify(d)})/(eid+'.xml');pkg='com.ss.android.ugc.aweme'
def n(text='',rid='',cls='android.widget.TextView',bounds='[0,0][100,100]',focused='false',desc='',click='false'):
 return '<node text="'+X.escape(text,{'"':'&quot;'})+'" resource-id="'+rid+'" package="'+pkg+'" class="'+cls+'" bounds="'+bounds+'" focused="'+focused+'" focusable="true" enabled="true" password="false" clickable="'+click+'" content-desc="'+desc+'" />'
if 'target-profile-link' in eid:xml=n('抖音号：target456','targetid')+n(desc='更多',bounds='[1000,100][1100,200]',click='true')
elif eid.endswith('dmpanel'):xml=n('发私信','panel',bounds='[100,100][300,300]')
else:
 pkg='com.ss.android.ugc.aweme.evil' if s['mode']=='wrong_package' and s['layout']=='new' else pkg
 bounds='[157,2501][777,2634]' if s['layout']=='old' else '[157,1600][777,1733]'
 input=n(s['text'] or '只能发送一条消息',pkg+':id/msg_et','android.widget.EditText',bounds,'true' if s['focused'] else 'false',click='true')
 if s['mode']=='duplicate' and s['layout']=='new':input+=input
 xml='<node package="'+pkg+'" class="android.view.View" resource-id="'+pkg+':id/l+=" enabled="true"><node package="'+pkg+'" class="android.widget.LinearLayout" resource-id="'+pkg+':id/d2_" enabled="true"><node package="'+pkg+'" class="androidx.recyclerview.widget.RecyclerView" resource-id="'+pkg+':id/v54" enabled="true">'+n('为保障用户沟通安全，未互相关注的陌生人违规消息可能会被处理，请遵守法律法规和社区规范',pkg+':id/sv_')+(n(${JSON.stringify(message)},'bubble') if s['sent'] else '')+'</node>'+input+'</node></node>'
 if s['text']:xml+=n(desc='发送',bounds='[1000,1600][1200,1733]',click='true')
 if s['mode']=='changed_chat' and s['layout']=='new':xml=xml.replace('为保障用户沟通安全','不同会话')
out.write_text('<hierarchy>'+xml+'</hierarchy>')
`);
  // 使用平台真实base64解码器；仅替换该flag，其他生产函数字节不改。
  let send=fn('send_private_message');let flag='';for(const f of ['-D','-d','--decode']){const p=spawnSync('/usr/bin/base64',[f],{input:Buffer.from(message).toString('base64'),encoding:'utf8'});if(p.status===0&&p.stdout===message){flag=f;break;}}assert.ok(flag);
  const old=send;send=send.replace('/usr/bin/base64 -D','/usr/bin/base64 '+flag);assert.equal(send.replace('/usr/bin/base64 '+flag,'/usr/bin/base64 -D'),old);
  const script=`set -eu; setopt EXTENDED_GLOB\nADB=${JSON.stringify(adb)}; SERIAL=fake; MAX_X=1200; MAX_Y=2664; DOUYIN_PACKAGE=com.ss.android.ugc.aweme; EVIDENCE_ROOT=${JSON.stringify(d)}; PYTHON_BIN=${JSON.stringify(python)}; TEXT_INPUT_FOCUS_HELPER=${JSON.stringify(new URL('../text-input-focus.py',import.meta.url).pathname)}\n`+
   ['require_uint','require_evidence_id','require_account_id','node_center','_foreground_is_exact_douyin','_verify_private_message_delta'].map(fn).join('\n')+'\n'+send+`\ndie(){ print -u2 -- "$1"; exit 2; }; wait_ms(){ :; }; ensure_feed(){ :; }; read_current_account(){ print douyin_id=sender123; }; foreground_package(){ print 'mCurrentFocus=Window{1 u0 com.ss.android.ugc.aweme/.im.ChatRoomActivity}'; }; ui_evidence(){ "$PYTHON_BIN" ${JSON.stringify(dump)} "$1"; }; _ui_evidence_wave(){ ui_evidence "$1"; }; snapshot_evidence(){ print ${JSON.stringify(join(d,'fake.png'))}; }; print_jpg_line(){ :; }; send_private_message sender123 target456 ${JSON.stringify(Buffer.from(message).toString('base64'))} focus-case https://v.douyin.com/fake/`;
  const r=spawnSync('zsh',['-c',script],{encoding:'utf8',timeout:10000});
  return {...r,calls:readFileSync(join(d,'calls'),'utf8').trim().split('\n').map(JSON.parse),state:JSON.parse(readFileSync(state))};
 }finally{rmSync(d,{recursive:true,force:true});}
}
test('真实私信函数IME布局变化后用fresh坐标入焦再输入，保持正文与增量核验',()=>{
 const r=dmFocusFlow();assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/send_status=sent/);assert.ok(r.calls.some(a=>a.join(' ')==='input tap 467 1666'));assert.ok(r.state.sent);
});
for(const mode of ['no_focus','wrong_package','duplicate','changed_chat'])test('IME后不可信输入必须在清空/输入/发送前拒绝 '+mode,()=>{
 const r=dmFocusFlow(mode);assert.notEqual(r.status,0);assert.ok(!r.calls.some(a=>a.includes('ADB_INPUT_B64')));assert.ok(!r.calls.some(a=>a.includes('ADB_CLEAR_TEXT')));assert.equal(r.state.sent,false);
});
