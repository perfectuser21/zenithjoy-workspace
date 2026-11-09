// SDK31真实输出的保守结构解析。这里只给组件事实，不签发fence/资源恢复授权。
const reason=(set,value)=>set.add(value);
function text(value,max=8*1024*1024){if(typeof value!=='string'||Buffer.byteLength(value)>max||value.includes('\0'))return null;return value;}
const matches=(raw,pattern)=>[...raw.matchAll(pattern)];
export function parseSdk31Processes(value){
 const raw=text(value),reasons=new Set(),rows=[];if(raw===null)return {rows,old_producers:[],unresolved_shells:[],inventory_complete:false,reasons:['PROCESS_ENCODING']};
 const lines=raw.trimEnd().split('\n');if(!/^\s*UID\s+PID\s+PPID\s+NAME\s+ARGS\s*$/.test(lines.shift()||''))reason(reasons,'PROCESS_HEADER');
 const ids=new Set();for(const line of lines){const m=line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);if(!m){reason(reasons,'PROCESS_ROW');continue;}const [uid,pid,ppid]=m.slice(1,4).map(Number);if(![uid,pid,ppid].every(Number.isSafeInteger)||pid<1||ids.has(pid)){reason(reasons,'PROCESS_PID');continue;}ids.add(pid);rows.push({uid,pid,ppid,name:m[4],args:m[5]});}
 if(!rows.some(p=>p.pid===1&&p.name==='init')||!rows.some(p=>p.name==='adbd'))reason(reasons,'PROCESS_REQUIRED_BASELINE');
 const old_producers=rows.filter(p=>/^(?:uiautomator|input|monkey)$/.test(p.name)||/(?:^|[\s/])(?:uiautomator|input|monkey)(?:\s|$)|com\.android\.commands\.(?:uiautomator|input|monkey)\./.test(p.args));
 const unresolved_shells=rows.filter(p=>/^(?:sh|bash|mksh)$/.test(p.name)&&(/^(?:sh|bash|mksh)$/.test(p.args)||/^(?:sh|bash|mksh) -c(?:\s|$)/.test(p.args)));
 return {rows,old_producers,unresolved_shells,inventory_complete:reasons.size===0,argv_source:'toybox-ps-args/observed',reasons:[...reasons]};
}
export function parseSdk31Input(value){
 const raw=text(value),reasons=new Set();if(raw===null)return {queue_idle:false,connections:0,reasons:['INPUT_ENCODING']};
 const starts=matches(raw,/^Input Dispatcher State:$/gm);if(starts.length!==1)return {queue_idle:false,connections:0,reasons:['INPUT_DISPATCHER_HEADER']};const body=raw.slice(starts[0].index);
 for(const [name,expected]of Object.entries({DispatchEnabled:'true',DispatchFrozen:'false',PendingEvent:'<none>',InboundQueue:'<empty>',TouchStates:'<no displays touched>',AppSwitch:'not pending','Pointer Capture Requested':'false','Current Window with Pointer Capture':'None'})){
  const found=matches(body,new RegExp('^  '+name+': (.*)$','gm'));if(found.length!==1||found[0][1]!==expected)reason(reasons,'INPUT_'+name.toUpperCase().replaceAll(' ','_'));
 }
 const block=body.match(/^  Connections:\n([\s\S]*?)^  AppSwitch:/m),ids=new Set();let connections=0;
 if(!block)reason(reasons,'INPUT_CONNECTIONS');else{
  const lines=block[1].trimEnd().split('\n');for(let i=0;i<lines.length;i+=3){const head=lines[i]?.match(/^    (\d+): channelName='[^\n]*', windowName='[^\n]*', status=NORMAL, monitor=(?:true|false), responsive=true$/);if(!head||ids.has(head[1])||lines[i+1]!=='      OutboundQueue: <empty>'||lines[i+2]!=='      WaitQueue: <empty>')reason(reasons,'INPUT_CONNECTION_QUEUE');else{ids.add(head[1]);connections++;}}
  if(!connections)reason(reasons,'INPUT_NO_CONNECTIONS');
 }
 for(const [pattern,accept,key]of [[/^\s+KeyDowns: (\d+) keys currently down$/gm,'0','KEYS'],[/^\s+Last (?:Raw|Cooked) Touch: pointerCount=(\d+)$/gm,'0','TOUCH'],[/^\s+(?:Last Raw Button State|Last Cooked Button State|ButtonState): (0x[0-9a-f]+)$/gm,'0x00000000','BUTTONS'],[/^\s+Down: (true|false)$/gm,'false','POINTER_DOWN']]){
  const found=matches(raw,pattern);if(!found.length||found.some(m=>m[1]!==accept))reason(reasons,'INPUT_READER_'+key);
 }
 // 实际SDK31 dump末段锚点，截断到某个空队列行不能冒充完整dump。
 if(!/^  Configuration:$/m.test(body)||!/^      mNumSkippedSlowEvents = \d+$/m.test(body))reason(reasons,'INPUT_TRAILER');
 return {queue_idle:reasons.size===0,connections,reasons:[...reasons]};
}
export function parseSdk31Activities(value){
 const raw=text(value),reasons=new Set();if(raw===null)return {records:0,records_idle:false,pending_launch:'not_attested',reasons:['ACTIVITY_ENCODING']};
 if(!/^ACTIVITY MANAGER ACTIVITIES \(dumpsys activity activities\)$/m.test(raw))reason(reasons,'ACTIVITY_HEADER');
 const records=matches(raw,/^\s*\* Hist #\d+: ActivityRecord\{([a-f0-9]+) [^\n]+\}$/gm),idle=matches(raw,/^\s+keysPaused=(true|false) inHistory=(true|false) idle=(true|false) mStartingWindowState=[A-Z_]+$/gm);
 if(!records.length||new Set(records.map(m=>m[1])).size!==records.length||records.length!==idle.length||idle.some(m=>m[1]!=='false'||m[3]!=='true'))reason(reasons,'ACTIVITY_RECORD_IDLE');
 const depth=matches(raw,/^  mVisibilityTransactionDepth=(\d+)$/gm);if(depth.length!==1||depth[0][1]!=='0')reason(reasons,'ACTIVITY_VISIBILITY_TRANSACTION');
 if(!/^    mResumedActivity: ActivityRecord\{/m.test(raw))reason(reasons,'ACTIVITY_RESUMED');
 return {records:records.length,records_idle:reasons.size===0,pending_launch:'not_attested',reasons:[...reasons]};
}
export function parseSdk31Diagnostics(bundle){
 if(bundle?.sdk!=='31\n')throw Object.assign(new Error('SDK31_REQUIRED'),{code:'SDK31_REQUIRED'});
 const processes=parseSdk31Processes(bundle.processes),input=parseSdk31Input(bundle.input),activities=parseSdk31Activities(bundle.activity),reasons=[...processes.reasons,...input.reasons,...activities.reasons,'PENDING_LAUNCH_NOT_ATTESTED','OLD_ROUTE_FENCE_NOT_ATTESTED'];
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\n$/.test(bundle.boot_id||''))reasons.push('BOOT_ID');if(processes.old_producers.length)reasons.push('OLD_REMOTE_PRODUCERS_PRESENT');if(processes.unresolved_shells.length)reasons.push('SHELL_CAUSAL_ORIGIN_UNRESOLVED');
 return {protocol:'device-epoch-fence-sdk31-components/v1',processes,input,activities,original_execution_stopped:false,remote_quiescence:'unknown',resource_authority:'not_attested',reasons};
}

export function consoleShellIsOutsideOldDomain({process,stat,status,cmdline,fds,wchan,controllerSourceSha256}){
 const fail=()=>{throw Object.assign(new Error('SDK31_CONSOLE_ORIGIN'),{code:'SDK31_CONSOLE_ORIGIN'});};
 if(controllerSourceSha256!=='b22cfc7d7a9d2e863be89c9e6af354e985083a8acdd56029f3da191c009d7fa6')fail();
 const m=stat?.match(/^(\d+) \(sh\) ([A-Z]) ([0-9 -]+)\n?$/);if(!m)fail();const fields=m[3].trim().split(/\s+/),pid=Number(m[1]);
 if(process?.pid!==pid||process.uid!==2000||process.ppid!==1||process.name!=='sh'||process.args!=='sh'||m[2]!=='S'||fields[0]!=='1'||fields[1]!==String(pid)||fields[2]!==String(pid)||!/^\d+$/.test(fields[3])||Number(fields[3])===0||fields[4]!==String(pid)||!/^\d+$/.test(fields[18])||cmdline!=='/system/bin/sh\0'||wchan?.trim()!=='wait_woken')fail();
 for(const [key,value]of Object.entries({Name:'sh',Tgid:String(pid),Pid:String(pid),PPid:'1',Uid:'2000\t2000\t2000\t2000',Threads:'1'})){const lines=status.split('\n').filter(l=>l.startsWith(key+':'));if(lines.length!==1||lines[0].slice(key.length+1).trim()!==value)fail();}
 const descriptors=fds.split('\n').filter(l=>l&&l!=='total 0').map(l=>l.match(/^l[^\s]+\s+\d+\s+shell\s+shell\s+\d+\s+\S+\s+\S+\s+(\d+) -> (\S+)$/));if(descriptors.length!==4||descriptors.some(x=>!x))fail();const map=Object.fromEntries(descriptors.map(m=>[m[1],m[2]]));if(Object.keys(map).sort().join(',')!=='0,1,10,2'||['0','1','2'].some(k=>map[k]!=='/dev/console')||map['10']!=='/dev/tty')fail();
 return {pid,ppid:1,uid:2000,session:pid,pgrp:pid,tty_nr:fields[3],start_ticks:fields[18],causal_exclusion:'init-console-descriptors-not-reachable-from-fixed-noninteractive-old-command-set'};
}

export function verifyConsoleProcessIdentity({excluded,stat,bootId,expectedBootId}){
 const m=stat?.match(/^(\d+) \(sh\) [A-Z] ([0-9 -]+)\n?$/),fields=m?.[2].trim().split(/\s+/);
 if(bootId!==expectedBootId||!m||Number(m[1])!==excluded?.pid||fields[18]!==excluded.start_ticks)throw Object.assign(new Error('FENCE_CONSOLE_IDENTITY_CHANGED'),{code:'FENCE_CONSOLE_IDENTITY_CHANGED'});
 return true;
}
