// Exact legacy-driver argv adapter. IO is supplied only by the Code factory;
// this adapter cannot attest phone stop or manufacture RECV provenance.
import {constants,openSync,closeSync,lstatSync,fstatSync,realpathSync,writeFileSync,fsyncSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
const pkg='com.ss.android.ugc.aweme',uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const remotePattern=new RegExp('^/sdcard/preflight-('+uuid+')\\.(xml|png)$');
const fail=code=>Object.assign(Error('NATIVE_PREFLIGHT_ADAPTER_'+code),{code:'NATIVE_PREFLIGHT_ADAPTER_'+code});
export function createNativePhonePreflightAdapter({context,io,hostAdb}={}){
 const q=structuredClone(context);
 if(!q||!/^[-A-Za-z0-9_.]{1,80}$/.test(q.owner||'')||q.owner==='.'||q.owner==='..'||!['preflight','cleanup'].includes(q.purpose)||!Number.isSafeInteger(q.width)||q.width<1||!Number.isSafeInteger(q.height)||q.height<1||!Number.isSafeInteger(q.deadlineMs)||Date.now()>=q.deadlineMs||typeof hostAdb!=='function'||typeof io?.command!=='function'||typeof io?.readEvidence!=='function')throw fail('SCOPE');
 if(typeof q.evidenceRoot!=='string'||resolve(q.evidenceRoot)!==q.evidenceRoot||realpathSync(q.evidenceRoot)!==q.evidenceRoot)throw fail('ROOT');
 const root=lstatSync(q.evidenceRoot),remotes=new Map();let unknown=false,busy=false,sealed=false;
 const rootCurrent=()=>{const st=lstatSync(q.evidenceRoot);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||(st.mode&0o022)||st.dev!==root.dev||st.ino!==root.ino||realpathSync(q.evidenceRoot)!==q.evidenceRoot)throw fail('ROOT');};rootCurrent();
 const active=()=>{if(sealed||unknown||Date.now()>=q.deadlineMs)throw fail(unknown?'UNKNOWN':'CLOSED');rootCurrent();};
 const integer=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,5})$/.test(value);
 const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 const absent=path=>{try{lstatSync(path);}catch(error){if(error.code==='ENOENT')return;throw error;}throw fail('EXISTS');};
 function parse(args){
  if(args.some(arg=>typeof arg!=='string'))throw fail('ARGV');
  if(equal(args,['version'])||equal(args,['get-state']))return {host:true};
  if(args[0]==='pull'&&args.length===3){
   const [_,remote,path]=args,entry=remotes.get(remote),name=basename(path);
   if(!entry||entry.state!=='ready'||dirname(path)!==q.evidenceRoot||resolve(path)!==path||!name.startsWith(q.owner+'-'))throw fail('PULL_SCOPE');
   const pattern=entry.ext==='xml'?new RegExp('^[-A-Za-z0-9_.]{1,160}-'+uuid+'\\.xml$'):new RegExp('^[-A-Za-z0-9_.]{1,160}\\.png\\.'+uuid+'\\.tmp$');
   if(!pattern.test(name))throw fail('PULL_SCOPE');absent(path);return {pull:true,remote,path,entry};
  }
  const forms=[
   [['shell','getprop','ro.product.model'],'model'],[['shell','dumpsys','telephony.registry'],'telecom'],
   [['shell','dumpsys','window','displays'],'foreground'],[['shell','dumpsys','window'],'window'],
   [['shell','input','keyevent','224'],'wake','preflight'],[['shell','wm','dismiss-keyguard'],'unlock','preflight'],
   [['shell','monkey','-p',pkg,'-c','android.intent.category.LAUNCHER','1'],'open-app','preflight'],
   [['shell','am','force-stop',pkg],'close-app','cleanup'],
   [['shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],'home-resolve','cleanup'],
  ];
  for(const [argv,operation,purpose]of forms)if(equal(args,argv)){if(purpose&&purpose!==q.purpose)throw fail('PURPOSE');return {operation,args:[]};}
  if(equal(args,['shell','input','keyevent','3'])&&q.purpose==='cleanup')return {operation:'keyevent',args:['3']};
  if(args.length===5&&equal(args.slice(0,3),['shell','input','tap'])&&q.purpose==='preflight'&&integer(args[3])&&integer(args[4])&&Number(args[3])<q.width&&Number(args[4])<q.height)return {operation:'tap',args:args.slice(3)};
  if(args.length===4&&(equal(args.slice(0,3),['shell','uiautomator','dump'])||equal(args.slice(0,3),['shell','screencap','-p']))){
   const remote=args[3],match=remotePattern.exec(remote),ext=args[1]==='uiautomator'?'xml':'png';
   if(!match||match[2]!==ext||remotes.has(remote))throw fail('REMOTE_SCOPE');
   return {operation:ext==='xml'?'dump-file':'screenshot-file',args:[remote],remote,ext};
  }
  throw fail('ARGV');
 }
 const adb=async(...args)=>{
  active();if(busy)throw fail('BUSY');const operation=parse(args);busy=true;
  try{
   active();
   if(operation.host){const text=await hostAdb(...args);active();if(typeof text!=='string')throw fail('HOST_RESULT');return text;}
   if(operation.pull){
    operation.entry.state='consumed';let bytes;
    try{bytes=await io.readEvidence(operation.remote);}catch(error){unknown=true;throw error;}
    active();if(!Buffer.isBuffer(bytes)||bytes.length>(operation.entry.ext==='xml'?5:12)*1024*1024){unknown=true;throw fail('RECV');}
    absent(operation.path);let fd,parent;
    try{parent=openSync(q.evidenceRoot,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);const st=fstatSync(parent);if(st.dev!==root.dev||st.ino!==root.ino)throw fail('ROOT');
     fd=openSync(operation.path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);rootCurrent();const file=fstatSync(fd);if(!file.isFile()||file.nlink!==1||file.uid!==process.getuid()||(file.mode&0o777)!==0o600)throw fail('FILE');writeFileSync(fd,bytes);fsyncSync(fd);fsyncSync(parent);rootCurrent();
    }finally{if(fd!==undefined)closeSync(fd);if(parent!==undefined)closeSync(parent);}
    return `${operation.remote}: 1 file pulled.\n`;
   }
   if(operation.remote)remotes.set(operation.remote,{ext:operation.ext,state:'reserved'});
   let result;try{result=await io.command(operation.operation,operation.args);}catch(error){unknown=true;throw error;}
   active();if(result?.reviewed_command_returned!==true||!Number.isSafeInteger(result.code)||!Buffer.isBuffer(result.stdout)||!Buffer.isBuffer(result.stderr)){unknown=true;throw fail('COMMAND_RESULT');}
   if(result.code!==0)throw fail('COMMAND_EXIT');
   if(operation.remote)remotes.get(operation.remote).state='ready';return result.stdout.toString('utf8');
  }finally{busy=false;}
 };
 return Object.freeze({adb,seal:()=>{sealed=true;},snapshot:()=>Object.freeze({sealed,unknown,pending:busy?1:0,remote_execution_stopped:'not_attested'})});
}
