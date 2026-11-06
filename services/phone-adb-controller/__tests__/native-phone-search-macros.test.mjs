import {nativePhoneTestPython,nativePhoneTestPilRoot,nativePhoneTestImageArgs} from './helpers/native-phone-test-python.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,cpSync,readdirSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),py=nativePhoneTestPython();
const api=await import('../native-phone-search-macros.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;}),sha=x=>createHash('sha256').update(x).digest('hex');
const child=(args,input='',binary=py)=>new Promise((resolve,reject)=>{const p=spawn(binary,args,{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.once('error',reject);p.once('close',(code,signal)=>resolve({code,signal,out,err}));p.stdin.end(input);});
async function rig(t,{selected='correct',captureFault=false,unknownTap=false,rows=6}={}){
 const dir=realpathSync(mkdtempSync(join(tmpdir(),'native-search-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const pillow=nativePhoneTestPilRoot(py);cpSync(pillow,join(dir,'PIL'),{recursive:true,filter:p=>!p.split('/').includes('__pycache__')});
 const files=[];const scan=(p,rel='')=>{for(const e of readdirSync(p,{withFileTypes:true})){const r=rel?rel+'/'+e.name:e.name;if(e.isDirectory())scan(join(p,e.name),r);else{assert.ok(e.isFile());files.push({path:r,sha256:sha(readFileSync(join(p,e.name)))});}}};scan(join(dir,'PIL'));const spec=join(dir,'pillow.json');writeFileSync(spec,JSON.stringify({root:join(dir,'PIL'),files:files.sort((a,b)=>a.path.localeCompare(b.path))}));
 const draw=`from PIL import Image,ImageDraw
import sys
root,selected=sys.argv[1:3];rows=int(sys.argv[3])
for name in ['panel','selected','wrong']:
 im=Image.new('RGB',(720,1600),(45,45,45));d=ImageDraw.Draw(im)
 for r in range(6 if rows==6 else 5):
  for c in range(1 if rows==6 and r==1 else 4):
   x=35+c*160;y=300+r*98;d.rectangle((x,y,x+132,y+47),fill=(245,240,240))
 for r,c in ([(0,1),(2,3),(3,0),(4,0),(5,1)] if rows==6 else [(0,1),(1,3),(2,0),(3,0)]):
  if name=='wrong' and r==0:c=2
  x=35+c*160;y=300+r*98;d.rectangle((x+15,y+12,x+38,y+34),fill=(230,65,65))
 if rows==4:d.rectangle((40,695,162,735),fill=(235,55,75))
 d.rectangle((375,992,676,1072),fill=(235,55,75));im.save(root+'/'+name+'.png')
Image.new('RGB',(720,1600),(45,45,45)).save(root+'/results.png')
`;const made=await child(nativePhoneTestImageArgs(draw,[dir,selected,String(rows)],py));assert.equal(made.code,0,made.err);
 const controller=join(root,'douyin-phone-adb'),helper=join(root,'native-phone-search-step.py'),tab=join(root,'search-video-tab.py');
 const local=async(name,input)=>{assert.equal(name,'native-phone-search-step.py');const r=await child(['-p','(version 1)(allow default)(deny process-fork)',py,'-I','-S',helper,controller,sha(readFileSync(controller)),sha(readFileSync(tab)),spec,sha(readFileSync(spec))],JSON.stringify(input),'/usr/bin/sandbox-exec');if(r.code!==0)throw Object.assign(Error(r.err.trim()||'local parse failed'),{returned:true});return JSON.parse(r.out);};
 let query='人工智能',page='results',taps=0;const events=[];
 const xml=readFileSync(join(root,'__tests__/fixtures/real-search-results-tabbar.xml'),'utf8');
 const sourceXml=xml.replace(/text="[^"]*"(?=[^>]*resource-id="com.ss.android.ugc.aweme:id\/et_search_kw")/,`text="${query}"`).replace(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g,(_,a,b,c,d)=>`bounds="[${Math.floor(a*720/1200)},${Math.floor(b*1600/2664)}][${Math.floor(c*720/1200)},${Math.floor(d*1600/2664)}]"`);
 const io={command:async(op,args)=>{events.push({op,args});if(op==='tap'){taps++;if(unknownTap)throw Object.assign(Error('remote timeout'),{executionStopped:false});if(taps===2)page='panel';else if(taps===8)page='results';}return '';},captureXml:async(eid)=>{if(captureFault)throw Object.assign(Error('capture unknown'),{executionStopped:false});const path=join(dir,eid+'.xml');writeFileSync(path,sourceXml);return {path,xml:sourceXml,sha256:sha(sourceXml)};},snapshot:async(eid)=>{const name=eid.includes('selected')?(selected==='wrong'?'wrong':'selected'):eid.includes('results')?'results':'panel',path=join(dir,name+'.png');return {path,bytes:readFileSync(path),sha256:sha(readFileSync(path))};},foreground:async()=> 'com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity',wait:async(ms)=>{events.push({wait:ms});},local};
 return {dir,local,io,events,pillowRoot:join(dir,'PIL'),context:{profile:'fixture',serial:'SERIAL',width:720,height:1600,keywords:[query],package:'com.ss.android.ugc.aweme',evidenceRoot:dir}};
}
test('public search macro factory runs original Pillow selector and selected/results readback without a shell macro',async t=>{
 assert.equal(typeof api.createNativePhoneSearchMacros,'function');const f=await rig(t),m=api.createNativePhoneSearchMacros(f);const result=await m.run('search-time-layer',['six_months','fixture-filter','latest','unlimited','unlimited','same_city']);assert.match(result,/sort=latest/);assert.match(result,/location=same_city/);assert.equal(f.events.filter(e=>e.op==='tap').length,8);assert.ok(f.events.some(e=>e.wait===2200));
});
test('original selected-state predicate rejects requested values that pixels do not prove',async t=>{
 assert.equal(typeof api.createNativePhoneSearchMacros,'function');const f=await rig(t,{selected:'wrong'}),m=api.createNativePhoneSearchMacros(f);await assert.rejects(m.run('search-time-layer',['six_months','fixture-filter','latest','unlimited','unlimited','same_city']),/selected state missing/);assert.equal(f.events.filter(e=>e.op==='tap').length,7,'must not press 查看结果 after failed selection evidence');
});
test('unknown capture or tap never enters fallback/retry actions',async t=>{
 assert.equal(typeof api.createNativePhoneSearchMacros,'function');for(const options of [{captureFault:true},{unknownTap:true}]){const f=await rig(t,options),m=api.createNativePhoneSearchMacros(f);await assert.rejects(m.run('search-time-layer',['six_months','fixture-filter','latest','unlimited','unlimited','same_city']));assert.ok(f.events.filter(e=>e.op==='tap').length<=1);}
});
test('fixed keyword and unsupported options reject before phone actions',async t=>{
 assert.equal(typeof api.createNativePhoneSearchMacros,'function');const f=await rig(t),m=api.createNativePhoneSearchMacros(f);for(const [command,args]of [['open-search',[encodeURIComponent('别家公司')]],['search-time-layer',['yesterday','x']],['search-grid-scroll',['x','sideways']],['tap',['1','2']]])await assert.rejects(m.run(command,args));assert.equal(f.events.filter(e=>e.op).length,0);
});
test('native card parser agrees byte-for-byte with original frozen shell predicates on recorded grids',async t=>{
 const f=await rig(t),source=readFileSync(join(root,'douyin-phone-adb'),'utf8');
 const original=name=>{const start=source.indexOf('\n'+name+'() {\n')+1,end=source.indexOf('\n}\n',start);assert.ok(start>0&&end>start);return source.slice(start,end+3);};
 const code=original('_video_card_optional_nodes')+'\n'+original('video_cards_from_xml')+'\nvideo_cards_from_xml "$1"';
 for(const name of ['real-search-results-grid.xml','real-ai30-screen3-grid-no-duration.xml']){const path=join(root,'__tests__/fixtures',name),expected=await child(['-f','-c',code,'native-search-offline-oracle',path],'','/bin/zsh');assert.equal(expected.code,0,expected.err);assert.ok(expected.out.length>0);const parsed=await f.local('native-phone-search-step.py',{operation:'cards',args:[path]});assert.equal(parsed.code,0);assert.equal(parsed.stdout,expected.out);}
});
test('original native category-tab parser reads the recorded grid and rechecks selected state',async t=>{
 const f=await rig(t),xml=readFileSync(join(root,'__tests__/fixtures/real-search-results-grid.xml'),'utf8');const io={...f.io,captureXml:async eid=>{const path=join(f.dir,eid+'.xml');writeFileSync(path,xml);return {path,xml,sha256:sha(xml)};}};
 const m=api.createNativePhoneSearchMacros({context:{...f.context,width:1200,height:2664},io});assert.match(await m.run('search-video-tab',['native-tab']),/video_tab=1/);assert.equal(f.events.filter(e=>e.op==='tap').length,1);
});
test('back-to-results verifies real search activity, exact keyword, then native selected tab',async t=>{
 const f=await rig(t),xml=readFileSync(join(root,'__tests__/fixtures/real-search-results-grid.xml'),'utf8');let backs=0;
 const io={...f.io,foreground:async()=>backs?'com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.search.activity.SearchResultActivity':'com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.detail.ui.DetailActivity',command:async(op,args)=>{f.events.push({op,args});if(op==='keyevent'){assert.deepEqual(args,['4']);backs++;}},captureXml:async eid=>{const path=join(f.dir,eid+'.xml');writeFileSync(path,xml);return {path,xml,sha256:sha(xml)};}};
 const m=api.createNativePhoneSearchMacros({context:{...f.context,width:1200,height:2664},io});assert.match(await m.run('back-to-results',['4','人工智能','return']),/back_to_results=1 backs=1/);assert.equal(backs,1);assert.equal(f.events.filter(e=>e.op==='tap').length,0,'已选中的原搜索网格不得被多余tab点击刷新或移动');
});
test('Pillow dependency drift rejects original image predicates instead of importing a guessed system package',async t=>{
 const f=await rig(t);writeFileSync(join(f.pillowRoot,'Image.py'),'raise RuntimeError("changed")');await assert.rejects(f.local('native-phone-search-step.py',{operation:'filter-action',args:[join(f.dir,'panel.png')]}),/SOURCE_SHA/);
});
test('tab relocation uses the fresh native bounds and publishes the canonical verified checkpoint',async t=>{
 const f=await rig(t),before=readFileSync(join(root,'__tests__/fixtures/search-tabs-before-reorder.xml'),'utf8').replaceAll('测试关键词','人工智能'),reordered=readFileSync(join(root,'__tests__/fixtures/search-tabs-after-reorder.xml'),'utf8').replaceAll('测试关键词','人工智能'),selected=readFileSync(join(root,'__tests__/fixtures/real-search-results-grid.xml'),'utf8');let publishes=0;
 const io={...f.io,captureXml:async eid=>{const xml=eid.endsWith('-aftertab-retry')?selected:eid.endsWith('-tabs-retry')?reordered:before,path=join(f.dir,eid+'.xml');writeFileSync(path,xml);return {path,xml,sha256:sha(xml)};},publishXml:async(eid,{source,first})=>{publishes++;assert.equal(first.xml,before);assert.equal(source.xml,selected);writeFileSync(join(f.dir,eid+'-first.xml'),first.xml,{flag:'wx'});const path=join(f.dir,eid+'.xml');writeFileSync(path,source.xml);return {path,xml:source.xml,sha256:sha(source.xml)};}};
 const m=api.createNativePhoneSearchMacros({context:{...f.context,width:1200,height:2664},io}),result=await m.run('search-video-tab',['relocate']);assert.match(result,/video_tab_relocalized=1/);assert.match(result,/evidence=.*\/relocate-aftertab\.xml/);assert.equal(publishes,1);const taps=f.events.filter(e=>e.op==='tap');assert.equal(taps.length,2);assert.notDeepEqual(taps[0].args,taps[1].args,'second tap must use the newly parsed reordered tab bounds');
});
test('readable non-search UI cannot spend the filter retry budget on blind taps',async t=>{
 const f=await rig(t),xml='<hierarchy><node text="我的主页" /></hierarchy>',path=join(f.dir,'profile.xml');writeFileSync(path,xml);const m=api.createNativePhoneSearchMacros({context:f.context,io:{...f.io,captureXml:async()=>({path,xml,sha256:sha(xml)})}});await assert.rejects(m.run('search-time-layer',['six_months','wrong-page','latest','unlimited','unlimited','same_city']),/NOT_ON_SEARCH_RESULTS/);assert.equal(f.events.filter(e=>e.op==='tap').length,0);
});
test('four-row original predicates report unavailable location without pretending same-city was selected',async t=>{
 const f=await rig(t,{rows:4}),m=api.createNativePhoneSearchMacros(f),result=await m.run('search-time-layer',['six_months','four-row','latest','unlimited','unlimited','same_city']);assert.match(result,/location=unavailable\nlocation_requested=same_city/);assert.equal(f.events.filter(e=>e.op==='tap').length,7);
});
test('image dependency failure is detected before any filter UI action',async t=>{
 const f=await rig(t);writeFileSync(join(f.pillowRoot,'Image.py'),'raise RuntimeError("changed")');const m=api.createNativePhoneSearchMacros(f);await assert.rejects(m.run('search-time-layer',['six_months','bad-source','latest','unlimited','unlimited','same_city']),/SOURCE_SHA/);assert.equal(f.events.filter(e=>e.op).length,0,'no partial filter taps before required parser dependencies are ready');
});
test('known tab failure retains original XML, fresh failure screenshot and foreground diagnostics',async t=>{
 const f=await rig(t),xml=readFileSync(join(root,'__tests__/fixtures/search-tabs-before-reorder.xml'),'utf8').replaceAll('测试关键词','人工智能');let shots=0;
 const m=api.createNativePhoneSearchMacros({context:{...f.context,width:1200,height:2664},io:{...f.io,captureXml:async eid=>{const path=join(f.dir,eid+'.xml');writeFileSync(path,xml);return {path,xml,sha256:sha(xml)};},snapshot:async eid=>{shots++;return f.io.snapshot(eid);}}});
 await assert.rejects(m.run('search-video-tab',['failed-tab']),e=>{assert.match(e.message,/TAB_NOT_SELECTED/);assert.ok(e.evidence?.xml);assert.ok(e.evidence?.screenshot);assert.match(e.evidence?.foreground||'',/com\.ss\.android\.ugc\.aweme/);return true;});assert.equal(shots,1);
});
test('unknown native tab channel cannot acquire extra diagnostic phone reads',async t=>{
 const f=await rig(t,{captureFault:true});let shots=0,focus=0;const m=api.createNativePhoneSearchMacros({context:f.context,io:{...f.io,snapshot:async()=>{shots++;throw Error('unexpected screenshot');},foreground:async()=>{focus++;throw Error('unexpected focus read');}}});await assert.rejects(m.run('search-video-tab',['unknown-tab']));assert.equal(shots,0);assert.equal(focus,0);
});
