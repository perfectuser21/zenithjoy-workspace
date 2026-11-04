/** Actual trusted reader subprocess and real Git objects; only SSH transport is substituted. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const realGit=execFileSync('/usr/bin/which',['git'],{encoding:'utf8'}).trim();
const python=execFileSync('python3',['-c','import sys;print(sys.executable)'],{encoding:'utf8'}).trim();
const git=(root,...args)=>execFileSync(realGit,['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=root=>{git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');return git(root,'rev-parse','HEAD');};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'reader-transport-')),business=join(root,'business'),central=join(root,'central'),bin=join(root,'bin');
 for(const dir of [business,central,bin])mkdirSync(dir);
 for(const dir of [business,central]){git(dir,'init','-q');git(dir,'config','core.hooksPath','/dev/null');}
 git(business,'remote','add','origin','https://github.com/perfectuser21/zenithjoy-workspace.git');
 const path='scripts/fixture/SKILL.md',payload='exact pinned Git bytes\n',loader='never execute source loader\n';
 mkdirSync(join(central,'distribution'));writeFileSync(join(central,'body.md'),payload);writeFileSync(join(central,'distribution/skills_source.py'),loader);
 const catalog={profiles:{zenithjoy:{files:[{path,source:'body.md',sha256:sha(payload)}]}}};
 writeFileSync(join(central,'distribution/catalog.json'),JSON.stringify(catalog));
 const lock={version:1,repository:'perfectuser21/zenithjoy-skills',profile:'zenithjoy',revision:commit(central),loader_sha256:sha(loader)};
 mkdirSync(join(business,'scripts'));writeFileSync(join(business,'scripts/skills-source.py'),"raise Exception('CANDIDATE_MUST_NOT_EXECUTE')\n");
 const writeLock=()=>{writeFileSync(join(business,'.skills-source.json'),JSON.stringify(lock));return commit(business);};
 let revision=writeLock();
 // A candidate-owned cache cannot supply the production read capability.
 mkdirSync(join(business,'.skills-source'));writeFileSync(join(business,'.skills-source/poison'),'candidate-owned');
 const identity=join(root,'identity');execFileSync('ssh-keygen',['-q','-t','ed25519','-N','','-C','fixture-local-only','-f',identity],{stdio:['ignore','pipe','pipe'],timeout:5000});
 const key=readFileSync(identity,'utf8'),fingerprint=execFileSync('ssh-keygen',['-l','-E','sha256','-f',identity+'.pub'],{encoding:'utf8',timeout:5000}).split(/\s+/)[1];
 const log=join(root,'fetch.jsonl');
 writeFileSync(join(bin,'git'),'#!'+python+`\nimport hashlib,json,os,pathlib,shlex,stat,sys,time\na=sys.argv[1:]\nif 'fetch' not in a:os.execv(os.environ['FIXTURE_REAL_GIT'],['git',*a])\nlog=pathlib.Path(os.environ['FIXTURE_LOG']);n=len(log.read_text().splitlines()) if log.exists() else 0\nssh=os.environ['GIT_SSH_COMMAND'];parts=shlex.split(ssh);identity=pathlib.Path(parts[parts.index('-i')+1]);hosts=pathlib.Path(next(x.split('=',1)[1] for x in parts if x.startswith('UserKnownHostsFile=')))\ne={'args':a,'ssh':ssh,'identity':str(identity),'hash':hashlib.sha256(identity.read_bytes()).hexdigest(),'mode':stat.S_IMODE(identity.stat().st_mode),'key_env':'SKILLS_SOURCE_SSH_KEY' in os.environ,'hosts':hosts.read_text()}\nwith log.open('a') as out:out.write(json.dumps(e)+'\\n')\ntime.sleep(float(os.environ.get('FIXTURE_FETCH_SLEEP','0')))\nif n<int(os.environ['FIXTURE_FAILURES']):print(os.environ['FIXTURE_ERROR'],file=sys.stderr);sys.exit(128)\ni=a.index('fetch');a[i+3]=os.environ['FIXTURE_SOURCE']\nos.execv(os.environ['FIXTURE_REAL_GIT'],['git',*a])\n`,{mode:0o755});
 const launcher=join(root,'reader.mjs');
 writeFileSync(launcher,`import {readImplementationSource} from ${JSON.stringify(new URL('../implementation-skill-source.mjs',import.meta.url).href)};try{process.stdout.write(readImplementationSource(process.argv[2],process.argv[3],process.argv[4]));}catch(error){process.stderr.write(error.message+'\\n');process.exitCode=1;}`);
 const env={...process.env,PATH:bin+':'+process.env.PATH,SKILLS_SOURCE_SSH_KEY:key.replace(/\n/g,'\r\n').trimEnd(),FIXTURE_REAL_GIT:realGit,FIXTURE_LOG:log,FIXTURE_SOURCE:central,FIXTURE_FAILURES:'0',FIXTURE_ERROR:'git@github.com: Permission denied (publickey).'};
 return {root,business,central,bin,lock,key,fingerprint,path,payload,env,
  pin:()=>{revision=writeLock();},
  run:(nodeArgs=[])=>spawnSync(process.execPath,[...nodeArgs,launcher,business,revision,path],{env,encoding:'utf8',timeout:18000}),
  attempts:()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[],
  cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function noSecrets(f,result){for(const line of f.key.trim().split('\n'))assert.ok(!(result.stdout+result.stderr).includes(line),'logs must not contain private-key lines');assert.ok(!(result.stdout+result.stderr).includes(readFileSync(join(f.root,'identity.pub'),'utf8').trim().split(' ')[1]),'public blob must not be logged');}
test('reader retries two publickey failures with one fixed identity/SHA and isolated cache, then reads exact blob',()=>{
 const f=fixture();try{
  f.env.FIXTURE_FAILURES='2';const result=f.run();assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,f.payload);
  const attempts=f.attempts();assert.equal(attempts.length,3);assert.equal(new Set(attempts.map(a=>a.ssh)).size,1);
  for(const a of attempts){assert.equal(a.args.at(-1),f.lock.revision);assert.equal(a.args.at(-2),'git@github.com:perfectuser21/zenithjoy-skills.git');assert.equal(a.mode,0o600);assert.equal(a.hash,sha(f.key));assert.equal(a.key_env,false);assert.ok(!a.args[2].startsWith(f.business));
   for(const option of ['-F /dev/null','IdentitiesOnly=yes','IdentityAgent=none','BatchMode=yes','ConnectTimeout=10','ConnectionAttempts=1','StrictHostKeyChecking=yes'])assert.ok(a.ssh.includes(option),option);
   assert.match(a.hosts,/^github.com ssh-ed25519 /);assert.equal(existsSync(a.identity),false,'private temporary identity cleaned');
  }
  const diagnostic=`skill source identity type=ssh-ed25519 fingerprint=${f.fingerprint}`;assert.equal(result.stderr.split(diagnostic).length-1,1);assert.ok(result.stderr.indexOf(diagnostic)<result.stderr.indexOf('fetch attempt'));noSecrets(f,result);
 }finally{f.cleanup();}
});
test('reader publickey exhaustion stays fatal at three attempts and preserves original error',()=>{
 const f=fixture();try{f.env.FIXTURE_FAILURES='99';const r=f.run();assert.notEqual(r.status,0);assert.equal(f.attempts().length,3);assert.match(r.stderr,/after 3 attempt\(s\).*Permission denied \(publickey\)/);assert.equal(r.stdout,'');noSecrets(f,r);}finally{f.cleanup();}
});
test('reader permanent identity/repository/hostkey errors are fatal after exactly one attempt',()=>{
 for(const error of ['Load key fixture: invalid format','ERROR: Repository not found.','Host key verification failed.']){const f=fixture();try{f.env.FIXTURE_FAILURES='99';f.env.FIXTURE_ERROR=error;const r=f.run();assert.notEqual(r.status,0);assert.equal(f.attempts().length,1);assert.ok(r.stderr.includes(error));noSecrets(f,r);}finally{f.cleanup();}}
});
test('reader missing key has zero fetches and cannot fall back to HTTPS or candidate-owned cache',()=>{
 const f=fixture();try{delete f.env.SKILLS_SOURCE_SSH_KEY;const r=f.run();assert.notEqual(r.status,0);assert.equal(f.attempts().length,0);assert.match(r.stderr,/SKILLS_SOURCE_SSH_KEY is required/);}finally{f.cleanup();}
});
test('reader does not retry loader/checksum/entry validation or change the requested object',()=>{
 for(const mode of ['loader','checksum','entry','unknown-sha']){const f=fixture();try{
  if(mode==='loader')f.lock.loader_sha256='0'.repeat(64);
  if(mode==='unknown-sha')f.lock.revision='0'.repeat(40);
  if(mode==='checksum'||mode==='entry'){const catalog=JSON.parse(readFileSync(join(f.central,'distribution/catalog.json')));if(mode==='checksum')catalog.profiles.zenithjoy.files[0].sha256='0'.repeat(64);else catalog.profiles.zenithjoy.files=[];writeFileSync(join(f.central,'distribution/catalog.json'),JSON.stringify(catalog));f.lock.revision=commit(f.central);}
  f.pin();const r=f.run();assert.notEqual(r.status,0);assert.equal(f.attempts().length,1);assert.equal(f.attempts()[0].args.at(-1),f.lock.revision);assert.equal(r.stdout,'');if(mode!=='unknown-sha')assert.match(r.stderr,new RegExp('SKILL_SOURCE_'+{loader:'LOADER_MISMATCH',checksum:'CHECKSUM_MISMATCH',entry:'ENTRY_MISSING'}[mode]));
 }finally{f.cleanup();}}
});
test('reader suppresses diagnostic subprocess secrets while preserving a failing fetch',()=>{
 const f=fixture();try{writeFileSync(join(f.bin,'ssh-keygen'),'#!'+python+'\nimport sys\nprint('+JSON.stringify(f.key.split('\n')[1])+',file=sys.stderr);sys.exit(1)\n',{mode:0o755});f.env.FIXTURE_FAILURES='99';const r=f.run();assert.notEqual(r.status,0);assert.equal(f.attempts().length,3);assert.match(r.stderr,/identity diagnostic unavailable/);assert.match(r.stderr,/Permission denied/);noSecrets(f,r);}finally{f.cleanup();}
});
test('reader redacts secret echoes in final permanent transport errors',()=>{
 const f=fixture();try{f.env.FIXTURE_FAILURES='99';f.env.FIXTURE_ERROR='invalid format '+f.key.split('\n')[1];const r=f.run();assert.notEqual(r.status,0);assert.equal(f.attempts().length,1);assert.match(r.stderr,/invalid format \[REDACTED\]/);noSecrets(f,r);}finally{f.cleanup();}
});
test('reader keygen diagnostic is noninteractive with a real five-second deadline and does not hide permanent fetch failure',()=>{
 const f=fixture();try{
  const argsLog=join(f.root,'keygen-args');
  writeFileSync(join(f.bin,'ssh-keygen'),'#!'+python+'\nimport json,pathlib,sys,time\npathlib.Path('+JSON.stringify(argsLog)+').write_text(json.dumps(sys.argv[1:]))\nassert sys.stdin.read()==""\ntime.sleep(8)\n',{mode:0o755});
  f.env.FIXTURE_FAILURES='99';f.env.FIXTURE_ERROR='Repository not found.';
  const start=Date.now(),r=f.run();assert.notEqual(r.status,0);assert.ok(Date.now()-start<7000,'keygen deadline must terminate the real sleeping child');
  assert.deepEqual(JSON.parse(readFileSync(argsLog,'utf8')).slice(0,4),['-y','-P','','-f']);assert.equal(f.attempts().length,1);assert.match(r.stderr,/identity diagnostic unavailable/);assert.match(r.stderr,/Repository not found/);noSecrets(f,r);
 }finally{f.cleanup();}
});

test('reader process timeout retries actual sleeping Git children, remains fatal and cleans the identity',()=>{
 const f=fixture();try{
  const preload=join(f.root,'timeout-only.mjs');
  // Change only the duration: execute production retry/error handling and real execFileSync.
  writeFileSync(preload,"import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const original=cp.execFileSync;cp.execFileSync=(command,args,options)=>original(command,args,command==='git'&&args.includes('fetch')?{...options,timeout:150}:options);syncBuiltinESMExports();");
  f.env.FIXTURE_FETCH_SLEEP='2';const r=f.run(['--import',preload]);assert.notEqual(r.status,0);assert.equal(f.attempts().length,3);assert.match(r.stderr,/transport_timeout/);assert.equal(r.stdout,'');for(const a of f.attempts())assert.equal(existsSync(a.identity),false);noSecrets(f,r);
 }finally{f.cleanup();}
});
