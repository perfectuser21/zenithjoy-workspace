import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const helper=new URL('../text-input-focus.py',import.meta.url).pathname;
// 真机当前客户端字段，保留混淆 resource-id 与重复的正文/标题输入框。
const ime=`  mServedView=com.xingin.capa.post.ui.UnderLineRichEdit{abc VFED..CL. 79,0-1121,120 #7f090fa2 app:id/0_resource_name_obfuscated aid=1073741825}
  mServedConnecting=false
  mCurrentEditorInfo:
    inputType=0x20001 imeOptions=0x48000005 privateImeOptions=null
    hintText=输入标题 label=null
    packageName=com.xingin.xhs autofillId=1073741825 fieldId=2131300258 fieldName=null
  mServedInputConnection=RemoteInputConnectionImpl{connection=com.xingin.redview.richtext.RichEditTextPro$h@abc mDeactivateRequested=false mServedView=com.xingin.capa.post.ui.UnderLineRichEdit{abc}}
  mServedInputConnectionHandler=null
`;
const body='<node class="android.widget.EditText" package="com.xingin.xhs" resource-id="com.xingin.xhs:id/0_resource_name_obfuscated" text="正文占位" focused="false" bounds="[79,265][1121,2354]"/>';
const title='<node class="android.widget.EditText" package="com.xingin.xhs" resource-id="com.xingin.xhs:id/0_resource_name_obfuscated" text="输入标题" focused="false" bounds="[79,265][1121,385]"/>';
function setup(raw=ime,xml='<hierarchy>'+body+title+'</hierarchy>'){
  const dir=mkdtempSync(join(tmpdir(),'native-focus-'));
  const ip=join(dir,'ime.txt'),xp=join(dir,'ui.xml'),selection=join(dir,'selection.json');
  writeFileSync(ip,raw);writeFileSync(xp,xml);
  return {ip,xp,selection};
}
const run=(...args)=>spawnSync('python3',[helper,...args],{encoding:'utf8'});

test('切换输入法后同App同字段但servedView实例变化，必须拒绝发送',()=>{
  const c=setup();const selected=run('resolve',c.xp,c.ip);
  assert.equal(selected.status,0,selected.stderr);writeFileSync(c.selection,selected.stdout);
  writeFileSync(c.ip,ime.replaceAll('UnderLineRichEdit{abc','UnderLineRichEdit{def'));
  const checked=run('check',c.selection,c.ip);
  assert.equal(checked.status,2,'新编辑器实例不能继承旧输入授权');
});

for(const [name,raw,xml] of [
  ['当前连接失活',ime.replace('mDeactivateRequested=false','mDeactivateRequested=true'),undefined],
  ['当前连接尚未建立',ime.replace('mServedConnecting=false','mServedConnecting=true'),undefined],
  ['只历史信息匹配，当前servedView已换其它输入',ime+'  mServedView=android.widget.EditText{def}\n',undefined],
  ['两个标题候选',ime,'<hierarchy>'+title+title+'</hierarchy>'],
  ['无障碍存在冲突焦点',ime,'<hierarchy>'+body.replace('focused="false"','focused="true"')+title+'</hierarchy>'],
  ['密码类型不能沿用文本许可',ime.replace('inputType=0x20001','inputType=0x81'),undefined],
])test('真实输入连接选择拒绝：'+name,()=>{
  const c=setup(raw,xml);const result=run('resolve',c.xp,c.ip);
  assert.equal(result.status,2,result.stdout);
});
