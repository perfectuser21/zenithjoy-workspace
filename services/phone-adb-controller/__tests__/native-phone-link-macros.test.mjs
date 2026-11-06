import {nativePhoneTestPython} from './helpers/native-phone-test-python.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const api=await import('../native-phone-link-macros.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
const root=fileURLToPath(new URL('../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const pkg='com.ss.android.ugc.aweme',context={profile:'fixture',serial:'47.100.213.173:10001',width:720,height:1280,keywords:['人工智能'],package:pkg,evidenceRoot:'/fixture/evidence',deviceSdk:31};
const controller=root+'douyin-phone-adb',widget=root+'clipboard-widget-cancel.py',metrics=root+'discovery-metrics.js';
async function originalLocal(name,q){
 assert.equal(name,'native-phone-link-step.py');const payload={...q,controller,controller_sha256:sha(readFileSync(controller)),widget_script:widget,widget_sha256:sha(readFileSync(widget)),metrics_script:metrics,metrics_sha256:sha(readFileSync(metrics))};
 const python=process.platform==='darwin'?nativePhoneTestPython():'python3';
 const argv=process.platform==='darwin'?['/usr/bin/sandbox-exec','-p','(version 1)(allow default)(deny process-fork)',python,'-I','-S',root+name]:[python,'-I','-S',root+name];
 return new Promise((yes,no)=>{const child=spawn(argv[0],argv.slice(1),{stdio:['pipe','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.once('error',no);child.once('close',code=>{clearTimeout(timer);if(code!==0)return no(Error('LOCAL_REJECTED:'+err));try{yes(JSON.parse(out));}catch(e){no(e);}});child.stdin.end(JSON.stringify(payload));});
}
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const detailXml=`<hierarchy><node package="${pkg}" content-desc="分享25，按钮" clickable="true" bounds="[600,500][700,600]"/><node package="${pkg}" content-desc="未点赞，喜欢1.2万，按钮"/><node package="${pkg}" content-desc="评论0，按钮"/></hierarchy>`;
const fieldXml=(value,{hint='',focused=true}={})=>`<hierarchy><node text="${escape(value)}" resource-id="${pkg}:id/et_search_kw" package="${pkg}" class="android.widget.EditText" focused="${focused}" enabled="true" clickable="true" password="false" bounds="[70,40][557,90]" hint="${escape(hint)}"/></hierarchy>`;
const panelXml=readFileSync(root+'__tests__/fixtures/cloud-share-panel-desc.xml','utf8');
const widgetFg='mCurrentFocus=Window{u0 fixture com.hihonor.android.launcher/.dragndrop.AddItemActivity}';
const widgetXml='<hierarchy><node package="com.hihonor.android.launcher" resource-id="android:id/alertTitle" text="添加到主屏幕"/><node package="com.hihonor.android.launcher" resource-id="com.hihonor.android.launcher:id/widget_name" text="抖音搜索"/><node package="com.hihonor.android.launcher" resource-id="android:id/button1" text="添加" class="android.widget.Button" clickable="true" enabled="true" bounds="[400,800][600,880]"/><node package="com.hihonor.android.launcher" resource-id="android:id/button2" text="取消" class="android.widget.Button" clickable="true" enabled="true" bounds="[100,800][300,880]"/></hierarchy>';
async function rig({old='',sdk=31,fault}={}){
 const shared='https://v.douyin.com/Same/',events=[],evidence=new Map(),captures=new WeakSet(),state={page:'detail',field:'',clip:old||'stale unrelated clipboard',old,ime:'google/.LatinIME',selected:false,issued:false,primed:null};
 const io={
  async command(op,args){events.push({op,args:[...args]});if(fault==='unknown'&&op==='pause')throw Object.assign(Error('UNKNOWN'),{executionStopped:false});
   if(op==='pause')return '';
   if(op==='scratch-search'){state.page='scratch';state.field=' ';return '';}
   if(op==='current-ime')return state.ime;
   if(op==='ime-enable')return 'Input method already enabled';
   if(op==='ime-set'){if(!(fault==='restore-ime'&&args[0]==='google/.LatinIME'))state.ime=args[0];return '';}
   if(op==='clear-nonce'){state.field='';return '';}
   if(op==='broadcast-nonce'){state.field=Buffer.from(args[0],'base64').toString();return '';}
   if(op==='input-select-all'){state.selected=true;return '';}
   if(op==='input-nonce'){state.field=args[0];return '';}
   if(op==='long-press'){state.selected=true;return '';}
   if(op==='tap'){if(state.page==='widget'){state.page='scratch';state.widgetCancelled=true;return '';}if(state.page==='detail'){state.page='panel';return '';}if(state.page==='panel'){state.page='copied';if(fault!=='copy-link')state.clip=shared;state.issued=true;return '';}return '';}
   if(op==='keyevent'){const k=args[0];if(k==='4'){state.page='detail';return '';}if(k==='278'){if(state.selected)state.clip=fault==='partial-copy'?state.field.slice(0,-1):state.field;state.selected=false;}if(k==='123')state.selected=false;if(k==='67'&&fault!=='clear-fail')state.field=state.field.slice(0,-1);if(k==='279')state.field+=state.clip;return '';}
   throw Error('UNEXPECTED_COMMAND:'+op);
  },
  async captureXml(eid){events.push({capture:eid});if(fault==='widget'&&!state.widgetShown&&eid.endsWith('-seed-empty')){state.page='widget';state.widgetShown=true;}let xml=state.page==='widget'?widgetXml:state.page==='scratch'?fieldXml(state.field):state.page==='panel'?panelXml:detailXml;if(fault==='target-contact'&&state.page==='panel')xml=panelXml.replace('function_container','contacts');const artifact={path:'/fixture/evidence/'+eid+'.xml',xml,sha256:sha(xml)};captures.add(artifact);evidence.set(eid+'.xml',xml);return artifact;},
  async snapshot(eid){events.push({snapshot:eid});return {path:'/fixture/evidence/'+eid+'.png',bytes:Buffer.from('fixture-image'),sha256:sha('fixture-image')};},
  async foreground(){return fault==='foreground'?'mCurrentFocus=Window{launcher/.Main}':state.page==='widget'?widgetFg:state.page==='scratch'?'mCurrentFocus=Window{'+pkg+'/com.ss.android.ugc.aweme.search.activity.SearchResultActivity}':'mCurrentFocus=Window{'+pkg+'/.MainActivity}';},
  async wait(){},local:originalLocal,
  async resolveShareLink(url){assert.equal(url,shared);return 'https://www.douyin.com/video/7617105883093603314';},
  async writeEvidence(eid,extension,bytes){const path='/fixture/evidence/'+eid+'.'+extension;assert.equal(evidence.has(eid+'.'+extension),false,'never overwrite original evidence');evidence.set(eid+'.'+extension,String(bytes));return path;},
  async readClipState(){return state.old;},async writeClipState(value){state.old=value;events.push({clipSaved:value});},
  async restoreResults(word,eid){assert.equal(word,'人工智能');events.push({restore:eid});state.page='results';return {verified:fault!=='results',recovered_via:'research'};},
  async primeMetrics(artifact){assert.equal(captures.has(artifact),true,'metrics receives the original Code-owned artifact, never a cloned JSON packet');state.primed=await originalLocal('native-phone-link-step.py',{operation:'metrics-descriptions',xml:artifact.xml,width:720,height:1280});},
 };
 return {io,state,events,evidence,macro:api.createNativePhoneLinkMacros({context:{...context,deviceSdk:sdk},io})};
}
test('public link macro exists and never accepts arbitrary Worker commands',()=>{
 assert.equal(typeof api.createNativePhoneLinkMacros,'function');
 const io=Object.fromEntries(['command','captureXml','snapshot','foreground','wait','local','resolveShareLink','writeEvidence','readClipState','writeClipState','restoreResults','primeMetrics'].map(k=>[k,async()=>{throw Error('NO_IO');}]));
 const m=api.createNativePhoneLinkMacros({context,io});assert.deepEqual(m.commands,['current-video-link']);assert.ok(Object.isFrozen(m));
 return assert.rejects(m.run('shell',['id']),/NATIVE_LINK_COMMAND/);
});
test('actual frozen local parser rejects a contact named 分享链接 and preserves original strict nonce field rules',async()=>{
 assert.equal((await originalLocal('native-phone-link-step.py',{operation:'share-target',xml:panelXml,width:720,height:1280})).accepted,true);
 assert.equal((await originalLocal('native-phone-link-step.py',{operation:'share-target',xml:panelXml.replace('function_container','contacts'),width:720,height:1280})).accepted,false);
 assert.equal((await originalLocal('native-phone-link-step.py',{operation:'field',xml:fieldXml('clipnonce'+'a'.repeat(32)),expected:'clipnonce'+'a'.repeat(32),strict:true,width:720,height:1280})).accepted,true);
 assert.equal((await originalLocal('native-phone-link-step.py',{operation:'field',xml:fieldXml('clipnonce'+'a'.repeat(32),{focused:false}),strict:true,width:720,height:1280})).accepted,false);
});
test('first copied link pauses twice, uses actual original UI parsers, binds same detail metrics and validates results before cache',async()=>{
 const f=await rig(),value=await f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']);assert.match(value,/video_id=7617105883093603314/);assert.match(value,/return_mode=results/);assert.match(value,/metrics_evidence=.*fixture-candidate1-link-t1-share.xml/);assert.equal(f.events.filter(e=>e.op==='pause').length,2);assert.equal(f.state.old,'https://v.douyin.com/Same/');assert.deepEqual(f.state.primed,['分享25，按钮','未点赞，喜欢1.2万，按钮','评论0，按钮']);assert.equal(f.evidence.get('fixture-candidate1-link-t1-share.xml'),detailXml);assert.ok(f.events.findIndex(e=>e.restore)<f.events.findIndex(e=>e.clipSaved));
});
for(const sdk of [0,31,33])test(`SDK${sdk} old same URL requires fresh generated nonce copy/clear/exact append and restores IME`,async()=>{
 const f=await rig({old:'https://v.douyin.com/Same/',sdk}),value=await f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']);assert.match(value,/video_id=/);assert.equal(f.state.ime,'google/.LatinIME');assert.ok(f.events.some(e=>e.op==='long-press'));assert.ok([...f.evidence.keys()].some(e=>e.endsWith('seed-empty-proof-verified.txt')));const input=f.events.find(e=>['broadcast-nonce','input-nonce'].includes(e.op));assert.ok(input);assert.match(input.op==='broadcast-nonce'?Buffer.from(input.args[0],'base64').toString():input.args[0],/^clipnonce[a-f0-9]{32}$/);if(sdk===31)assert.equal(f.events.some(e=>e.op==='input-select-all'||e.op==='input-nonce'),false);
});
for(const fault of ['partial-copy','clear-fail','copy-link','restore-ime','target-contact','results'])test(`known ${fault} fails without recording a successful link or replaying share action`,async()=>{
 const f=await rig({old:'https://v.douyin.com/Same/',fault});await assert.rejects(f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']));assert.equal(f.events.filter(e=>e.clipSaved).length,0);assert.ok(f.events.filter(e=>e.op==='scratch-search').length<=2);if(fault==='restore-ime'){assert.equal(f.state.issued,false);assert.equal(f.events.filter(e=>e.op==='ime-set'&&e.args[0]==='google/.LatinIME').length,2);}else assert.equal(f.state.ime,'google/.LatinIME');
});
test('unknown remote action stops immediately and never enters a navigation retry',async()=>{const f=await rig({fault:'unknown'});await assert.rejects(f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']),e=>e.executionStopped===false);await assert.rejects(f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']),/PREVIOUS_UNKNOWN/);assert.deepEqual(f.events,[{op:'pause',args:[]}]);});
test('wrong foreground fails before any pause, copy, tap or clipboard read',async()=>{const f=await rig({fault:'foreground'});await assert.rejects(f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']),/WRONG_FOREGROUND/);assert.equal(f.events.length,0);});
test('only the original exact HONOR widget is cancelled once, then a fresh nonce starts and original evidence remains',async()=>{
 const f=await rig({old:'https://v.douyin.com/Same/',fault:'widget'}),result=await f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']);assert.match(result,/video_id=/);assert.equal(f.state.widgetCancelled,true);assert.equal(f.events.filter(e=>e.op==='tap'&&e.args.join(',')==='200,840').length,1);assert.ok(f.evidence.has('fixture-candidate1-link-t1-seed-empty.xml'));assert.ok(f.evidence.has('fixture-candidate1-link-t1-widget-retry-seed-empty.xml'));assert.equal(f.state.ime,'google/.LatinIME');
});
test('third original link attempt remains acceptable to the unchanged metrics contract',async()=>{
 const f=await rig(),capture=f.io.captureXml;f.io.captureXml=async eid=>{const match=/-t([1-5])-share-c[1-3]$/.exec(eid);if(match&&Number(match[1])<3){f.events.push({capture:eid});const xml=`<hierarchy><node package="${pkg}"/></hierarchy>`;return {path:'/fixture/evidence/'+eid+'.xml',xml,sha256:sha(xml)};}return capture(eid);};
 const result=await f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']),eid=result.match(/^metrics_evidence_id=(.+)$/m)[1];assert.equal(eid,'fixture-candidate1-link-t3');
 const {default:metricsModule}=await import('../discovery-metrics.js');const observation=metricsModule.buildObservation({run:'fixture',run_id:'douyin_video_discovery-fixture__a1',profile:'fixture',source_commit:'a'.repeat(40),line_key:'yuesheng',video_id:'7617105883093603314',video_url:'https://www.douyin.com/video/7617105883093603314',observed_at:new Date().toISOString(),evidence_id:eid,xml:detailXml},{parseDescriptions:()=>f.state.primed});assert.equal(observation.evidence_id,eid);
});
test('after three returned pending-share attempts no fourth action or successful t4 identity is allowed',async()=>{
 const f=await rig(),capture=f.io.captureXml;f.io.captureXml=async eid=>{const match=/-t([1-5])-share-c[1-3]$/.exec(eid);if(match&&Number(match[1])<=3){f.events.push({capture:eid});const xml=`<hierarchy><node package="${pkg}"/></hierarchy>`;return {path:'/fixture/evidence/'+eid+'.xml',xml,sha256:sha(xml)};}return capture(eid);};
 await assert.rejects(f.macro.run('current-video-link',['fixture-candidate1-link','人工智能']),/SHARE_BUTTON_PENDING/);assert.equal(f.events.filter(e=>e.capture&&/-share-c/.test(e.capture)).length,9);assert.deepEqual(f.events.at(-1),{capture:'fixture-candidate1-link-t3-share-c3'});assert.equal(f.events.some(e=>JSON.stringify(e).includes('-t4')),false);assert.equal(f.events.some(e=>e.clipSaved),false);
});
