// Original 102 detail/playback actions. Playback-speed output is an action receipt,
// never an audio-state, identity, content verdict or Android stop attestation.
// open-video echoes its requested VID; the separate real-link identity check remains required.
const commands=Object.freeze(['open-video','set-playback-speed']),helper='native-phone-detail-step.py';
const fail=code=>Object.assign(Error('NATIVE_DETAIL_'+code),{code:'NATIVE_DETAIL_'+code});
export function createNativePhoneDetailMacros({context,io}={}){
 const c=Object.freeze({...structuredClone(context),detailPlayback:context?.detailPlayback??'continuous_identity'});
 if(c.package!=='com.ss.android.ugc.aweme'||!['width','height'].every(k=>Number.isSafeInteger(c[k])&&c[k]>0&&c[k]<=10000)||!['continuous_identity','standard'].includes(c.detailPlayback)||!io||['command','captureXml','snapshot','local','wait','locate'].some(k=>typeof io[k]!=='function'))throw fail('DEPENDENCY');
 let busy=false,unsafe=false;
 const uiBoundary=e=>/^NATIVE_UI_(WRONG_FOREGROUND|PAUSED_XML_REJECTED|CRASH_ABSENCE|CRASH_TIME|CRASH_DUMP|CRASH_FRESHNESS|TOGGLE_CRASH|PAUSE_TOGGLE|RESTORE_TOGGLE|COMMAND_FAILED)$/.test(e?.code||'');
 const uncertain=e=>e?.executionStopped===false||e?.resourceUnknown===true||e?.execution_unknown===true||e?.externalEffect==='unknown';
 const local=(operation,args)=>io.local(helper,{operation,args});
 const ui=(operation,payload)=>io.local('native-phone-ui-step.py',{operation,package:c.package,...payload});
 const link=(xml)=>io.local('native-phone-link-step.py',{operation:'detail',xml,width:c.width,height:c.height});
 async function command(op,args=[]){const r=await io.command(op,args);if(r?.reviewed_command_returned!==true||!Number.isInteger(r.code)||!Buffer.isBuffer(r.stdout)||!Buffer.isBuffer(r.stderr))throw Object.assign(fail('COMMAND_UNVERIFIED'),{executionStopped:false,execution_unknown:true});if(r.code!==0)throw fail('COMMAND_FAILED');return r.stdout.toString();}
 const wait=ms=>io.wait(ms),tap=xy=>command('tap',xy.map(String));
 async function exactForeground(){const raw=await command('foreground');if((await ui('foreground',{foreground:raw}))?.accepted!==true)throw fail('WRONG_FOREGROUND');return raw;}
 async function gate(eid){for(let round=1;round<=3;round++){await exactForeground();let tree;try{tree=await io.captureXml(eid+'-fg'+round,{policy:'paused-douyin'});}catch(e){if(uncertain(e)||e?.returned!==true||e.code!=='NATIVE_UI_TREE_UNAVAILABLE')throw e;return;}
   if((await ui('complete',{xml:tree.xml}))?.accepted!==true)throw fail('UNTRUSTED_FOREGROUND_EVIDENCE');const action=await local('gate-dismiss',[tree.xml,String(c.width),String(c.height)]);if(action.center===null)return;await tap(action.center);await wait(900);
  }await exactForeground();}
 async function detail(eid){for(let wave=1;wave<=2;wave++){let tree;try{tree=await io.captureXml(eid+'-w'+wave,{policy:'paused-detail'});}catch(e){if(uncertain(e)||e?.returned!==true)throw e;if(uiBoundary(e))return {code:3};if(e.code!=='NATIVE_UI_TREE_UNAVAILABLE')throw e;if(wave===1){await wait(2500);continue;}return {code:2};}
   if((await ui('fresh-share',{xml:tree.xml}))?.accepted!==true)return {code:1};return {code:(await link(tree.xml))?.accepted===true?0:1,tree};
  }return {code:2};}
 async function openVideo(videoId,eid){await command('open-detail',[videoId]);let foreground=false;for(let attempt=1;attempt<=8;attempt++){await wait(500);const raw=await command('foreground');if(raw.includes(c.package)){foreground=true;break;}}if(!foreground)throw fail('WRONG_FOREGROUND');
  await command('pause');await wait(600);await gate(eid+'-gate');let guardId=eid+'-openvideo',result=await detail(guardId);
  if(result.code===1||result.code===3){let overlay;try{overlay=await io.captureXml(eid+'-card-copy-overlay',{policy:'paused-douyin'});}catch(e){if(uncertain(e)||e?.returned!==true)throw e;}
   if(overlay&&(await local('card-copy-overlay',[overlay.xml]))?.accepted===true){const raw=await command('foreground');if((await local('foreground-detail',[raw]))?.accepted!==true)throw fail('CARD_COPY_OVERLAY_FOREGROUND_CHANGED');await command('keyevent',['4']);await wait(600);await command('open-detail',[videoId]);await gate(eid+'-card-copy-reopen-gate');guardId=eid+'-card-copy-reopen';result=await detail(guardId);}
  }
  if(result.code===2){await wait(3000);result=await detail(guardId+'-w2');}if(result.code!==0||!result.tree)throw fail('DETAIL_UNVERIFIED');await io.snapshot(eid+'-openvideo-ok');const count=await local('comment-count',[result.tree.xml]);if(c.detailPlayback==='standard')await command('keyevent',['126']);if(!['positive','zero'].includes(count?.status)||typeof count.label!=='string')throw fail('COMMENT_COUNT_UNKNOWN');return `video_opened=1\nvideo_id=${videoId}\ncomment_count=${count.label}\ncomment_count_evidence=${result.tree.path}\ncomment_count_evidence_sha256=${result.tree.sha256}\n`;
 }
 async function speed(eid){await exactForeground();const x=String(Math.floor(c.width/2)),y=String(Math.floor(c.height/2));await command('swipe',[x,y,x,y,'1500']);await wait(1800);const selected=await local('speed-prompt',[]);if(selected.prompt!=="播放速度菜单中的「'3.0'」倍速选项数字")throw fail('SPEED_SOURCE');const xy=await io.locate({key:'speed3',prompt:selected.prompt,clear_cache:true,evidence_id:eid+'-spd'});const point=Array.isArray(xy)?xy:Array.isArray(xy?.center)?xy.center:typeof xy?.coordinate==='string'&&/^\d+ \d+$/.test(xy.coordinate)?xy.coordinate.split(' ').map(Number):null;if(!Array.isArray(point)||point.length!==2||!point.every(Number.isSafeInteger)||point[0]<0||point[0]>=c.width||point[1]<0||point[1]>=c.height)throw fail('SPEED_COORDINATE');await tap(point);await wait(1200);return 'playback_speed_set=3.0\n';}
 async function run(name,args=[]){if(!commands.includes(name)||!Array.isArray(args)||args.length!==2||typeof args[1]!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(args[1])||name==='open-video'&&!/^\d{16,24}$/.test(args[0]||'')||name==='set-playback-speed'&&args[0]!=='3.0')throw fail('INPUT');if(busy||unsafe)throw fail(unsafe?'UNKNOWN':'BUSY');busy=true;try{return name==='open-video'?await openVideo(...args):await speed(args[1]);}catch(e){if(uncertain(e))unsafe=true;throw e;}finally{busy=false;}}
 return Object.freeze({commands,run});
}
