// Local-only transport for the paired input deployment smoke. Other deployment
// commands retain the existing record-only stub; paired inputs and fixed SQL evidence use isolated real files.
import {appendFileSync,copyFileSync,existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync,chmodSync,renameSync,realpathSync} from 'node:fs';
import {basename,dirname,join,resolve} from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const self=fileURLToPath(import.meta.url);
const digest=b=>createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const paths=root=>({stage:join(root,'input-runtime-deploy.fixture'),home:join(root,'remote'),registry:join(root,'remote/registry.tsv'),locks:join(root,'remote/locks'),receipt:join(root,'pair-receipt.json')});
export function prepare(root){
 root=resolve(root);const p=paths(root);
 for(const d of [root,p.stage,p.home,join(p.home,'bin-harvest'),join(p.home,'.local/bin'),p.locks])mkdirSync(d,{recursive:true,mode:0o700});
 writeFileSync(p.registry,'profile\tserial\tmodel\nlegacy\tSER1\tm\na\tSER2\tm\nb\tSER3\tm\nc\tSER4\tm\n');
 for(const serial of ['SER1','SER2','SER3','SER4'])writeFileSync(join(p.locks,serial+'.guard'),'');
 for(const mode of ['ssh','scp'])writeFileSync(join(root,mode),`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(self)} transport ${quote(root)} ${mode} "$@"\n`,{mode:0o700});
 return p;
}
// 明示mock的PG catalog输入；生产evaluateCompanyReadiness负责给出结论。
function companyInventory(){
 const tables={tenant_company_profiles:{company_id:'uuid',tenant_id:'uuid',company_key:'text',wiki:'jsonb',runtime_config:'jsonb',config_status:'text',config_version:'integer',source_evidence:'jsonb'},company_config_versions:{company_id:'uuid',tenant_id:'uuid',version:'integer',snapshot:'jsonb'},company_config_runs:{company_id:'uuid',tenant_id:'uuid',run_id:'text',version:'integer',snapshot:'jsonb',task_inputs:'jsonb',source_run:'text'},leadgen_videos:{judgment_config:'jsonb'},leadgen_comments:{judgment_config:'jsonb'}};
 return {columns:Object.entries(tables).flatMap(([table_name,fields])=>Object.entries(fields).map(([column_name,data_type])=>({table_name,column_name,data_type}))),indexes:[{tablename:'company_config_runs',indexdef:'CREATE UNIQUE INDEX fixture_run_key ON zenithjoy.company_config_runs (company_id, run_id)'}],triggers:['immutable_company_run','immutable_company_version'].map(tgname=>({tgname,tgenabled:'O'})),profiles:[]};
}
const sqlSource='apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql';
const sqlName=basename(sqlSource);
const sqlTargets=[['xian-m4','~/bin-harvest'],['mmv','~/bin-harvest'],['mmv','~/.openclaw/leadgen-scripts']];
function sqlTarget(root,host,base){
 if(!sqlTargets.some(([h,b])=>h===host&&b===base))throw Error('unexpected SQL evidence target');
 const home=host==='xian-m4'?paths(root).home:join(root,'remote-mmv');
 mkdirSync(home,{recursive:true,mode:0o700});
 return {home,directory:join(home,base.slice(2),'release-evidence')};
}
function sqlRemote(root,host,cmd){
 if(!cmd?.includes('release-evidence'))return null;
 // Only the two exact reviewed Python fragments from the real installer may execute.
 // No arbitrary SSH shell command is passed to a local shell.
 const deploy=readFileSync(new URL('../../deployment-functions.sh',import.meta.url),'utf8');
 const section=deploy.slice(deploy.indexOf('deploy_release_evidence() {'),deploy.indexOf('# Commander 入口'));
 const codes=[...section.matchAll(/python3 -c '([^']+)'/g)].map(m=>m[1].replaceAll('\\"','"'));
 if(codes.length!==3)throw Error('SQL evidence production commands changed');
 for(const [expectedHost,base] of sqlTargets){
  if(host!==expectedHost)continue;
  const directory=base+'/release-evidence',stage=directory+'/.'+sqlName+'.deploy-new',file=directory+'/'+sqlName;
  if(cmd===`python3 -c '${codes[1]}' ${directory}`||cmd===`python3 -c '${codes[2]}' ${file}`){
   const target=sqlTarget(root,host,base),isDirectory=cmd.endsWith(' '+directory);
   const r=spawnSync('python3',['-c',codes[isDirectory?1:2],isDirectory?target.directory:join(target.directory,sqlName)],{encoding:'utf8',env:{...process.env,HOME:target.home}});
   return {status:r.status??2,stdout:r.stdout||'',stderr:r.stderr||''};
  }
  if(cmd===`chmod 600 ${stage} && mv -f ${stage} ${file}`){
   const target=sqlTarget(root,host,base),staged=join(target.directory,'.'+sqlName+'.deploy-new');
   chmodSync(staged,0o600);renameSync(staged,join(target.directory,sqlName));
   return {status:0,stdout:'',stderr:''};
  }
 }
 throw Error('unexpected SQL evidence remote command');
}
// New ordinary payload commands execute only through the reviewed local M4 fixture.
function m4Batch(root,mode,args){
 const canonicalRoot=realpathSync(root);
 const safeStage=v=>dirname(v)===canonicalRoot&&/^m4-payload-deploy\.[A-Za-z0-9]+$/.test(basename(v));
 let matched=false;
 if(mode==='ssh'&&args[0]==='xian-m4'){
  const cmd=args[1];
  if(cmd==='mktemp -d /tmp/m4-payload-deploy.XXXXXX')matched=true;
  else if(cmd?.includes('/m4-payload-deploy.')){
   const install=cmd.match(/^python3 (\S+)\/deployment-m4-payload\.py install (\S+)\/payload\.tar ([a-f0-9]{64}) (before|after) ([01])$/);
   const cleanup=cmd.match(/^rm -f (\S+)\/deployment-m4-payload\.py (\S+)\/payload\.tar; rmdir (\S+)$/);
   matched=!!(install&&install[1]===install[2]&&safeStage(install[1])||cleanup&&cleanup[1]===cleanup[2]&&cleanup[1]===cleanup[3]&&safeStage(cleanup[1]));
   if(!matched)throw Error('unexpected M4 batch command');
  }
 }else if(mode==='ssh'&&args[1]?.includes('/m4-payload-deploy.'))throw Error('unexpected M4 batch host');
 else if(mode==='scp'&&args.at(-1)?.includes('/m4-payload-deploy.')){
  const destination=args.at(-1),stage=destination.slice('xian-m4:'.length,-1);
  matched=args.length===5&&args[0]==='-q'&&args[1]==='-p'&&destination.startsWith('xian-m4:')&&destination.endsWith('/')&&safeStage(stage)
   &&basename(args[2])==='payload.tar'&&args[3]===fileURLToPath(new URL('../../deployment-m4-payload.py',import.meta.url));
  if(!matched)throw Error('unexpected M4 batch upload');
 }
 if(!matched)return null;
 if(mode==='ssh'&&args.length!==2)throw Error('unexpected M4 batch SSH argv');
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('./m4-deploy-transport.mjs',import.meta.url)),canonicalRoot,mode,...args],{encoding:'utf8',env:process.env});
 return {status:r.status??2,stdout:r.stdout||'',stderr:r.stderr||''};
}
export function transport(root,mode,args){
 root=resolve(root);const p=paths(root);const ok=stdout=>({status:0,stdout:stdout||'',stderr:''});
 try{
  if(mode==='scp'){
   appendFileSync(join(root,'scp.log'),args.join('\n')+'\n');const batch=m4Batch(root,mode,args);if(batch)return batch;const target=args.at(-1);
   if(target.includes('release-evidence/')){
    const matched=sqlTargets.find(([host,base])=>target===`${host}:${base}/release-evidence/.${sqlName}.deploy-new`);
    if(!matched||args.at(-2)!==resolve(fileURLToPath(new URL('../../../../',import.meta.url)),sqlSource))throw Error('unexpected SQL evidence upload');
    const t=sqlTarget(root,...matched);copyFileSync(args.at(-2),join(t.directory,'.'+sqlName+'.deploy-new'));
    return ok();
   }
   if(target.startsWith(`xian-m4:${p.stage}`)){
    const destination=target.slice('xian-m4:'.length);
    const sources=args.slice(0,-1).filter(a=>!a.startsWith('-'));
    if(![p.stage+'/',join(p.stage,'input-runtime-release.py')].includes(destination))throw Error('unexpected paired upload destination');
    for(const source of sources){
     const name=basename(source);if(!['input-runtime-release.py','douyin-phone-adb','text-input-focus.py'].includes(name))throw Error('unexpected paired source');
     copyFileSync(source,join(p.stage,name));
    }
   }
   return ok(); // Legacy, unrelated deployment uploads remain record-only.
  }
  if(mode!=='ssh')throw Error('unknown transport');
  appendFileSync(join(root,'ssh.log'),args.join(' ')+'\n');const batch=m4Batch(root,mode,args);if(batch)return batch;const [host,cmd]=args;
  if(args.at(-2)==='mmv'&&args.at(-1)==='set -a; source ~/.credentials/zenithjoy-db.env; set +a; cd ~/.openclaw/leadgen-scripts && node -'){
   const mode=process.env.PAIR_COMPANY_READINESS_MODE||'schema-ready';
   if(mode==='invalid-json')return ok('explicit-mock-invalid-inventory\n');
   const inventory=companyInventory();
   if(mode==='missing-schema')inventory.columns=inventory.columns.filter(c=>!(c.table_name==='company_config_runs'&&c.column_name==='task_inputs'));
   else if(mode!=='schema-ready')throw Error('unknown readiness fixture mode');
   return ok(JSON.stringify(inventory)+'\n');
  }
  const evidenceResult=sqlRemote(root,host,cmd);if(evidenceResult)return evidenceResult;
  if(host==='xian-m4'&&cmd==='mktemp -d /tmp/input-runtime-deploy.XXXXXX')return ok(p.stage+'\n');
  if(cmd?.includes(p.stage)){
   if(host!=='xian-m4')throw Error('unexpected paired host');
   if(cmd.startsWith('rm -f '))return ok(); // Retain our temporary originals until caller audit/cleanup.
   const script=join(p.stage,'input-runtime-release.py'),expected=join(p.stage,'expected.json');
   let argv;
   if(cmd===`python3 ${script} capture ~/bin-harvest ~/.local/bin > ${expected}`){
    if(existsSync(p.receipt))unlinkSync(p.receipt);
    argv=[script,'capture',join(p.home,'bin-harvest'),join(p.home,'.local/bin')];
    const r=spawnSync('python3',argv,{encoding:'utf8'});
    if(r.status===0)writeFileSync(expected,r.stdout);
    return {status:r.status??2,stdout:'',stderr:r.stderr||''};
   }
   if(existsSync(p.receipt))unlinkSync(p.receipt);
   if(cmd!==`python3 ${script} install ${p.stage}/douyin-phone-adb ${p.stage}/text-input-focus.py ${expected} ~/.config/openclaw/douyin-phone-profiles.tsv /private/tmp/openclaw-phone/locks ~/bin-harvest ~/.local/bin`)throw Error('unexpected paired install command/destination');
   argv=[script,'install',join(p.stage,'douyin-phone-adb'),join(p.stage,'text-input-focus.py'),expected,p.registry,p.locks,join(p.home,'bin-harvest'),join(p.home,'.local/bin')];
   const r=spawnSync('python3',argv,{encoding:'utf8'});
   if(r.status===0){
    // Receipt exists only after the real source/revision/CAS/kernel guard and pair readback.
    const hashes=Object.fromEntries(['douyin-phone-adb','text-input-focus.py'].map(n=>[n,digest(readFileSync(join(p.stage,n)))]));
    writeFileSync(p.receipt,JSON.stringify({status:'verified',host,remote_dirs:['~/bin-harvest','~/.local/bin'],hashes,installer_result:JSON.parse(r.stdout)}));
   }
   return {status:r.status??2,stdout:r.stdout||'',stderr:r.stderr||''};
  }
  return ok(); // No real SSH invocation or execution of unrelated remote shell text.
 }catch(e){return {status:2,stdout:'',stderr:e.message+'\n'};}
}
export function verify(root){
 const p=paths(resolve(root));if(!existsSync(p.receipt))throw Error('paired deployment not verified');
 const receipt=JSON.parse(readFileSync(p.receipt,'utf8'));
 if(receipt.status!=='verified'||receipt.host!=='xian-m4'||JSON.stringify(receipt.remote_dirs)!==JSON.stringify(['~/bin-harvest','~/.local/bin']))throw Error('paired deployment not verified');
 for(const dir of ['bin-harvest','.local/bin'])for(const name of ['douyin-phone-adb','text-input-focus.py']){
  if(digest(readFileSync(join(p.home,dir,name)))!==receipt.hashes[name])throw Error('paired runtime readback mismatch');
 }
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===self){
 try{
  const [command,root,mode,...args]=process.argv.slice(2);
  if(command==='prepare')prepare(root);
  else if(command==='verify')console.log(JSON.stringify(verify(root)));
  else if(command==='transport'&&mode==='ssh'&&args.at(-1)?.startsWith('python3 -u -c ')){
   // 执行真实内核部署锁与流式握手，HOME指向隔离远端目录。
   const home=paths(resolve(root)).home;
   if(process.env.PAIR_DEPLOY_STOP_AT_ADMISSION==='1'){
    // A real unresolved original run must be rejected by the production consumer.
    const busy=join(home,'wf-agent-runs/fixture-unresolved');mkdirSync(busy,{recursive:true});
    writeFileSync(join(busy,'runtime.json'),JSON.stringify({phase:'blocked',execution_stopped:false}));writeFileSync(join(busy,'.worker.lock'),'');
    writeFileSync(join(busy,'cleanup.json'),JSON.stringify({_shell:{files:[]}}));
   }
   // Only this modeled remote guard receives its own process inventory.
   const census=join(resolve(root),'remote-census');mkdirSync(census,{mode:0o700});
   const status=process.env.PAIR_DEPLOY_ACTIVE_CENSUS==='1'?0:1;
   writeFileSync(join(census,'pgrep'),`#!/bin/sh\nexec ${quote(process.execPath)} -e 'const fs=require("node:fs");const args=process.argv.slice(1),expected=["-f","[w]f-agent-run.sh|[w]f-v2.py worker"];if(JSON.stringify(args)!==JSON.stringify(expected))throw Error("unexpected fixture census arguments");fs.appendFileSync(process.env.PAIR_CENSUS_LOG,JSON.stringify({args,status:Number(process.env.PAIR_CENSUS_STATUS)})+"\\n");process.exit(Number(process.env.PAIR_CENSUS_STATUS));' -- "$@"\n`,{mode:0o700});
   const child=spawn('sh',['-c',args.at(-1)],{stdio:['pipe','inherit','inherit'],env:{...process.env,HOME:home,PATH:census+':'+process.env.PATH,PAIR_CENSUS_LOG:join(resolve(root),'remote-census.log'),PAIR_CENSUS_STATUS:String(status)}});
   process.stdin.on('data',data=>appendFileSync(join(resolve(root),'admission.log'),data));process.stdin.pipe(child.stdin);
   process.exitCode=await new Promise(r=>child.on('close',r));
  }
  else if(command==='transport'){const r=transport(root,mode,args);process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;}
  else throw Error('unknown fixture operation');
 }catch(e){console.error(e.message);process.exitCode=2;}
}
