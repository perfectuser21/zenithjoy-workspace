import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const script = resolve('scripts/deploy/hk-api-release.sh');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hk-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), bin = join(root, 'bin'), state = join(root, 'docker.json');
  mkdirSync(repo); mkdirSync(bin); mkdirSync(join(repo, 'deploy')); mkdirSync(join(repo,'apps/api/db/migrations'),{recursive:true}); writeFileSync(join(repo,'apps/api/db/migrations/run-migration.ts'),'// fixture'); writeFileSync(join(repo,'apps/api/tsconfig.json'),'{}'); writeFileSync(join(repo,'tsconfig.base.json'),'{}');
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  mkdirSync(join(repo,'scripts/deploy'),{recursive:true}); copyFileSync(resolve('scripts/deploy/staging-image-identity.py'),join(repo,'scripts/deploy/staging-image-identity.py'));
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  writeFileSync(join(repo, 'deploy/docker-compose.prod-api.yml'), 'services:\n  zenithjoy-api-prod:\n    image: zenithjoy-api-prod:latest\n');
  writeFileSync(join(repo, 'deploy/docker-compose.staging-api.yml'), 'services:\n  zenithjoy-api-staging:\n    image: zenithjoy-api-staging:latest\n');
  git('add', '.'); git('commit', '-m', 'old'); const old = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'candidate'), 'new'); git('add', '.'); git('commit', '-m', 'candidate');
  const next = git('rev-parse', 'HEAD'); git('remote', 'add', 'origin', repo);
  writeFileSync(state, JSON.stringify({ active: 'sha256:old-image', images: { 'sha256:old-image': old }, builds: 0, ups: [] }));
  const boundary = `#!${process.execPath} --
const fs=require('node:fs'); const path=require('node:path');
const args=process.argv.slice(2); if(path.basename(process.argv[1])==='df'){ console.log('Filesystem 1024-blocks Used Available Capacity Mounted'); const state=JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER)); const free=(state.builds>0 && process.env.FAKE_AFTER_BUILD_FREE_KB)||process.env.FAKE_FREE_KB||'9999999'; console.log('fixture 99999999 1 '+free+' 1% /'); process.exit(0); } const service=process.env.FAKE_SERVICE||'zenithjoy-api-prod'; const s=JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER));
function save(){ fs.writeFileSync(process.env.FAKE_DOCKER,JSON.stringify(s)); }
if(path.basename(process.argv[1])==='curl'){
 let sha=s.images[s.active]; if(process.env.FAIL_MODE==='sha'&&sha===process.env.CANDIDATE)sha='0'.repeat(40);
 console.log(JSON.stringify({build:{sha}})); process.exit(0);
}
if(args[0]==='inspect'){
 if(args[1]!==service)throw Error('wrong container '+args[1]);
 if(!s.active)process.exit(1);
 const fmt=args[args.indexOf('--format')+1];
 if(fmt.includes('.Image'))console.log(s.active);
 else if(fmt.includes('Health'))console.log(process.env.FAIL_MODE==='health'&&s.images[s.active]===process.env.CANDIDATE?'unhealthy':'healthy');
 else if(fmt.includes('Labels'))console.log('repo');
 else throw Error('unknown inspect '+args); process.exit(0);
}
if(args[0]==='image'&&args[1]==='inspect'){
 const image=args[2]; if(!s.images[image])process.exit(1); console.log(image); process.exit(0);
}
if(args[0]==='tag'){ s.images[args[2]]=s.images[args[1]]; save(); process.exit(0); }
if(args[0]==='run'){
 const expected=service==='zenithjoy-api-staging'?'/opt/zenithjoy/staging-api/.env':'/opt/zenithjoy/prod-api/.env';
 if(args[args.indexOf('--env-file')+1]!==expected)throw Error('wrong database environment');
 if(service==='zenithjoy-api-staging'){ const mount=args.find(x=>x.endsWith(":/source:ro")); if(mount && fs.existsSync(path.join(mount.slice(0,-11),'apps/api/db/migrations/node_modules'))) throw Error('poisoned migration archive'); if(!args.some(x=>x.endsWith(":/source:ro") && x.includes("migration-source.")) || !args.includes("NODE_PATH=/repo/node_modules") || args.includes('node:20-bookworm-slim') || !args.includes(process.env.CANDIDATE && 'zenithjoy-api-staging:'+process.env.CANDIDATE) || args.at(-1)!=='/source/apps/api/db/migrations/run-migration.ts')throw Error('staging migration must reuse candidate image'); } else if(!args.at(-1).includes('--include=dev')) throw Error('production migration must retain locked ts-node dev dependency under NODE_ENV=production');
 s.migrations=(s.migrations||0)+1;save();if(process.env.FAIL_MODE==='migration')process.exit(8); process.exit(0);
}
if(args[0]==='compose'){
 const files=args.flatMap((a,i)=>a==='-f'?[args[i+1]]:[]);
 const image=JSON.parse(fs.readFileSync(files.at(-1))).services[service].image;
 if(args.includes('build')){
 const source=path.dirname(path.dirname(files[0]));
 if(!fs.existsSync(path.join(source,'candidate')))throw Error('build did not use candidate source');
 if(source===process.env.ZJ_HK_REPO)throw Error('build uses mutable shared checkout');
 if(process.env.POISON_SOURCE){const target=path.join(source,'apps/api/db/migrations/node_modules');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'injected.js'),'bad');}
 s.images[image]=process.env.RELEASE_SHA||process.env.BUILD_SHA;s.builds++;save();process.exit(0);}
 if(args.includes('up')){s.active=image;s.ups.push(image);save();if(process.env.FAIL_MODE==='kill-after-remove'&&s.images[image]===process.env.CANDIDATE){s.active=null;save();process.kill(process.ppid,'SIGKILL');process.exit(0);}if(process.env.FAIL_MODE==='kill-after-up'&&s.images[image]===process.env.CANDIDATE){process.kill(process.ppid,'SIGKILL');process.exit(0);}if(process.env.FAIL_MODE==='up'&&s.images[image]===process.env.CANDIDATE)process.exit(9);process.exit(0);}
}
throw Error('unexpected docker '+args.join(' '));
`;
  for (const command of ['docker', 'curl', 'df']) writeFileSync(join(bin, command), boundary, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ZJ_HK_REPO: repo,
    ZJ_HK_RELEASES: join(root, 'releases'), ZJ_HK_LOCK: join(root, 'release.lock'),
    ZJ_HEALTH_ATTEMPTS: '1', ZJ_HEALTH_INTERVAL: '0', FAKE_DOCKER: state, CANDIDATE: next };
  return { old, next, git, root, env, state: () => JSON.parse(readFileSync(state)),
    run: (args, extra = {}) => spawnSync('bash', [script, ...args], { env: { ...env, ...extra }, encoding: 'utf8' }) };
}

test('固定候选发布不重置共享仓库，留存实际旧镜像供免构建回退', t => {
  const f = fixture(t); f.git('checkout', f.old);
  const deploy = f.run(['promote', f.next]); assert.equal(deploy.status, 0, deploy.stderr);
  assert.equal(f.git('rev-parse', 'HEAD'), f.old);
  assert.equal(deploy.stdout.match(/^HK_RELEASE_PREVIOUS=([a-f0-9]{40})$/m)?.[1], f.old);
  assert.equal(f.state().images[f.state().active], f.next);
  const builds = f.state().builds;
  const rollback = f.run(['rollback']); assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(f.state().images[f.state().active], f.old);
  assert.equal(f.state().builds, builds, '回退不能重新构建旧源码');
});
for (const mode of ['health', 'sha', 'up']) test(`发布${mode}失败恢复实际旧镜像且仍报失败`, t => {
  const f = fixture(t); const result = f.run(['promote', f.next], { FAIL_MODE: mode });
  assert.notEqual(result.status, 0);
  assert.equal(f.state().images[f.state().active], f.old);
  assert.ok(f.state().ups.length >= 2, result.stderr);
});
test('迁移失败不替换现有生产容器', t => {
  const f = fixture(t); const result = f.run(['promote', f.next], { FAIL_MODE: 'migration' });
  assert.notEqual(result.status, 0); assert.deepEqual(f.state().ups, []);
  assert.equal(f.state().images[f.state().active], f.old);
});
test('未知回退版本被拒绝，不能偷偷构建或部署其他版本', t => {
  const f = fixture(t); assert.equal(f.run(['promote', f.next]).status, 0);
  const result = f.run(['rollback', 'f'.repeat(40)]);
  assert.notEqual(result.status, 0); assert.equal(f.state().images[f.state().active], f.next);
  assert.equal(f.state().builds, 1);
});
test('不接受main或短SHA作为生产候选', t => {
  const f = fixture(t); const result = f.run(['promote', 'main']);
  assert.notEqual(result.status, 0); assert.equal(f.state().builds, 0);
});

test('生产健康检查失败仍能回退到上一个已验证镜像', t => {
  const f = fixture(t); assert.equal(f.run(['promote', f.next]).status, 0);
  const result = f.run(['rollback'], { FAIL_MODE: 'health' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.state().images[f.state().active], f.old);
});
test('失败候选不能作为人工回退目标', t => {
  const f = fixture(t); assert.notEqual(f.run(['promote', f.next], { FAIL_MODE: 'health' }).status, 0);
  const result = f.run(['rollback', f.next]);
  assert.notEqual(result.status, 0); assert.equal(f.state().images[f.state().active], f.old);
});

test('另一个发布占有宿主锁时不触碰镜像或容器', t => {
  const f = fixture(t);
  const result = spawnSync('flock', ['-n', f.env.ZJ_HK_LOCK, 'bash', script, 'promote', f.next], { env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /host lock/);
  assert.equal(f.state().builds, 0); assert.deepEqual(f.state().ups, []);
});
test('留存镜像丢失时拒绝回退，不通过重建冒充旧版本', t => {
  const f = fixture(t); assert.equal(f.run(['promote', f.next]).status, 0);
  const state = f.state(); delete state.images['sha256:old-image'];
  writeFileSync(f.env.FAKE_DOCKER, JSON.stringify(state));
  assert.notEqual(f.run(['rollback']).status, 0);
  assert.equal(f.state().images[f.state().active], f.next); assert.equal(f.state().builds, 1);
});

test('已经验证过的留存版本不能被再次构建覆盖', t => {
  const f = fixture(t); assert.equal(f.run(['promote', f.next]).status, 0);
  const result = f.run(['promote', f.old]);
  assert.notEqual(result.status, 0);
  assert.equal(f.state().builds, 1);
  assert.equal(f.run(['rollback', f.old]).status, 0);
  assert.equal(f.state().active, 'sha256:old-image');
});

const stagingScript = resolve('scripts/deploy/hk-api-staging.sh');
function stage(f, extra = {}) {
  const stageBin=join(f.root,'stage-bin'); mkdirSync(stageBin,{recursive:true});
  const oldId='sha256:'+'a'.repeat(64), candidateId='sha256:'+'b'.repeat(64);
  const config=join(f.root,'previous-compose.yml'); writeFileSync(config,'services: {}\n');
  writeFileSync(join(f.root,'docker.json'),JSON.stringify({active:oldId,images:{[oldId]:f.old},builds:0,ups:[]}));
  const fake=String.raw`#!${process.execPath} --
const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2),name=path.basename(process.argv[1]),state=JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER));
const save=()=>fs.writeFileSync(process.env.FAKE_DOCKER,JSON.stringify(state));
const old=process.env.OLD_ID,next=process.env.NEW_ID,tag='zenithjoy-api-staging:'+process.env.CANDIDATE;
if(args[0]==='save'){process.stdout.write(fs.readFileSync(process.env.SAVE_TAR));process.exit(0)}
if(name==='df'){const free=state.builds>0&&process.env.FAKE_AFTER_BUILD_FREE_KB||process.env.FAKE_FREE_KB||'9999999';console.log('Filesystem 1024-blocks Used Available Capacity Mounted\nfixture 99999999 1 '+free+' 1% /');process.exit(0)}
if(name==='curl'){let sha=state.images[state.active];if(process.env.FAIL_MODE==='sha'&&sha===process.env.CANDIDATE)sha='0'.repeat(40);console.log(JSON.stringify({build:{sha}}));process.exit(0)}
if(args[0]==='info'){console.log('/fake/docker');process.exit(0)}
if(args[0]==='inspect'){let fmt=args[args.indexOf('--format')+1];if(fmt.includes('config_files'))console.log(process.env.PREVIOUS_CONFIG);else if(fmt.includes('project'))console.log('repo');else if(fmt.includes('Health'))console.log(process.env.FAIL_MODE==='health'&&state.active===next?'unhealthy':'healthy');else if(fmt.includes('.Image'))console.log(state.active);else throw Error('bad inspect '+fmt);process.exit(0)}
if(args[0]==='image'&&args[1]==='inspect'){const image=args[2];if(image!==old&&image!==tag)process.exit(1);let fmt=args[args.indexOf('--format')+1]||'';if(fmt.includes('RootFS.Layers'))console.log(JSON.stringify(process.env.FAIL_MODE==='layers'?['sha256:'+'c'.repeat(64)]:['sha256:'+'d'.repeat(64)]));else if(fmt.includes('.Os'))console.log(process.env.FAIL_MODE==='platform'?'linux/arm64':'linux/amd64');else if(fmt.includes('revision'))console.log(process.env.FAIL_MODE==='label'?'0'.repeat(40):process.env.CANDIDATE);else if(fmt.includes('.Id'))console.log(image===old?old:(process.env.FAIL_MODE==='image'?'sha256:'+'c'.repeat(64):next));process.exit(0)}
if(args[0]==='tag')process.exit(0);
if(args[0]==='load'){fs.readFileSync(0);if(process.env.FAIL_MODE==='load')process.exit(9);state.images[next]=process.env.CANDIDATE;state.builds++;save();process.exit(0)}
if(args[0]==='run'){if(args.includes('-e')&&args.includes('NODE_PATH=/repo/node_modules')&&args.includes('-e')&&args.includes('node')&&args.includes('-e')&&args.includes('/repo/apps/api')){state.dbChecks=(state.dbChecks||0)+1;save();if(process.env.FAIL_MODE==='db')process.exit(8);process.exit(0)}const mount=args.find(x=>x.endsWith(':/source:ro'));if(!mount||!mount.includes('migration-source.')||!args.includes(tag)||args.at(-1)!=='/source/apps/api/db/migrations/run-migration.ts')throw Error('bad migration');if(fs.existsSync(path.join(mount.slice(0,-11),'apps/api/db/migrations/node_modules')))throw Error('poisoned archive');state.migrations=(state.migrations||0)+1;save();if(process.env.FAIL_MODE==='migration')process.exit(8);process.exit(0)}
if(args[0]==='compose'&&args.includes('up')){const files=args.flatMap((a,i)=>a==='-f'?[args[i+1]]:[]),image=JSON.parse(fs.readFileSync(files.at(-1))).services['zenithjoy-api-staging'].image;state.active=image===old?old:next;state.ups.push(state.active);save();if(process.env.FAIL_MODE==='up'&&state.active===next)process.exit(9);process.exit(0)}
throw Error('unexpected '+args.join(' '));
`;
  for(const cmd of ['docker','curl','df'])writeFileSync(join(stageBin,cmd),fake,{mode:0o755});
  if(extra.POISON_SOURCE){
    const source=join(f.root,'staging',f.next,'source');mkdirSync(source,{recursive:true});
    const archive=spawnSync('git',['-C',f.env.ZJ_HK_REPO,'archive',f.next],{encoding:null});assert.equal(archive.status,0);
    const extracted=spawnSync('tar',['-x','-C',source],{input:archive.stdout});assert.equal(extracted.status,0);
    mkdirSync(join(source,'apps/api/db/migrations/node_modules'),{recursive:true});
    writeFileSync(join(source,'apps/api/db/migrations/node_modules/injected.js'),'bad');
  }
  const archive=join(f.root,'docker-save.tar');
  const build=spawnSync('python3',['-c',`import io,sys,tarfile,json,hashlib
config=json.dumps({'os':'linux','architecture':'amd64','rootfs':{'diff_ids':['sha256:'+'d'*64]}}).encode(); name='blobs/sha256/'+hashlib.sha256(config).hexdigest()
with tarfile.open(sys.argv[1],'w') as t:
 for n,d in [(name,config),('manifest.json',json.dumps([{'Config':name,'RepoTags':[sys.argv[2]],'Layers':[]}]).encode())]:
  i=tarfile.TarInfo(n);i.size=len(d);t.addfile(i,io.BytesIO(d))`,archive,'zenithjoy-api-staging:'+f.next],{encoding:'utf8'}); assert.equal(build.status,0,build.stderr);
  const raw=readFileSync(archive),fullInput=gzipSync(raw),input=extra.FAIL_MODE==='truncated'?fullInput.subarray(0,Math.floor(fullInput.length/2)):fullInput,digest=createHash('sha256').update(raw).digest('hex');
  const ident=spawnSync('python3',[resolve('scripts/deploy/staging-image-identity.py'),'zenithjoy-api-staging:'+f.next],{input:raw,encoding:'utf8'});assert.equal(ident.status,0,ident.stderr);const identity=JSON.parse(ident.stdout);
  const expected=extra.FAIL_MODE==='image'?'sha256:'+'c'.repeat(64):identity.config;
  return spawnSync('bash',[stagingScript,f.next,extra.FAIL_MODE==='digest'?'0'.repeat(64):digest,expected,String(input.length),'1000',identity.layers_hash],{input,env:{...f.env,PATH:`${stageBin}:${process.env.PATH}`,ZJ_STAGING_RELEASES:join(f.root,'staging'),ZJ_STAGING_LOCK:join(f.root,'staging.lock'),FAKE_SERVICE:'zenithjoy-api-staging',OLD_ID:oldId,NEW_ID:candidateId,PREVIOUS_CONFIG:config,SAVE_TAR:archive,...extra},encoding:'utf8'});
}
test('staging 加载固定候选并核实镜像后迁移和切换', t => {const f=fixture(t);f.git('checkout',f.old);const result=stage(f);assert.equal(result.status,0,result.stderr);assert.equal(f.git('rev-parse','HEAD'),f.old);assert.equal(f.state().images[f.state().active],f.next);assert.equal(f.state().dbChecks,1);assert.equal(f.state().migrations,1);});
for(const mode of ['digest','image','layers','platform','label','db','migration']) test(`staging ${mode}失败不能切换`,t=>{const f=fixture(t),result=stage(f,{FAIL_MODE:mode});assert.notEqual(result.status,0);assert.deepEqual(f.state().ups,[]);assert.equal(f.state().builds,1);if(mode!=='migration')assert.equal(f.state().migrations||0,0);if(mode==='db'||mode==='migration')assert.equal(f.state().dbChecks,1);if(mode==='migration')assert.equal(f.state().migrations,1);});
for(const mode of ['truncated','load']) test(`staging ${mode}流失败不得迁移或切换`,t=>{const f=fixture(t),result=stage(f,{FAIL_MODE:mode});assert.notEqual(result.status,0);assert.equal(f.state().migrations||0,0);assert.deepEqual(f.state().ups,[]);});
test('迁移使用干净源码归档，排除旧目录的陈旧依赖',t=>{const f=fixture(t),result=stage(f,{POISON_SOURCE:'1'});assert.equal(result.status,0,result.stderr);assert.equal(f.state().migrations,1);});
test('staging 磁盘不足时不加载镜像',t=>{const f=fixture(t),result=stage(f,{FAKE_FREE_KB:'1024'});assert.notEqual(result.status,0);assert.match(result.stderr,/disk space/i);assert.equal(f.state().builds,0);assert.deepEqual(f.state().ups,[]);});
test('staging 加载后磁盘不足时不迁移或切换',t=>{const f=fixture(t),result=stage(f,{FAKE_AFTER_BUILD_FREE_KB:'1024'});assert.notEqual(result.status,0);assert.match(result.stderr,/disk space/i);assert.equal(f.state().builds,1);assert.equal(f.state().migrations||0,0);assert.deepEqual(f.state().ups,[]);});
for(const mode of ['sha','health','up'])test(`staging ${mode}失败恢复旧镜像`,t=>{const f=fixture(t),result=stage(f,{FAIL_MODE:mode});assert.notEqual(result.status,0);assert.equal(f.state().active,'sha256:'+'a'.repeat(64));assert.deepEqual(f.state().ups,['sha256:'+'b'.repeat(64),'sha256:'+'a'.repeat(64)]);});
test('回退到当前已运行镜像不改写previous历史',t=>{
 const f=fixture(t);assert.equal(f.run(['promote',f.next]).status,0);
 const noop=f.run(['rollback',f.next]);assert.equal(noop.status,0,noop.stderr);
 const actual=f.run(['rollback']);assert.equal(actual.status,0,actual.stderr);
 assert.equal(f.state().images[f.state().active],f.old);
});

for (const explicit of [false, true]) test(`候选激活后硬中断仍能${explicit ? '指定旧SHA' : '默认'}回退，不误认旧current为已恢复`, t => {
  const f = fixture(t);
  assert.equal(f.run(['promote', f.old]).status, 0);
  writeFileSync(join(f.env.ZJ_HK_RELEASES, 'current'), `${f.old}\n`);
  const interrupted = f.run(['promote', f.next], {FAIL_MODE:'kill-after-up'});
  assert.equal(interrupted.signal, 'SIGKILL');
  assert.equal(f.state().images[f.state().active], f.next);
  assert.equal(JSON.parse(readFileSync(join(f.env.ZJ_HK_RELEASES, f.next, 'release.json'))).verified, false);
  const recovered = f.run(explicit ? ['rollback', f.old] : ['rollback']);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(f.state().active, 'sha256:old-image');
  assert.equal(readFileSync(join(f.env.ZJ_HK_RELEASES, 'current'), 'utf8').trim(), f.old);
  assert.equal(f.state().builds, 1, '恢复只用真实留存镜像');
  assert.equal(JSON.parse(readFileSync(join(f.env.ZJ_HK_RELEASES, f.next, 'release.json'))).verified, false);
});

test('激活硬中断后禁止继续promote把未验候选当可信current', t => {
  const f = fixture(t);
  f.run(['promote', f.next], {FAIL_MODE:'kill-after-up'});
  const result = f.run(['promote', f.next]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /activation|interrupted|pending/i);
  assert.equal(JSON.parse(readFileSync(join(f.env.ZJ_HK_RELEASES, f.next, 'release.json'))).verified, false);
});

test('激活日志不能将第三方未知镜像漂移认证为旧版本或候选', t => {
  const f = fixture(t);
  f.run(['promote', f.next], {FAIL_MODE:'kill-after-up'});
  const state = f.state();
  state.active = 'sha256:unknown'; state.images[state.active] = f.next;
  writeFileSync(f.env.FAKE_DOCKER, JSON.stringify(state));
  const result = f.run(['rollback', f.old]);
  assert.notEqual(result.status, 0);
  assert.equal(f.state().active, 'sha256:unknown');
  assert.equal(JSON.parse(readFileSync(join(f.env.ZJ_HK_RELEASES, f.next, 'release.json'))).verified, false);
});

test('中断恢复保留原previous历史，恢复后仍能回退再前一版', t => {
  const f = fixture(t);
  assert.equal(f.run(['promote', f.next]).status, 0);
  f.git('commit', '--allow-empty', '-m', 'third');
  const third = f.git('rev-parse', 'HEAD');
  const interrupted = f.run(['promote', third], {FAIL_MODE:'kill-after-up', CANDIDATE:third});
  assert.equal(interrupted.signal, 'SIGKILL');
  const recovery = f.run(['rollback']);
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.equal(f.state().images[f.state().active], f.next);
  assert.equal(readFileSync(join(f.env.ZJ_HK_RELEASES, 'previous'), 'utf8').trim(), f.old);
  const rollback = f.run(['rollback']);
  assert.equal(rollback.status, 0, rollback.stderr);
  assert.equal(f.state().active, 'sha256:old-image');
});

test('Compose删旧建新间硬中断导致容器缺失时，从可信激活记录恢复已验证镜像', t => {
  const f = fixture(t);
  const interrupted = f.run(['promote', f.next], {FAIL_MODE:'kill-after-remove'});
  assert.equal(interrupted.signal, 'SIGKILL');
  assert.equal(f.state().active, null);
  const recovered = f.run(['rollback']);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(f.state().active, 'sha256:old-image');
  assert.equal(f.state().builds, 1);
  assert.equal(JSON.parse(readFileSync(join(f.env.ZJ_HK_RELEASES, f.next, 'release.json'))).verified, false);
});

test('容器缺失但无激活记录时拒绝猜测恢复', t => {
  const f = fixture(t);
  assert.equal(f.run(['promote', f.next]).status, 0);
  const state = f.state(); state.active = null;
  writeFileSync(f.env.FAKE_DOCKER, JSON.stringify(state));
  const result = f.run(['rollback']);
  assert.notEqual(result.status, 0);
  assert.equal(f.state().active, null);
  assert.deepEqual(f.state().ups, state.ups);
});

test('提交账本后清理journal时收到TERM不会回退容器造成账实不符', t => {
  const f = fixture(t);
  writeFileSync(join(f.env.PATH.split(':')[0], 'rm'), `#!${process.execPath} --
const fs=require('node:fs');
const file=process.argv[2];
if(!file.endsWith('/activation.json'))throw Error('unexpected removal '+file);
fs.unlinkSync(file);
process.kill(process.ppid,'SIGTERM');
`, {mode:0o755});
  const interrupted = f.run(['promote', f.next]);
  assert.notEqual(interrupted.status, 0);
  assert.equal(f.state().images[f.state().active], f.next);
  assert.equal(readFileSync(join(f.env.ZJ_HK_RELEASES, 'current'), 'utf8').trim(), f.next);
});
