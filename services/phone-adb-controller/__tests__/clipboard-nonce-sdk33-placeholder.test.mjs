import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
const fn=name=>controller.match(new RegExp(name+'\\(\\) \\{[\\s\\S]*?\\n\\}'))[0];
const fixtures=new URL('./fixtures/sdk33-nonce/',import.meta.url).pathname;
const samples=readdirSync(fixtures).filter(x=>x.endsWith('-empty.xml'));
function run(sample=samples[0],flags={}) {
 const dir=mkdtempSync(join(tmpdir(),'nonce-sdk33-')),adb=join(dir,'adb');
 writeFileSync(join(dir,'state.json'),JSON.stringify({field:'',clip:'https://v.douyin.com/Old/',selected:false,events:[]}));
 writeFileSync(adb,`#!/usr/bin/python3
import os,sys,json,xml.etree.ElementTree as E
from pathlib import Path
p=Path(os.environ['D'])/'state.json';s=json.loads(p.read_text());a=sys.argv[1:];f=json.loads(os.environ['FLAGS'])
if a[:2]==['-s','FAKE']:a=a[2:]
s['events'].append(' '.join(a));rc=0
if a[:1]==['test-ui']:
 phase=Path(a[1]).stem.split('-')[-1]
 source=os.environ['SAMPLE'] if phase in ['empty','field'] else os.environ['SAMPLE'].replace('-empty.xml','-typed.xml')
 tree=E.parse(source);nodes=[n for n in tree.iter('node') if n.get('resource-id')=='com.ss.android.ugc.aweme:id/et_search_kw'];n=nodes[0]
 if phase not in ['empty','field'] or s['field']:n.set('text',s['field'])
 if phase in ['empty','pasted']:
  for k,v in f.get('attrs',{}).items():n.set(k,v)
  if f.get('duplicate'):tree.getroot().append(E.fromstring(E.tostring(n)))
 tree.write(a[1],encoding='unicode')
elif a[:3]==['shell','input','keycombination']:s['selected']=True
elif a[:3]==['shell','input','text']:s['field']=a[3];s['selected']=False
elif a[:3]==['shell','input','keyevent']:
 k=a[3]
 if k=='278':
  s['original']=s['field'];s['clip']=s['field'][10:] if f.get('prefixResidual') else s['field'][:-1] if f.get('partialCopy') else s['clip'] if f.get('copyFail') else s['field'];s['selected']=False
 elif k=='67':
  s['field']=s['original'][:10] if f.get('prefixResidual') else '真实残留' if f.get('residual') else '';s['selected']=bool(f.get('selectedResidual'))
 elif k=='123':
  if f.get('moveEndFail'):rc=1
  else:s['selected']=False
 elif k=='279':
  value='https://v.douyin.com/Old/' if f.get('pasteOld') else s['clip']
  s['field']=value if s['selected'] else s['field']+value;s['selected']=False
p.write_text(json.dumps(s));sys.exit(rc)
`,{mode:0o755});
 const script=`set -eu;setopt EXTENDED_GLOB
die(){ print -u2 -- "$1";exit 2; }
wait_ms(){ :; }
node_center(){ print '200 200'; }
ui_evidence(){ "$ADB" test-ui "$EVIDENCE_ROOT/$1.xml"; }
_leave_scratch_route(){ :; }
${['nonce_sdk31_field','seed_clipboard_nonce'].map(fn).join('\n')}
seed_clipboard_nonce fixture`;
 const r=spawnSync('zsh',['-c',script],{encoding:'utf8',env:{...process.env,D:dir,FLAGS:JSON.stringify(flags),SAMPLE:join(fixtures,sample),DEVICE_SDK:'33',LOCK_OWNER:'fixture-only',ADB:adb,SERIAL:'FAKE',PYTHON_BIN:'/usr/bin/python3',EVIDENCE_ROOT:dir,SCREEN_W:'1080',SCREEN_H:'2400'}});
 return {...r,state:JSON.parse(readFileSync(join(dir,'state.json'),'utf8')),dir};
}
for(const sample of samples)test('SDK33真实无hint动态占位 '+sample,()=>{
 const r=run(sample);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/^clipnonce[a-f0-9]{32}\n$/);
 assert.equal(r.state.field,r.state.clip);assert.match(readFileSync(join(r.dir,'fixture-seed-empty-proof.txt'),'utf8'),/verified_by_exact_nonce_append/);
 assert.ok(r.state.events.indexOf('shell input keyevent 123')<r.state.events.indexOf('shell input keyevent 279'));
});
for(const [name,flags] of Object.entries({真实残留:{residual:true},选区残留不能被替换掩盖:{residual:true,selectedResidual:true},nonce前缀加复制后缀:{prefixResidual:true},部分剪贴板:{partialCopy:true},旧剪贴板:{pasteOld:true},复制失败:{copyFail:true},移动失败:{moveEndFail:true},失焦:{attrs:{focused:'false'}},禁用:{attrs:{enabled:'false'}},错包:{attrs:{package:'other'}},错class:{attrs:{class:'android.widget.TextView'}},密码:{attrs:{password:'true'}},越界:{attrs:{bounds:'[1,1][1081,99]'}},重复resource:{duplicate:true}}))test('SDK33拒绝'+name,()=>{
 const r=run(samples[0],flags);assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,/CLIPBOARD_NONCE/);
 if(flags.prefixResidual)assert.ok(!r.state.events.includes('shell input keyevent 279'),'前缀不得进入粘贴');
});
