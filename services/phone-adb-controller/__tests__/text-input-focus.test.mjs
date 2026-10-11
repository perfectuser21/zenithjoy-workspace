import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
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

const standard='<node class="android.widget.EditText" package="com.zhihu.android" resource-id="com.zhihu.android:id/editArticleTitle" text="标题" focused="true" enabled="true" focusable="true" password="false" bounds="[48,278][1032,422]"/>';
const container='<node class="android.webkit.WebView" focused="true"/>';
for(const [name,node] of [
  ['多个编辑框',standard+standard],
  ['密码',standard.replace('password="false"','password="true"')],
  ['禁用',standard.replace('enabled="true"','enabled="false"')],
  ['不可聚焦',standard.replace('focusable="true"','focusable="false"')],
  ['只读',standard.replace('enabled="true"','editable="false" enabled="true"')],
])test('标准输入拒绝：'+name,()=>{
  const c=setup(ime,'<hierarchy>'+container+node+'</hierarchy>');
  const r=run('standard-resolve',c.xp);assert.equal(r.status,2,r.stdout);
});
for(const [key,value] of [['package','com.other.app'],['resource-id','other'],['bounds','[1,2][3,4]'],['class','android.webkit.WebView']])test('标准输入绑定拒绝变化：'+key,()=>{
  const c=setup(ime,'<hierarchy>'+container+standard+'</hierarchy>');
  const r=run('standard-resolve',c.xp);assert.equal(r.status,0,r.stderr);writeFileSync(c.selection,r.stdout);
  writeFileSync(c.xp,'<hierarchy>'+container+standard.replace(new RegExp(key+'="[^"]*"'),key+'="'+value+'"')+'</hierarchy>');
  assert.notEqual(run('standard-check',c.selection,c.xp).status,0);
  assert.notEqual(run('standard-readback',c.selection,c.xp).status,0);
});
test('标准输入回读拒绝同身份重复节点',()=>{
  const c=setup(ime,'<hierarchy>'+container+standard+'</hierarchy>');
  const r=run('standard-resolve',c.xp);writeFileSync(c.selection,r.stdout);
  writeFileSync(c.xp,'<hierarchy>'+standard+standard.replace('focused="true"','focused="false"')+'</hierarchy>');
  assert.equal(run('standard-readback',c.selection,c.xp).status,2);
});

const zhBody = phase => new URL('./fixtures/zhihu-body-'+phase+'.xml',import.meta.url).pathname;
test('真实知乎正文增长bounds仍绑定同root唯一空id字段',()=>{
 const c=setup();const selected=run('standard-resolve',zhBody('before'));
 assert.equal(selected.status,0,selected.stderr);writeFileSync(c.selection,selected.stdout);
 assert.equal(run('standard-check',c.selection,zhBody('ready')).status,0);
 const typed=run('standard-readback',c.selection,zhBody('typed'));
 assert.equal(typed.status,0,typed.stderr);assert.match(typed.stdout,/愿今晚的灯光温柔一点/);
});

const bodySource=JSON.parse(readFileSync(new URL('./fixtures/zhihu-body-content-variants.json',import.meta.url),'utf8')).article.split('\n\n').slice(1).join('\n\n');
const typedBody=readFileSync(zhBody('typed'),'utf8');
function bodySelection(){const c=setup();const r=run('standard-resolve',zhBody('before'));assert.equal(r.status,0,r.stderr);writeFileSync(c.selection,r.stdout);return c;}
test('知乎正文仅允许原素材双换行折单换行并保留实际读回',()=>{
 const c=bodySelection();const r=run('standard-compare',c.selection,zhBody('typed'),bodySource);
 assert.equal(r.status,0,r.stderr);const report=JSON.parse(r.stdout);assert.equal(report.comparison_mode,'zhihu_article_paragraphs');assert.equal(report.source.bytes,1150);assert.equal(report.actual.bytes,1145);assert.equal(report.paragraphs,6);assert.equal(report.source.sha256,'7f165422d5f889cf64c2b3bf596614e88ce75c14e392f81e403f2131e7820fcb');assert.equal(report.actual.sha256,'07f26ffe1b35d1aa938c45731685e4bdd76b18d758297e2cf574a689a0f6b541');
 const actual=run('standard-readback',c.selection,zhBody('typed'));assert.equal(actual.stdout,bodySource.replaceAll('\n\n','\n'));
});
for(const [name,change] of [
 ['原生写文章标识',x=>x.replace('text="写文章"','text="写想法"')],
 ['命名WebView',x=>x.replace('text="Zhihu Editor"','text="Other Editor"')],
 ['root',x=>x.replace('resource-id="root"','resource-id="otherRoot"')],
 ['package',x=>x.replaceAll('com.zhihu.android','com.other.app')],
 ['同root第二个编辑框',x=>x.replace('</hierarchy>','<node class="android.widget.EditText" focused="true"/></hierarchy>')],
 ['password',x=>x.replace(/<node[^>]*class="android.widget.EditText"[^>]*focused="true"[^>]*>/,n=>n.replace('password="false"','password="true"'))],
 ['disabled',x=>x.replace(/<node[^>]*class="android.widget.EditText"[^>]*focused="true"[^>]*>/,n=>n.replace('enabled="true"','enabled="false"'))],
 ['noneditable',x=>x.replace(/<node[^>]*class="android.widget.EditText"[^>]*focused="true"[^>]*>/,n=>n.replace('enabled="true"','enabled="true" editable="false"'))],
 ['命名容器class',x=>x.replace(/<node[^>]*text="Zhihu Editor"[^>]*>/,n=>n.replace('class="android.webkit.WebView"','class="android.view.View"'))],
 ['同root非focused第二字段',x=>x.replace(/(<node[^>]*class="android.widget.EditText"[^>]*focused="true"[^>]*\/>)/,'$1<node class="android.widget.EditText" focused="false"/>')],
 ['root重复',x=>x.replace('</hierarchy>','<node resource-id="root"/></hierarchy>')],
 ['实字改变',x=>x.replace('傍晚最舒服的时刻','傍晚最忙碌的时刻')],
 ['实字空格改变',x=>x.replace('傍晚最舒服的时刻','傍晚 最舒服的时刻')],
])test('知乎正文精确回读拒绝：'+name,()=>{
 const c=bodySelection();writeFileSync(c.xp,change(typedBody));assert.notEqual(run('standard-compare',c.selection,c.xp,bodySource).status,0);
});
test('知乎正文段序变化不允许换行兼容掩盖',()=>{
 const c=bodySelection();const parts=bodySource.split('\n\n');[parts[0],parts[1]]=[parts[1],parts[0]];
 assert.equal(run('standard-compare',c.selection,zhBody('typed'),parts.join('\n\n')).status,2);
});
test('知乎正文ready广播前bounds改变仍拒绝',()=>{
 const c=bodySelection();assert.equal(run('standard-check',c.selection,zhBody('typed')).status,2);
});
test('通用空id正文仍严格bounds与换行，不继承知乎许可',()=>{
 const c=setup(ime,'<hierarchy>'+standard.replace('resource-id="com.zhihu.android:id/editArticleTitle"','resource-id=""').replace('text="标题"','text="一&#10;二"')+'</hierarchy>');
 const r=run('standard-resolve',c.xp);writeFileSync(c.selection,r.stdout);assert.equal(JSON.parse(r.stdout).body_structure,undefined);
 assert.equal(run('standard-compare',c.selection,c.xp,'一\n\n二').status,2);
 writeFileSync(c.xp,readFileSync(c.xp,'utf8').replace('[48,278][1032,422]','[0,0][2,2]'));assert.equal(run('standard-readback',c.selection,c.xp).status,2);
});

const ttXML=new URL('./fixtures/toutiao-search-before.xml',import.meta.url).pathname;
const ttIME=new URL('./fixtures/toutiao-search-ime-before.txt',import.meta.url).pathname;
test('真实头条唯一focused cx及SearchAutoComplete当前连接前置可识别',()=>{
 const r=run('toutiao-resolve',ttXML,ttIME);assert.equal(r.status,0,r.stderr);
 const identity=JSON.parse(r.stdout);assert.equal(identity.kind,'toutiao_search');assert.equal(identity.resource_id,'com.ss.android.article.news:id/cx');assert.equal(identity.editor.field_id,'2131624075');
});

const ttBefore=readFileSync(ttXML,'utf8'),ttBeforeIME=readFileSync(ttIME,'utf8');
const ttNodeChange=(x,change)=>x.replace(/<node[^>]*resource-id="com.ss.android.article.news:id\/cx"[^>]*>/,change);
function ttSelection(){const c=setup();const r=run('toutiao-resolve',ttXML,ttIME);assert.equal(r.status,0,r.stderr);writeFileSync(c.selection,r.stdout);return c;}
for(const [name,xml,imeRaw] of [
 ['wrongpkg',ttNodeChange(ttBefore,n=>n.replace('package="com.ss.android.article.news"','package="com.other.app"')),ttBeforeIME],
 ['wrongid',ttBefore.replaceAll('com.ss.android.article.news:id/cx','com.ss.android.article.news:id/other'),ttBeforeIME],
 ['class非空',ttNodeChange(ttBefore,n=>n.replace('class=""','class="android.widget.RelativeLayout"')),ttBeforeIME],
 ['password',ttNodeChange(ttBefore,n=>n.replace('password="false"','password="true"')),ttBeforeIME],
 ['disabled',ttNodeChange(ttBefore,n=>n.replace('enabled="true"','enabled="false"')),ttBeforeIME],
 ['readonly',ttNodeChange(ttBefore,n=>n.replace('enabled="true"','enabled="true" editable="false"')),ttBeforeIME],
 ['多focus',ttBefore.replace('</hierarchy>','<node focused="true"/></hierarchy>'),ttBeforeIME],
 ['重复id',ttBefore.replace('</hierarchy>','<node resource-id="com.ss.android.article.news:id/cx"/></hierarchy>'),ttBeforeIME],
 ['无focus',ttNodeChange(ttBefore,n=>n.replace('focused="true"','focused="false"')),ttBeforeIME],
 ['native包变化',ttBefore,ttBeforeIME.replaceAll('packageName=com.ss.android.article.news','packageName=com.other.app')],
 ['IME失活',ttBefore,ttBeforeIME.replaceAll('mDeactivateRequested=false','mDeactivateRequested=true')],
 ['IME连接中',ttBefore,ttBeforeIME.replaceAll('mServedConnecting=false','mServedConnecting=true')],
 ['field变化',ttBefore,ttBeforeIME.replaceAll('fieldId=2131624075','fieldId=2131624076')],
 ['aid不匹配',ttBefore,ttBeforeIME.replaceAll('aid=1073741824','aid=1073741825')],
 ['nativeid变化',ttBefore,ttBeforeIME.replaceAll('app:id/cx','app:id/other')],
 ['密码type',ttBefore,ttBeforeIME.replaceAll('inputType=0x1 imeOptions=0x3','inputType=0x81 imeOptions=0x3')],
 ['IMEaction变化',ttBefore,ttBeforeIME.replaceAll('inputType=0x1 imeOptions=0x3','inputType=0x1 imeOptions=0x4')],
])test('头条真实前置fixture mutation拒绝：'+name,()=>{
 const c=setup(imeRaw,xml);assert.equal(run('toutiao-resolve',c.xp,c.ip).status,2);
});
for(const [name,modify] of [
 ['served token',x=>x.replaceAll('SearchAutoCompleteTextView{9ce2558','SearchAutoCompleteTextView{abc123')],
 ['connection token',x=>x.replaceAll('EditableInputConnection@e511c5b','EditableInputConnection@abc123')],
])test('头条before-ready拒绝变化：'+name,()=>{
 const c=ttSelection();writeFileSync(c.ip,modify(ttBeforeIME));writeFileSync(c.xp,ttBefore);
 assert.equal(run('check',c.selection,c.ip,c.xp).status,2);
});
test('头条before-ready同identity模型及XMLbounds漂移拒绝',()=>{
 const c=ttSelection();writeFileSync(c.ip,ttBeforeIME);writeFileSync(c.xp,ttBefore);
 assert.equal(run('check',c.selection,c.ip,c.xp).status,0);
 writeFileSync(c.xp,ttNodeChange(ttBefore,n=>n.replace('[230,141][908,272]','[230,142][908,273]')));
 assert.equal(run('check',c.selection,c.ip,c.xp).status,2);
});
test('头条typed严格原text回读模型，不猜测搜索框前缀',()=>{
 const c=ttSelection();const title='傍晚的颜色，慢一点也很好';
 writeFileSync(c.xp,ttNodeChange(ttBefore,n=>n.replace(/text="[^"]*"/,'text="'+title+'"')));
 assert.equal(run('readback',c.selection,c.xp).stdout,title);
 writeFileSync(c.xp,ttNodeChange(ttBefore,n=>n.replace(/text="[^"]*"/,'text="搜索框，'+title+'"')));
 assert.equal(run('readback',c.selection,c.xp).stdout,'搜索框，'+title);
});

const zhSearch=phase=>new URL('./fixtures/zhihu-search-'+phase+'.xml',import.meta.url).pathname;
test('真实知乎短标题search清除按钮出现只缩右缘可精确回读',()=>{
 const c=setup();const r=run('standard-resolve',zhSearch('before'));assert.equal(r.status,0,r.stderr);writeFileSync(c.selection,r.stdout);
 assert.equal(run('standard-check',c.selection,zhSearch('ready')).status,0);
 const read=run('standard-readback',c.selection,zhSearch('typed'));assert.equal(read.status,0,read.stderr);assert.equal(read.stdout,'傍晚的颜色，慢一点也很好');
});

const zhSearchTyped=readFileSync(zhSearch('typed'),'utf8');
const searchFieldChange=(x,fn)=>x.replace(/<node[^>]*resource-id="com.zhihu.android:id\/input_text"[^>]*>/,fn);
function searchSelection(){const c=setup();const r=run('standard-resolve',zhSearch('before'));assert.equal(r.status,0,r.stderr);writeFileSync(c.selection,r.stdout);return c;}
for(const [name,change] of [
 ['wrongmarker',x=>x.replace('text="搜索"','text="发送"')],
 ['wrongpkg',x=>searchFieldChange(x,n=>n.replace('package="com.zhihu.android"','package="com.other.app"'))],
 ['wrongid',x=>x.replaceAll('com.zhihu.android:id/input_text','com.zhihu.android:id/other_text')],
 ['wrongclass',x=>searchFieldChange(x,n=>n.replace('android.widget.EditText','android.widget.RelativeLayout'))],
 ['重复input',x=>x.replace('</hierarchy>','<node resource-id="com.zhihu.android:id/input_text" class="android.widget.EditText" focused="false"/></hierarchy>')],
 ['多focus',x=>x.replace('</hierarchy>','<node focused="true"/></hierarchy>')],
 ['password',x=>searchFieldChange(x,n=>n.replace('password="false"','password="true"'))],
 ['disabled',x=>searchFieldChange(x,n=>n.replace('enabled="true"','enabled="false"'))],
 ['readonly',x=>searchFieldChange(x,n=>n.replace('enabled="true"','enabled="true" editable="false"'))],
 ['changeheight',x=>searchFieldChange(x,n=>n.replace('[180,177][1057,243]','[180,177][1057,309]'))],
 ['changeleft',x=>searchFieldChange(x,n=>n.replace('[180,177][1057,243]','[181,177][1057,243]'))],
 ['changeTop',x=>searchFieldChange(x,n=>n.replace('[180,177][1057,243]','[180,176][1057,242]'))],
 ['growRight',x=>searchFieldChange(x,n=>n.replace('[180,177][1057,243]','[180,177][1110,243]'))],
 ['wrongBackClass',x=>x.replace(/<node[^>]*resource-id="com.zhihu.android:id\/back_layout"[^>]*>/,n=>n.replace('android.widget.FrameLayout','android.view.View'))],
 ['wrongClearClass',x=>x.replace(/<node[^>]*resource-id="com.zhihu.android:id\/close_layer"[^>]*>/,n=>n.replace('android.view.View','android.widget.TextView'))],
 ['noClear',x=>x.replaceAll('com.zhihu.android:id/close_layer','com.zhihu.android:id/not_clear')],
 ['duplicateClear',x=>x.replace('</hierarchy>','<node resource-id="com.zhihu.android:id/close_layer"/></hierarchy>')],
 ['clearRightMismatch',x=>x.replace('[1031,161][1109,265]','[1031,161][1108,265]')],
 ['clearGiant',x=>x.replace('[1031,161][1109,265]','[0,0][1109,2664]')],
])test('知乎search typed窄布局拒绝：'+name,()=>{
 const c=searchSelection();writeFileSync(c.xp,change(zhSearchTyped));assert.notEqual(run('standard-readback',c.selection,c.xp).status,0);
});
test('知乎search before-ready仍严格旧bounds和标识',()=>{
 const c=searchSelection();assert.notEqual(run('standard-check',c.selection,zhSearch('typed')).status,0);
});
for(const [name,text] of [['实字改变','傍晚的颜色，慢一点也很差'],['段字顺序改变','慢一点也很好，傍晚的颜色']])test('知乎search exact比较拒绝：'+name,()=>{
 const c=searchSelection();writeFileSync(c.xp,searchFieldChange(zhSearchTyped,n=>n.replace(/text="[^"]*"/,'text="'+text+'"')));
 assert.equal(run('standard-compare',c.selection,c.xp,'傍晚的颜色，慢一点也很好').status,2);
});
test('知乎search actual短标题36bytes仍exact，不继承正文换行兼容',()=>{
 const c=searchSelection();const r=run('standard-compare',c.selection,zhSearch('typed'),'傍晚的颜色，慢一点也很好');assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout);assert.equal(report.comparison_mode,'exact');assert.equal(report.identity_policy,'zhihu_search_clear_v1');assert.equal(report.actual.bytes,36);assert.equal(report.actual.sha256,report.source.sha256);
});

test('真实知乎长query高度增长仍拒绝，不能继承短query许可',()=>{
 const c=setup();const fixture=phase=>new URL('./fixtures/zhihu-search-long-'+phase+'.xml',import.meta.url).pathname;
 const r=run('standard-resolve',fixture('before'));assert.equal(r.status,0,r.stderr);writeFileSync(c.selection,r.stdout);
 assert.equal(run('standard-check',c.selection,fixture('ready')).status,0);assert.equal(run('standard-readback',c.selection,fixture('typed')).status,2);
});
