// Authority is the conjunction of reviewed synchronous source semantics, this
// invocation's live outer-close fact, epoch admission and absence of sticky unknown.
// It never proves Android/ADB service termination or a recording client's close.
import {execInput,executionOuterReturned} from './leadgen-client.mjs';
import {createPhoneEpochGuard} from './phone-epoch-admission.mjs';
import {readFileSync,lstatSync,realpathSync,mkdirSync,symlinkSync,existsSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const key=v=>JSON.stringify(v);
const stopped=new WeakMap(),outerOnly=new WeakMap(),notStarted=new WeakMap();
const fail=(code,unknown=false)=>Object.assign(Error('OFFICIAL_CLI_'+code),{code:'OFFICIAL_CLI_'+code,executionStopped:!unknown,resourceUnknown:unknown,notStarted:!unknown});
const cli=new Set(['runtime-contract','preflight','status','foreground','window','outward-ledger','wake','unlock','open-app','account-current','snapshot-evidence','ui-evidence','close-app','return-safe-desktop','lock-acquire','lock-acquire-new','lock-refresh','lock-status','lock-release','lock-release-exact','lock-quarantine','open-search','search-time-layer','search-video-tab','search-video-cards','search-kw-matches','search-grid-scroll','back-to-results','back-evidence','tap-evidence','swipe-evidence','current-video-link','open-video','open-comments','commenter-identity','set-playback-speed','native-audio-evidence','detail-restored']);
const metadata=new Set(['runtime-contract','lock-acquire','lock-acquire-new','lock-refresh','lock-status','lock-release','lock-release-exact','lock-quarantine']);
const recording=new Set(['record-start','record-stop','record-status','record-extract-audio']);
const identity=(command,args,receipt,root,frozen)=>key({command,args,receipt,root,snapshot_sha256:frozen?.snapshot_sha256});
export const isOfficialCliOperationStopped=(result,{command,args,receipt,root,frozen}={})=>stopped.get(result)===identity(command,args,receipt,root,frozen);
export const isOfficialCliOuterReturned=(result,{command,args,receipt,root,frozen}={})=>outerOnly.get(result)===identity(command,args,receipt,root,frozen);
export const isOfficialCliInvocationNotStarted=(error,{command,args,receipt,root,frozen}={})=>notStarted.get(error)===identity(command,args,receipt,root,frozen);
export function describeOfficialCliInvocation({root,command,args,executables,profile,owner,serial}={}){
 if(!Array.isArray(args)||args.some(v=>typeof v!=='string'||v.includes('\0')||v.length>16000)||args.some(v=>['--outward','--allow-repeat'].includes(v)))throw fail('INVOCATION');
 const controller=join(root,'douyin-phone-adb');let argv;
 if(command===controller)argv=args;
 else if([executables?.zsh?.path,'/bin/zsh','zsh'].includes(command)&&args[0]==='-f'&&args[1]===controller)argv=args.slice(2);
 else if([executables?.python?.path,'python3'].includes(command)&&args.length===3&&args[0]===join(root,'adb-existing-route.py')&&args[1]===serial&&args[2]===join(root,'adb-managed-client.py'))return {kind:'route',binary:executables.python.path,args:[...args]};
 else if(command===join(root,'adb-managed-client.py')&&args[0]==='-s'&&args[1]===serial&&(['get-state'].includes(args[2])&&args.length===3||args.length===5&&args[2]==='shell'&&args[3]==='dumpsys'&&args[4]==='telephony.registry'))return {kind:'adb-read',binary:executables.python.path,args:[command,...args]};
 else throw fail('INVOCATION');
 if(argv[0]!=='--profile'||argv[1]!==profile)throw fail('PROFILE');let offset=2;
 if(argv[2]==='--lock-owner'){if(argv[3]!==owner)throw fail('OWNER');offset=4;}
 const operation=argv[offset];if(!cli.has(operation)&&!recording.has(operation))throw fail('UNREVIEWED_OPERATION');
 if(['status','window'].includes(operation)&&(offset!==2||argv.length!==3))throw fail('INVOCATION');
 if(operation==='outward-ledger'&&(offset!==2||argv.length!==4||argv[3]!==owner))throw fail('OWNER');
 if(metadata.has(operation)){const tail=argv.slice(offset+1);if(offset!==2||(['runtime-contract','lock-status'].includes(operation)?tail.length!==0:tail.length!==1||tail[0]!==owner))throw fail('OWNER');}
 return {kind:metadata.has(operation)?'local-metadata':recording.has(operation)?'recording-outer-only':'synchronous-cli',operation,binary:executables.zsh.path,args:['-f',controller,...argv]};
}
export function createOfficialCliClosure({root,env,frozen,binding,taskId,assertAdmission,scope}={}){
 if(realpathSync(root)!==dirname(fileURLToPath(import.meta.url))||!frozen||!/^([a-f0-9]{64})$/.test(frozen.snapshot_sha256||'')||frozen.agent_input?.task_id!==taskId||typeof binding?.run_id!=='string')throw fail('SCOPE');
 const f=structuredClone(frozen),base={...env},input=f.agent_input,spec=f.discovery_phone_scope||f.collection_phone_scope,executables=spec?.executables;
 if(spec?.run_id!==binding.run_id||spec?.policy?.schema_version!==2||!executables?.zsh||!executables?.node||!executables?.python)throw fail('PINNED_RUNTIME');
 const fixed={taskId,runId:binding.run_id,profile:input.profile,serial:input.serial,sourceCommit:f.deployment.source_commit,owner:input.run_tag,runDir:base.WFR_RUN_DIR};
 const slots=input.workflow_key==='douyin_video_discovery'?['preflight','collect_videos','cleanup']:input.workflow_key==='douyin_video_processing'?['preflight','dedup','qualification','collection','cleanup']:[];
 if(!slots.length||['profile','serial'].some(k=>spec[k]!==fixed[k])||input.profile!==base.P||input.serial!==base.SERIAL||input.run_tag!==base.WFR_TAG)throw fail('SCOPE');
 const state={},epoch=assertAdmission||createPhoneEpochGuard({root,env:base,frozen:f,state,deadlineMs:scope?.worker_deadline_ms});if(typeof epoch!=='function')throw fail('EPOCH');
 let sealed=false,unknown=false,ownedProtection;const pending=new Set();
 const protectionRoot=base.DOUYIN_PHONE_LOCK_ROOT||join(base.HOME,'.local/share/zenithjoy/phone-locks');
 const protectionIdentity=s=>{if(![s.dev,s.ino].every(Number.isSafeInteger)||s.uid!==process.getuid()||s.mode&0o022)throw fail('QUARANTINE_CAPTURE');return {dev:s.dev,ino:s.ino};};
 const readProtectionFile=path=>{const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=fstatSync(fd);if(!a.isFile()||a.size>4096)throw fail('QUARANTINE_CAPTURE');const raw=readFileSync(fd),b=fstatSync(fd);if(a.dev!==b.dev||a.ino!==b.ino||a.mtimeMs!==b.mtimeMs||a.size!==raw.length)throw fail('QUARANTINE_CAPTURE');return {identity:protectionIdentity(a),raw};}finally{closeSync(fd);}};
 const rememberProtection=()=>{
  if(ownedProtection)return;if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(fixed.serial)||!/^[-A-Za-z0-9_.]{1,150}$/.test(fixed.owner))throw fail('QUARANTINE_CAPTURE');
  const lock=join(protectionRoot,fixed.serial+'.lock');let owner;try{owner=readProtectionFile(join(lock,'owner'));}catch(error){if(error.code==='ENOENT')return;throw error;}if(owner.raw.toString().trim()!==fixed.owner)return;
  const r=lstatSync(protectionRoot),d=lstatSync(lock),g=readProtectionFile(join(protectionRoot,fixed.serial+'.guard'));if(!r.isDirectory()||r.isSymbolicLink()||realpathSync(protectionRoot)!==protectionRoot||!d.isDirectory()||d.isSymbolicLink())throw fail('QUARANTINE_CAPTURE');
  ownedProtection=Object.freeze({root:protectionRoot,serial:fixed.serial,owner:fixed.owner,task_id:fixed.taskId,run_id:fixed.runId,source_commit:fixed.sourceCommit,snapshot_sha256:f.snapshot_sha256,root_identity:protectionIdentity(r),lock_identity:protectionIdentity(d),guard_identity:g.identity,owner_identity:owner.identity,owner_sha256:sha(owner.raw)});
 };
 const activity=scope?.activity;if(!slots.includes(activity)||scope.task_id!==taskId||scope.run_id!==binding.run_id||scope.binding_id!==binding.id||scope.snapshot_sha256!==f.snapshot_sha256||scope.source_commit!==fixed.sourceCommit||scope.profile!==fixed.profile||scope.serial!==fixed.serial||scope.run!==fixed.owner||scope.workflow!==input.workflow_key||!Number.isSafeInteger(scope.deadline_ms)||scope.receipt_deadline_ms>=scope.deadline_ms||!Number.isSafeInteger(scope.worker_deadline_ms)||!Number.isSafeInteger(scope.receipt_deadline_ms)||scope.worker_deadline_ms>=scope.receipt_deadline_ms||Date.now()>=scope.worker_deadline_ms)throw fail('SCOPE');
 const deadline=scope.worker_deadline_ms;
 const bin=join(base.WFR_RUN_DIR,'official-cli-bin'+(activity?'-'+activity:''));mkdirSync(bin,{mode:0o700});
 const links={python3:executables.python,node:executables.node,zsh:executables.zsh},binIdentity=lstatSync(bin);
 for(const [name,program]of Object.entries(links)){if(existsSync(join(bin,name)))throw fail('PREVIOUS_SCOPE');symlinkSync(program.path,join(bin,name));}
 const verify=()=>{
  const st=lstatSync(bin);if(!st.isDirectory()||st.isSymbolicLink()||st.dev!==binIdentity.dev||st.ino!==binIdentity.ino||st.uid!==process.getuid()||(st.mode&0o777)!==0o700)throw fail('PINNED_RUNTIME');
  for(const [name,program]of Object.entries(links)){const path=join(bin,name),s=lstatSync(path);if(!s.isSymbolicLink()||s.uid!==process.getuid()||realpathSync(path)!==program.path)throw fail('PINNED_RUNTIME');}
  for(const [name,digest]of Object.entries(REVIEWED)){const path=join(root,name),s=lstatSync(path);const expected=Array.isArray(digest)?digest:[digest],actual=sha(readFileSync(path));if(!s.isFile()||s.isSymbolicLink()||![0,process.getuid()].includes(s.uid)||s.mode&0o022||!expected.includes(actual)||f.files['runtime/'+name]!==actual)throw fail('SOURCE');}
  for(const program of Object.values(executables)){const path=program.path,s=lstatSync(path);if(realpathSync(path)!==path||!s.isFile()||s.mode&0o022||sha(readFileSync(path))!==program.sha256)throw fail('PINNED_RUNTIME');}
 };
 const active=()=>{if(Date.now()>=deadline)throw fail('DEADLINE');if(sealed||unknown)throw fail('CLOSED',unknown);verify();};
 const admission=async({phase='execute',resourceOnly=false}={})=>{active();if(resourceOnly&&!assertAdmission)throw fail('LOCAL_AUTHORITY');if((await epoch({phase,resourceOnly,activity,task_id:taskId,run_id:binding.run_id}))?.authorized!==true)throw fail('EPOCH',true);active();};
 function receiptScope(receipt){if(!receipt||(!slots.includes(receipt.activity)||activity!==undefined&&receipt.activity!==activity)||Object.entries(fixed).some(([k,v])=>receipt[k]!==v)||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(receipt.operationId||''))throw fail('RECEIPT');return receipt;}
 function plan(command,args,options={}){
  active();const receipt=receiptScope(options.receipt);
  const marker=join(fixed.runDir,'native-operations',receipt.operationId+'.unknown');if(existsSync(marker)){unknown=true;throw fail('PREVIOUS_UNKNOWN',true);}
  try{return describeOfficialCliInvocation({root,command,args,executables,profile:fixed.profile,owner:fixed.owner,serial:fixed.serial});}
  catch(error){notStarted.set(error,identity(command,args,receipt,root,f));throw Object.assign(error,{executionStopped:true,externalEffect:'none'});}
 }
 async function execute(command,args,options={}){
  const invocation=plan(command,args,options),receipt=structuredClone(options.receipt),request=identity(command,args,receipt,root,f),marker=join(fixed.runDir,'native-operations',receipt.operationId+'.unknown');
  let dispatched=false;
  const operation=(async()=>{
   await admission({phase:'before',resourceOnly:invocation.kind==='local-metadata'});
   const clean={...base,...options.env,PATH:bin+':/usr/bin:/bin:/usr/sbin:/sbin',ZDOTDIR:bin,ENV:'',BASH_ENV:'',DOUYIN_BYPASS_REPORT:'off',DOUYIN_PHONE_ADB:join(root,'douyin-phone-adb'),DOUYIN_ADB_BIN:join(root,'adb-managed-client.py'),DOUYIN_PYTHON_BIN:executables.python.path,DOUYIN_LOCATE_SCRIPT:join(root,'locate-element.py'),DOUYIN_CURL_BIN:'/usr/bin/curl',DOUYIN_SIPS_BIN:'/usr/bin/sips',WFR_NATIVE_UNKNOWN_FILE:marker,DOUYIN_PHONE_LOCK_ROOT:protectionRoot,P:fixed.profile,SERIAL:fixed.serial,WFR_TAG:fixed.owner,WFR_RUN_DIR:fixed.runDir};
   for(const name of Object.keys(clean))if(/^(?:DYLD_|LD_|PYTHON|NODE_OPTIONS$|NODE_PATH$)/.test(name)||['DOUYIN_LOCK_GUARDED','DOUYIN_LOCK_GUARD_FD','DOUYIN_BYPASS_REPORT_BIN'].includes(name))delete clean[name];
   if(clean.DOUYIN_PHONE_LOCK_TEST_MODE==='1')throw fail('TEST_ENV');
   if(!Number.isFinite(options.timeoutMs??180000)||(options.timeoutMs??180000)<=0)throw fail('DEADLINE');
   clean.PYTHONNOUSERSITE='1';clean.PYTHONSAFEPATH='1';
   const actual={...options,env:clean,receipt,timeoutMs:Math.min(options.timeoutMs??180000,300000,deadline-Date.now())};
   dispatched=true;const result=await execInput(invocation.binary,invocation.args,actual);
   if(!executionOuterReturned(result,invocation.binary,invocation.args,receipt)||!Number.isInteger(result.code)||existsSync(marker)||/NATIVE_INNER_EXECUTION_TERMINATION_UNKNOWN|RECORD_CAPTURE_EXIT_UNVERIFIED/.test(result.stderr||''))throw fail('STOP_UNKNOWN',true);
   if(result.code===0&&['lock-acquire','lock-acquire-new','lock-refresh','lock-status'].includes(invocation.operation))rememberProtection();
   await admission({phase:'after',resourceOnly:invocation.kind==='local-metadata'});outerOnly.set(result,request);if(invocation.kind!=='recording-outer-only')stopped.set(result,request);return result;
  })();pending.add(operation);
  try{return await operation;}catch(error){if(dispatched||error.resourceUnknown||error.executionStopped===false||!error.notStarted)unknown=true;throw error;}finally{pending.delete(operation);}
 }
 async function quarantine(...args){
  if(args.length)throw fail('QUARANTINE_SCOPE');if(!ownedProtection)return {verified:false,not_owned:true,physical_actions:0};verify();
  const command='/usr/bin/sandbox-exec',argv=['-p','(version 1)(allow default)(deny process-fork)',executables.python.path,'-I','-S',join(root,'official-cli-quarantine.py')],result=await execInput(command,argv,{input:JSON.stringify(ownedProtection),timeoutMs:20000,env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8'}});
  if(!executionOuterReturned(result,command,argv)||result.code!==0)throw fail('QUARANTINE_UNKNOWN',true);verify();let proof;try{proof=JSON.parse(result.stdout);}catch{throw fail('QUARANTINE_READBACK',true);}
  if(proof.verified!==true||proof.owner!==fixed.owner||proof.task_id!==fixed.taskId||proof.run_id!==fixed.runId||proof.source_commit!==fixed.sourceCommit||proof.snapshot_sha256!==f.snapshot_sha256||proof.lock_dev!==ownedProtection.lock_identity.dev||proof.lock_ino!==ownedProtection.lock_identity.ino||proof.physical_actions!==0||proof.local_protection_only!==true)throw fail('QUARANTINE_READBACK',true);
  return Object.freeze(proof);
 }
 const snapshot=()=>Object.freeze({domain:'official-cli-synchronous/v1',sealed,pending:pending.size,unknown,execution_unknown:unknown,execution_stopped:sealed&&!unknown&&!pending.size});
 return Object.freeze({plan,execute,snapshot,quarantine,prepare:async()=>{await admission({phase:'prepare',resourceOnly:true});rememberProtection();return true;},close:async()=>{sealed=true;if(pending.size)await Promise.allSettled([...pending]);return snapshot();}});
}

// 独立兼容复核 /root/direct_tool_audit，报告sha256 06bcb8180338968a233e7b663d0eb3039138b5ab25f4f0d17637f4f85da6d587；仅追加已核controller/locate摘要，原同步调用边界不变。
// ADB失败码独立审核 /root/direct_tool_audit：58933f9d26a8463ec91fef76837657dfdaa4a61ff00cc02ff520f0269378f901；仅追加有限拒绝错误码版本。
// 锁/独立宿主新字节复核 /root/direct_tool_audit：a4ecd935198c68d037b9de43159217acc906cf93b7c3cda27ae8ad60f2836340；只追加受审精确摘要。
// Reviewed baseline: 1d46b5d72; eda2ea5cd controller adds recording-only observer hooks. Only the finite synchronous call graph above is admitted.
// 路由兼容独立复核 /root/review_direct_skill：6abe05bf505bfb46acab1199e74ca6a97d5d9f9bff88c6d00281f726066b01d8；仅追加受审精确摘要。
const REVIEWED=Object.freeze({
 "official-cli-quarantine.py": "f31a63a4f1e70248cf25482f4c6788fafd5c1d46d786d5e3e3eeb204e06fb36b",
 "douyin-phone-adb": ["b22cfc7d7a9d2e863be89c9e6af354e985083a8acdd56029f3da191c009d7fa6","6d10d9bc8f23f65da687b51ed1c88ef4f20d61985d8ed2e75c2b603d3257d52d","0b32e528f60423e8ed1b85e02b0ba29d3189170ff0d9a8f5e5b8a751ba5bc8a7","b1aa3013537c1ebc0b8aafb73b32e82f8f00999c1713aad92b240f629da9140b"],
 "phone-lock-lib.sh": ["ed2840ffbd5ded0aaa2b142a4b14405946610575536a55740c38247d5c440271","5205364871b13a65e47529796e4de56807bd729255336298a33a9a580cb38b88"],
 "phone-lock-helper.py": ["36d705de51e84a04c24db80e9417912959f27fa6d61513f6165b9760d5b59bcd","c89bb223302dbd5b9bc16cae24f41f6d87398fc9f688e5ee572280b88d4fe0c6"],
 "phone-lock-root.py": "3c0dc46c221e80ae220c1174709a9cc6c9d47dfa3702ed6726d52a626a20f48a",
 "adb-existing-route.py": ["98ca76d799deb74cc1481346967f8ab1a14aa99dd28c7eea2d7865c591eb24d4","925a65843cdfd53e76d82ceffa5651d972a20f03b6876ff633699261c06fe6ae"],
 "adb-managed-client.py": "9cc3bad30042910b1c36c5f8ce17d5402209fa42e5b130a7a29f0e5bf2316910",
 "adb-host-instance-policy.py": ["dee7a72876b6193535fc5a4ddb3406e7b113c7ddc75e745bf91d450bac807d18","5cd8e7ae7025c35ad76d674368fb53859c7db81679d8506777374bab3f556182","63fea420bc5f6b19e8cefc21de7e0972cfae93bf6e894eed3a8d2f2b451f7b0f"],
 "search-video-tab.py": "7a6a56ebe141dcdaa675735a196004df5e4728534f4f33801fce3b7250c89e04",
 "locate-element.py": ["b1a7db0809d00c99329118552f565fdb2d8b68a23874f9c76dc5db558234bfa0", "599aa29a51c0d3f6a7a219166b57013b03c3f528e53bb29e14822839eb300e76"],
 "clipboard-widget-cancel.py": "9a1fd636f1600acec3179c6d61955f6c290a6678ff54902a4407bcd36d350980",
 "comment-count-evidence.py": "0c1d643574c39ee242ec551144513c18ee5921d42e22ad8e31f7041ddfc985e8",
 "queued-comment-history.js": "18ae229e033fb18245d45fc2ff15e866cd05434ac757b020bf61b2c15522b202",
 "queued-recipient-evidence.js": "ebef5429095a34d5a15b7629fe34585fa28c0c695a7c763fd224bfa456d20192",
 "nickname-match-lib.js": "3306d98086e144838470070c74437206a8f82ba4e729bf2a0c876dbca7bbe4a7",
 "line-routes.js": "417a41a1b6ad29837b1ae8499278b608f86aa37642da903b3d0756b092d9ac01",
 "lead-fields-lib.js": "22d9c8d15e9e024e4110ede58e7c134762b873c14db3a08c6031ab16e1499f5a",
 "own-accounts-lib.js": "5493baf14fe40df067872b1d4000b28076e64a9cce1585982dd64bd1daafb4c7",
 "text-input-focus.py": "2918eaacad5a16eb712d82df5db137bec1bd6a0af8a2d8c6b920b7724b91a70f"
});
