import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFileSync, spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const git = execFileSync('which', ['git'], {encoding:'utf8'}).trim();
const isolatedGit = {...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'hk-source-fetch-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const remote=join(root,'remote'), repo=join(root,'repo'), bin=join(root,'bin'), starts=join(root,'starts');
  for(const path of [remote,bin,starts]) await mkdir(path);
  const run=(cwd,...args)=>execFileSync(git,['-C',cwd,...args],{encoding:'utf8',env:isolatedGit}).trim();
  run(remote,'init','-b','main');run(remote,'config','user.name','Test');run(remote,'config','user.email','test@example.invalid');
  await mkdir(join(remote,'deploy'));
  for(const name of ['prod-api','staging-api']) await writeFile(join(remote,`deploy/docker-compose.${name}.yml`),'services: {}\n');
  run(remote,'add','.');run(remote,'commit','-m','old');
  execFileSync(git,['clone','--quiet',remote,repo],{env:isolatedGit});
  const old=run(repo,'rev-parse','HEAD');
  await writeFile(join(remote,'candidate'),'candidate source');
  run(remote,'add','.');run(remote,'commit','-m','candidate');
  const sha=run(remote,'rev-parse','HEAD');
  // A fetch boundary uses real Git objects and compare-and-swap ref updates.
  // The pause makes the production race deterministic: two fetches capture
  // the old origin/main before either commits its downloaded ref.
  await writeFile(join(bin,'git'),`#!${process.execPath} --
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2),real=process.env.REAL_GIT;
if(args.includes('fetch')){
 if(process.env.FAIL_FETCH==='1'){console.error('transport failed');process.exit(47);}
 const repo=args[args.indexOf('-C')+1];
 const call=(...a)=>cp.execFileSync(real,['-C',repo,...a],{encoding:'utf8'}).trim();
 const expected=call('rev-parse','refs/remotes/origin/main');
 fs.writeFileSync(process.env.STARTS+'/'+process.pid,expected);
 while(!fs.existsSync(process.env.RELEASE_FETCH))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
 call('fetch','--refmap=','--no-write-fetch-head','origin','main:refs/test-download/'+process.pid);
 const candidate=call('rev-parse','refs/test-download/'+process.pid);
 const result=cp.spawnSync(real,['-C',repo,'update-ref','refs/remotes/origin/main',candidate,expected],{stdio:'inherit'});
 process.exit(result.status);
}
const result=cp.spawnSync(real,args,{stdio:'inherit'});process.exit(result.status);
`,{mode:0o755});
  return {root,repo,sha,old,starts,run,env:{...isolatedGit,PATH:`${bin}:${process.env.PATH}`,
    REAL_GIT:git,STARTS:starts,RELEASE_FETCH:join(root,'release-fetch'),ZJ_HK_REPO:repo,DEPLOY_SHA:sha}};
}
async function start(f,kind,extra={}) {
  const releases=join(f.root,kind), output=join(f.root,kind+'.output');
  let script;
  if(kind==='production') {
    const source=await readFile(resolve('scripts/deploy/hk-api-release.sh'),'utf8');
    script=`set -euo pipefail\nREPO="$ZJ_HK_REPO"\nRELEASES="$TEST_RELEASES"\nmkdir -p "$RELEASES"\nfail(){ echo "$*" >&2; exit 1; }\n`+
      source.slice(source.indexOf('source_for() {'),source.indexOf('\noverride() {'))+
      '\nsource_for "$DEPLOY_SHA"\ncp "$RELEASES/$DEPLOY_SHA/source/candidate" "$TEST_OUTPUT"\n';
  } else if(kind==='api-staging') {
    const source=await readFile(resolve('scripts/deploy/hk-api-staging.sh'),'utf8');
    // Exercise the real fetch/archive block only; image admission has dedicated tests.
    script='set -euo pipefail\nREPO="$ZJ_HK_REPO"\nRELEASES="$ZJ_STAGING_RELEASES"\nSHA="$DEPLOY_SHA"\nmkdir -p "$RELEASES"\n'+
      source.slice(source.indexOf('SOURCE="$RELEASES/$SHA/source"'),source.indexOf('# Read the existing compose project'))+
      '\ncp "$SOURCE/candidate" "$TEST_OUTPUT"\n';
  } else {
    const w=JSON.parse(execFileSync('python3',['-c','import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',
      resolve('.github/workflows/deploy-dashboard-staging.yml')],{encoding:'utf8'}));
    script=w.jobs['deploy-staging-dashboard'].steps.find(s=>s.with?.script).with.script.split('echo "=== [2/5]')[0]
      .replaceAll('/opt/zenithjoy/repo',f.repo)
      .replaceAll('/opt/zenithjoy/dashboard-staging-build.XXXXXX',join(f.root,'dashboard.XXXXXX'))+
      '\ncp "$REPO/candidate" "$TEST_OUTPUT"\n';
  }
  const child=spawn('bash',['-c',script,'bash',f.sha],{env:{...f.env,
    ZJ_STAGING_RELEASES:releases,ZJ_STAGING_LOCK:join(f.root,'staging.lock'),
    TEST_RELEASES:releases,TEST_OUTPUT:output,...extra}});
  let stderr='';
  child.stderr.on('data',b=>stderr+=b);child.stdout.resume();
  const done=new Promise(resolve=>child.on('close',code=>resolve({code,stderr,output})));
  return {child,done};
}
for(const pair of [['api-staging','dashboard'],['production','dashboard'],['production','api-staging']]) {
  test(`共享HK源码fetch互斥：${pair.join(' + ')}同时获取同SHA均成功且不重置HEAD`,async t=>{
    const f=await fixture(t), a=await start(f,pair[0]);
    t.after(()=>a.child.kill());
    for(let i=0;!(await readdir(f.starts)).length && i<200;i++)await delay(10);
    assert.equal((await readdir(f.starts)).length,1,'first fetch must reach the transport');
    const b=await start(f,pair[1]);t.after(()=>b.child.kill());
    await delay(150);await writeFile(f.env.RELEASE_FETCH,'go');
    const results=await Promise.all([a.done,b.done]);
    for(const result of results){
      assert.equal(result.code,0,result.stderr);
      assert.equal(await readFile(result.output,'utf8'),'candidate source');
    }
    assert.equal(f.run(f.repo,'rev-parse','HEAD'),f.old);
    assert.equal(f.run(f.repo,'rev-parse','origin/main'),f.sha);
  });
}
for(const kind of ['api-staging','dashboard','production']) {
  test(`${kind}的fetch失败必须中止，且释放源码锁后可重试`,async t=>{
    const f=await fixture(t);
    const failed=await start(f,kind,{FAIL_FETCH:'1'});
    const result=await failed.done;
    assert.notEqual(result.code,0);
    assert.match(result.stderr,/transport failed/);
    await writeFile(f.env.RELEASE_FETCH,'go');
    const retry=await start(f,kind);
    const recovered=await retry.done;
    assert.equal(recovered.code,0,recovered.stderr);
    assert.equal(await readFile(recovered.output,'utf8'),'candidate source');
  });
}
