/** Trusted tooling reads pinned skill Git objects; never execute a candidate loader. */
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,realpathSync,existsSync,lstatSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const fail=code=>{throw Object.assign(Error(code),{code});};
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
const profileFor={ 'perfectuser21/zenithjoy-workspace':'zenithjoy','perfectuser21/cecelia':'cecelia' };
function environment(){
 const env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_')||key==='SKILLS_SOURCE_SSH_KEY')delete env[key];
 return {...env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};
}
const git=(root,...args)=>execFileSync('git',['--no-replace-objects','-C',root,...args],{env:environment(),maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],timeout:60000});
let cache;
function sourceCache(){
 if(!cache){cache=mkdtempSync(join(tmpdir(),'implementation-skills-'));process.once('exit',()=>rmSync(cache,{recursive:true,force:true}));}
 return join(cache,'objects');
}
function ensureSource(source,revision){
 try{git(source,'cat-file','-e',`${revision}^{commit}`);return;}catch{}
 mkdirSync(source,{recursive:true});git(source,'init','-q');
 const env=environment();let remote='https://github.com/perfectuser21/zenithjoy-skills.git';
 const key=process.env.SKILLS_SOURCE_SSH_KEY;
 const auth=mkdtempSync(join(tmpdir(),'implementation-skills-auth-'));
 try{
  if(key){
   const identity=join(auth,'key'),hosts=join(auth,'known_hosts');
   writeFileSync(identity,key.trimEnd()+'\n',{mode:0o600});
   writeFileSync(hosts,'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n');
   env.GIT_SSH_COMMAND=`ssh -F /dev/null -i "${identity}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${hosts}"`;
   remote='git@github.com:perfectuser21/zenithjoy-skills.git';
  }
  execFileSync('git',['--no-replace-objects','-C',source,'fetch','--quiet','--depth=1',remote,revision],{env,stdio:['ignore','pipe','pipe'],timeout:60000});
 }finally{rmSync(auth,{recursive:true,force:true});}
}
export function readImplementationSource(root,revision,path,{source}={}){
 if(!/^[0-9a-f]{40}$/.test(revision)||typeof path!=='string'||!path||path.startsWith('/')||path.split('/').some(v=>!v||v==='.'||v==='..')||path.includes('\\'))fail('SKILL_SOURCE_INPUT_INVALID');
 const entry=git(root,'ls-tree','-z',revision,'--',path).toString();
 if(entry){
  if(!/^(100644|100755) blob [0-9a-f]+\t/.test(entry))fail('SKILL_SOURCE_NOT_REGULAR_FILE');
  return git(root,'show',`${revision}:${path}`);
 }
 const remote=git(root,'remote','get-url','origin').toString().trim();
 const repo=remote.replace(/^https:\/\/github\.com\//,'').replace(/^git@github\.com:/,'').replace(/\.git$/,'');
 if(!profileFor[repo])fail('SKILL_SOURCE_REPO_INVALID');
 let lock;try{lock=JSON.parse(git(root,'show',`${revision}:.skills-source.json`));}catch{fail('SKILL_SOURCE_LOCK_MISSING');}
 if(Object.keys(lock).sort().join(',')!=='loader_sha256,profile,repository,revision,version'||lock.version!==1||lock.repository!=='perfectuser21/zenithjoy-skills'||!/^[0-9a-f]{40}$/.test(lock.revision)||!/^[0-9a-f]{64}$/.test(lock.loader_sha256))fail('SKILL_SOURCE_LOCK_INVALID');
 if(lock.profile!==profileFor[repo])fail('SKILL_SOURCE_PROFILE_MISMATCH');
 // Production always uses a new private cache outside the candidate checkout.
 const central=source?resolve(source):sourceCache();
 ensureSource(central,lock.revision);
 if(checksum(git(central,'show',`${lock.revision}:distribution/skills_source.py`))!==lock.loader_sha256)fail('SKILL_SOURCE_LOADER_MISMATCH');
 const catalog=JSON.parse(git(central,'show',`${lock.revision}:distribution/catalog.json`));
 const matches=catalog.profiles?.[lock.profile]?.files?.filter(e=>e.path===path);
 if(!matches||matches.length!==1)fail('SKILL_SOURCE_ENTRY_MISSING');
 const selected=matches[0];
 if(typeof selected.source!=='string'||selected.source.startsWith('/')||selected.source.split('/').some(v=>!v||v==='.'||v==='..')||selected.source.includes('\\')||!/^[0-9a-f]{64}$/.test(selected.sha256))fail('SKILL_SOURCE_ENTRY_INVALID');
 const payload=git(central,'show',`${lock.revision}:${selected.source}`);
 if(checksum(payload)!==selected.sha256)fail('SKILL_SOURCE_CHECKSUM_MISMATCH');
 return payload;
}

/** Give the unchanged installer a private checkout; the Pilot object capability stays read-only. */
export function installRegressionSkills(root,{source=process.env.SKILLS_SOURCE_DIR}={}){
 root=realpathSync(root);const deadline=Date.now()+60000;
 const env={...environment(),PYTHONDONTWRITEBYTECODE:'1'};
 if(source)env.GIT_ALLOW_PROTOCOL='file';
 for(const key of ['PYTHONPATH','PYTHONHOME','NODE_OPTIONS','NODE_PATH','BASH_ENV','ENV'])delete env[key];
 delete env.SKILLS_SOURCE_DIR;
 const run=(command,args)=>{const timeout=deadline-Date.now();if(timeout<=0)fail('SKILL_REGRESSION_TIMEOUT');return execFileSync(command,args,{cwd:root,env,stdio:['ignore','pipe','pipe'],timeout,maxBuffer:32*1024*1024});};
 const local=(dir,...args)=>run('git',['--no-replace-objects','-C',dir,'-c','core.hooksPath=/dev/null',...args]);
 const lockBytes=local(root,'show','HEAD:.skills-source.json');
 if(!readFileSync(join(root,'.skills-source.json')).equals(lockBytes))fail('SKILL_REGRESSION_LOCK_CHANGED');
 const lock=JSON.parse(lockBytes);
 if(Object.keys(lock).sort().join(',')!=='loader_sha256,profile,repository,revision,version'||lock.version!==1||lock.repository!=='perfectuser21/zenithjoy-skills'||lock.profile!=='zenithjoy'||typeof lock.revision!=='string'||!/^[0-9a-f]{40}$/.test(lock.revision)||typeof lock.loader_sha256!=='string'||!/^[0-9a-f]{64}$/.test(lock.loader_sha256))fail('SKILL_REGRESSION_LOCK_INVALID');
 for(const path of ['scripts/ensure-skills-source.sh','scripts/skills-source.py'])if(!readFileSync(join(root,path)).equals(local(root,'show',`HEAD:${path}`)))fail('SKILL_REGRESSION_BOOTSTRAP_CHANGED');
 let temporary,checkout;
 try{
  if(source){
   if(!isAbsolute(source))fail('SKILL_REGRESSION_CACHE_INVALID');source=realpathSync(source);
   if(!existsSync(join(source,'.git')))fail('SKILL_REGRESSION_CACHE_INVALID');
   if(local(source,'for-each-ref','--format=%(refname)','refs/replace').toString().trim())fail('SKILL_REGRESSION_REPLACE_REF');
   local(source,'cat-file','-e',lock.revision+'^{commit}');
   if(checksum(local(source,'show',`${lock.revision}:distribution/skills_source.py`))!==lock.loader_sha256)fail('SKILL_REGRESSION_LOADER_CHANGED');
   let head;try{head=local(source,'rev-parse','--verify','HEAD').toString().trim();}catch{}
   if(head&&head!==lock.revision)fail('explicit source revision does not match lock; refusing to change its checkout');
   if(!head){
    for(const path of ['.git','.git/objects'])if(lstatSync(join(source,path)).isSymbolicLink()||!lstatSync(join(source,path)).isDirectory())fail('SKILL_REGRESSION_CACHE_INVALID');
    if(existsSync(join(source,'.git/objects/info/alternates')))fail('SKILL_REGRESSION_ALTERNATES');
    temporary=mkdtempSync(join(tmpdir(),'regression-skills-'));checkout=join(temporary,'source');
    // clone treats a shallow repository without refs as empty. Fetch the exact
    // object into a fresh repository instead; file transport copies packs and
    // never borrows objects, refs, config, hooks or a checkout from the cache.
    run('git',['-c','core.hooksPath=/dev/null','init','--quiet','--template=',checkout]);
    local(checkout,'fetch','--quiet','--no-tags','--depth=1',
     '--upload-pack=git -c core.hooksPath=/dev/null upload-pack',source,lock.revision);
    if(existsSync(join(checkout,'.git/objects/info/alternates')))fail('SKILL_REGRESSION_ALTERNATES');
    local(checkout,'-c','core.autocrlf=false','checkout','--quiet','--detach',lock.revision);
    source=checkout;
   }
   env.SKILLS_SOURCE_DIR=source;
  }
  run('bash',['scripts/ensure-skills-source.sh',root]);
  if(Date.now()>=deadline)fail('SKILL_REGRESSION_TIMEOUT');
  return {privateCheckout:checkout||null};
 }finally{if(temporary)rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4||process.argv[2]!=='--install-regression-skills')fail('SKILL_REGRESSION_ARGS_INVALID');installRegressionSkills(process.argv[3]);}
 catch(error){process.stderr.write((error.stderr?.toString()||error.code||error.message)+'\n');process.exitCode=1;}
}
