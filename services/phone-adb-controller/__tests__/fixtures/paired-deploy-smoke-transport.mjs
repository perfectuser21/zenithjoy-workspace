// Local-only transport for the paired input deployment smoke. Other deployment
// commands retain the existing record-only stub; paired inputs and fixed SQL evidence use isolated real files.
import {appendFileSync,copyFileSync,existsSync,mkdirSync,readFileSync,unlinkSync,writeFileSync,chmodSync,renameSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
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
 const deploy=readFileSync(new URL('../../deploy.sh',import.meta.url),'utf8');
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
export function transport(root,mode,args){
 root=resolve(root);const p=paths(root);const ok=stdout=>({status:0,stdout:stdout||'',stderr:''});
 try{
  if(mode==='scp'){
   appendFileSync(join(root,'scp.log'),args.join('\n')+'\n');const target=args.at(-1);
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
  appendFileSync(join(root,'ssh.log'),args.join(' ')+'\n');const [host,cmd]=args;
  if(args.at(-2)==='mmv'&&args.at(-1)==='set -a; source ~/.credentials/zenithjoy-db.env; set +a; cd ~/.openclaw/leadgen-scripts && node -'){
   const mode=process.env.PAIR_COMPANY_READINESS_MODE||'schema-ready';
   if(mode==='invalid-json')return ok('explicit-mock-invalid-inventory\n');
   const inventory=companyInventory();
   if(mode==='missing-schema')inventory.columns=inventory.columns.filter(c=>!(c.table_name==='company_config_runs'&&c.column_name==='task_inputs'));
   else if(mode!=='schema-ready')throw Error('unknown readiness fixture mode');
   return ok(JSON.stringify(inventory)+'\n');
  }
  const evidenceResult=sqlRemote(root,host,cmd);if(evidenceResult)return evidenceResult;
  if(host==='mmv'&&cmd==='python3'&&process.env.PAIR_DEPLOY_STOP_AT_ADMISSION==='1')return {status:3,stdout:'',stderr:'explicit fixture admission denied after readiness\n'};
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
   const child=spawn('sh',['-c',args.at(-1)],{stdio:'inherit',env:{...process.env,HOME:paths(resolve(root)).home}});
   process.exitCode=await new Promise(r=>child.on('close',r));
  }
  else if(command==='transport'){const r=transport(root,mode,args);process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status;}
  else throw Error('unknown fixture operation');
 }catch(e){console.error(e.message);process.exitCode=2;}
}
