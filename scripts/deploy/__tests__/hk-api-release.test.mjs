import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/deploy/hk-api-release.sh');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hk-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), bin = join(root, 'bin'), state = join(root, 'docker.json');
  mkdirSync(repo); mkdirSync(bin); mkdirSync(join(repo, 'deploy'));
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'test');
  writeFileSync(join(repo, 'deploy/docker-compose.prod-api.yml'), 'services:\n  zenithjoy-api-prod:\n    image: zenithjoy-api-prod:latest\n');
  writeFileSync(join(repo, 'deploy/docker-compose.staging-api.yml'), 'services:\n  zenithjoy-api-staging:\n    image: zenithjoy-api-staging:latest\n');
  git('add', '.'); git('commit', '-m', 'old'); const old = git('rev-parse', 'HEAD');
  writeFileSync(join(repo, 'candidate'), 'new'); git('add', '.'); git('commit', '-m', 'candidate');
  const next = git('rev-parse', 'HEAD'); git('remote', 'add', 'origin', repo);
  writeFileSync(state, JSON.stringify({ active: 'sha256:old-image', images: { 'sha256:old-image': old }, builds: 0, ups: [] }));
  const boundary = `#!${process.execPath} --
const fs=require('node:fs'); const path=require('node:path');
const args=process.argv.slice(2); const service=process.env.FAKE_SERVICE||'zenithjoy-api-prod'; const s=JSON.parse(fs.readFileSync(process.env.FAKE_DOCKER));
function save(){ fs.writeFileSync(process.env.FAKE_DOCKER,JSON.stringify(s)); }
if(path.basename(process.argv[1])==='curl'){
 let sha=s.images[s.active]; if(process.env.FAIL_MODE==='sha'&&sha===process.env.CANDIDATE)sha='0'.repeat(40);
 console.log(JSON.stringify({build:{sha}})); process.exit(0);
}
if(args[0]==='inspect'){
 if(args[1]!==service)throw Error('wrong container '+args[1]);
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
 if(!args.at(-1).includes('--include=dev'))throw Error('migration runner must retain locked ts-node dev dependency under NODE_ENV=production');
 if(process.env.FAIL_MODE==='migration')process.exit(8); process.exit(0);
}
if(args[0]==='compose'){
 const files=args.flatMap((a,i)=>a==='-f'?[args[i+1]]:[]);
 const image=JSON.parse(fs.readFileSync(files.at(-1))).services[service].image;
 if(args.includes('build')){
 const source=path.dirname(path.dirname(files[0]));
 if(!fs.existsSync(path.join(source,'candidate')))throw Error('build did not use candidate source');
 if(source===process.env.ZJ_HK_REPO)throw Error('build uses mutable shared checkout');
 s.images[image]=process.env.BUILD_SHA;s.builds++;save();process.exit(0);}
 if(args.includes('up')){s.active=image;s.ups.push(image);save();if(process.env.FAIL_MODE==='up'&&s.images[image]===process.env.CANDIDATE)process.exit(9);process.exit(0);}
}
throw Error('unexpected docker '+args.join(' '));
`;
  for (const command of ['docker', 'curl']) writeFileSync(join(bin, command), boundary, { mode: 0o755 });
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
  return spawnSync('bash', [stagingScript, f.next], { env: { ...f.env,
    ZJ_STAGING_RELEASES: join(f.root, 'staging'), ZJ_STAGING_LOCK: join(f.root, 'staging.lock'),
    FAKE_SERVICE: 'zenithjoy-api-staging', ...extra }, encoding: 'utf8' });
}
test('staging构建固定候选且不改共享HEAD，健康后回读同SHA', t => {
  const f = fixture(t); f.git('checkout', f.old);
  const result = stage(f); assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('rev-parse', 'HEAD'), f.old);
  assert.equal(f.state().images[f.state().active], f.next);
});
for (const mode of ['sha', 'health']) test(`staging ${mode}不符不能产出成功运行`, t => {
  const f = fixture(t); const result = stage(f, { FAIL_MODE: mode });
  assert.notEqual(result.status, 0);
  assert.equal(f.state().builds, 1, result.stderr);
});
