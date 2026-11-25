import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../hz-api-release.sh', import.meta.url));
const oldSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const oldImage = 'sha256:' + 'c'.repeat(64);
const nextImage = 'sha256:' + 'd'.repeat(64);
const layers = ['sha256:' + 'e'.repeat(64)];
const layersHash = createHash('sha256').update(JSON.stringify(layers)).digest('hex');
const migrations = '20260101_first.sql\n20260102_second.sql\n';
const boundary = '#!' + process.execPath + ' --\n' + String.raw`
const fs = require('node:fs');
const path = require('node:path');
const file = process.env.HZ_FIXTURE_STATE;
const x = JSON.parse(fs.readFileSync(file));
const program = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const labels = 'zenithjoy-cn-production';
const service = 'zenithjoy-cn-production-api';
const print = value => console.log(JSON.stringify(value));
const save = () => {
  const temporary = file + '.' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(x));
  fs.renameSync(temporary, file);
};
const die = () => process.exit(1);
if (program === 'curl') {
  const url = args.at(-1);
  x.probes.push(url);
  save();
  const badPublic = x.failure === 'public' && url.includes('autopilot.zenjoymedia.media') && x.active === x.nextImage;
  x.active && !badPublic ? print({ status: 'ok', build: { sha: x.images[x.active].revision } }) : die();
} else if (args[0] === 'compose' && args.includes('config')) {
  print({services: {api: {
    container_name: service, image: x.oldImage, networks: {egress: null, production_db: null},
    environment: {DATABASE_HOST: 'db', DATABASE_PORT: '5432', DATABASE_NAME: 'zenithjoy', DATABASE_USER: 'zenithjoy_prod'},
    ports: [{target: 5200, published: '5200', host_ip: '127.0.0.1', protocol: 'tcp'}],
  }}, networks: {
    egress: {name: 'zenithjoy-cn-production-api-egress'},
    production_db: {name: 'zenithjoy-cn-production-db-internal', external: true},
  }});
} else if (args[0] === 'compose' && args.includes('up')) {
  if (args.at(-1) !== 'api' || !['--no-deps', '--no-build', '--pull', 'never'].every(a => args.includes(a))) {
    throw Error('release must replace the API service only');
  }
  const override = JSON.parse(fs.readFileSync(args[args.lastIndexOf('-f') + 1], 'utf8'));
  const image = override.services.api.image;
  x.replacements.push(image);
  x.active = image;
  save();
  if (image === x.nextImage && ['interrupt', 'interrupt-lock'].includes(x.failure)) {
    x.active = null;
    save();
    process.kill(process.ppid, 'SIGKILL');
    if (x.failure === 'interrupt-lock') {
      setTimeout(() => {
        x.active = image;
        save();
      }, 1400);
      return;
    }
    process.exit(1);
  }
} else if (args[0] === 'exec' && args[1] === 'zenithjoy-cn-production-db' && args[2] === 'psql') {
  const query = args.at(-1);
  if (!query.includes('READ ONLY') || !query.includes('zenithjoy.schema_migrations')) throw Error('ledger lookup must be read-only');
  x.reads += 1;
  save();
  console.log(x.database + '\n' + x.migrations.trim());
} else if (args[0] === 'inspect' && args[1] === service) {
  if (!x.active) die();
  print({image: x.active, project: labels, service: 'api', health: 'healthy'});
} else if (args[0] === 'ps' && args.includes('--all')) {
  if (x.active) console.log(service);
} else if (args[0] === 'image' && args[1] === 'inspect') {
  const found = x.images[args[2]];
  found ? print(found) : die();
} else if (args[0] === 'tag') {
  if (!x.images[args[1]] || !args[2].startsWith('zenithjoy-api-hz:retained-')) die();
  x.tags[args[2]] = args[1];
  save();
} else {
  throw Error('unexpected command: ' + args.join(' '));
}
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hz-api-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  const statePath = join(root, 'fixture.json');
  const stub = join(bin, 'docker');
  mkdirSync(bin);
  writeFileSync(stub, boundary, { mode: 0o700 });
  symlinkSync(basename(stub), join(bin, 'curl'));
  writeFileSync(join(root, 'migration.lock'), '', { mode: 0o600 });
  writeFileSync(join(root, 'compose.production.candidate.yml'), '# isolated fixture\n', { mode: 0o600 });
  const image = (id, revision) => ({ id, revision, layers, os: 'linux', architecture: 'amd64' });
  const body = {
    oldImage, nextImage, active: oldImage,
    images: {
      [oldImage]: image(oldImage, oldSha),
      [nextImage]: image(nextImage, nextSha),
    },
    database: 'zenithjoy|zenithjoy_prod|17',
    migrations,
    replacements: [],
    probes: [],
    tags: {},
    reads: 0,
  };
  writeFileSync(statePath, JSON.stringify(body));
  const env = {
    ...process.env,
    PATH: bin + ':' + process.env.PATH,
    ZJ_HZ_ROOT: root,
    ZJ_HZ_HEALTH_ATTEMPTS: '1',
    ZJ_HZ_HEALTH_INTERVAL: '0',
    HZ_FIXTURE_STATE: statePath,
  };
  const read = () => JSON.parse(readFileSync(statePath, 'utf8'));
  return {
    root,
    read,
    update(delta) { writeFileSync(statePath, JSON.stringify({ ...read(), ...delta })); },
    run(args, input = '') { return spawnSync('bash', [script, ...args], { input, env, encoding: 'utf8', timeout: 10000 }); },
    promote(input = migrations, expected = oldSha, hash = layersHash) {
      return this.run(['promote', nextSha, nextImage, hash, expected], input);
    },
  };
}
function success(result) {
  assert.equal(result.status, 0, result.stderr || result.error);
  return result.stdout;
}

test('只读检查核对生产身份和全量 SQL 清单，不写发布状态', t => {
  const f = fixture(t);
  assert.match(success(f.run(['check', nextSha], migrations)), new RegExp('HZ_RELEASE_CURRENT=' + oldSha));
  assert.deepEqual(f.read().replacements, []);
  assert.deepEqual(f.read().tags, {});
  assert.ok(f.read().reads > 0);
  assert.throws(() => readFileSync(join(f.root, 'api-release-state.json')), { code: 'ENOENT' });
});

test('待迁移、数据库身份或候选层不符均在切换前拒绝', t => {
  const f = fixture(t);
  assert.match(f.promote(migrations + '20260103_pending.sql\n').stderr, /migration/i);
  assert.match(f.promote(migrations, oldSha, 'f'.repeat(64)).stderr, /layers/i);
  f.update({ database: 'zenithjoy_staging|zenithjoy_prod|17' });
  assert.match(f.promote().stderr, /database/i);
  assert.deepEqual(f.read().replacements, []);
  assert.deepEqual(f.read().tags, {});
});

test('晋级后读到前驱，显式回滚重跑仍停在指定版本', t => {
  const f = fixture(t);
  assert.match(success(f.promote()), new RegExp('HZ_RELEASE_PREVIOUS=' + oldSha));
  assert.match(success(f.run(['check'])), new RegExp('HZ_RELEASE_PREVIOUS=' + oldSha));
  assert.deepEqual(f.read().replacements, [nextImage]);
  assert.ok(f.read().probes.some(url => url.startsWith('https://zenithjoy.tech/api/health')));
  assert.ok(f.read().probes.some(url => url.startsWith('https://autopilot.zenjoymedia.media/api/health')));
  success(f.run(['rollback', oldSha]));
  success(f.run(['rollback', oldSha]));
  assert.deepEqual(f.read().replacements, [nextImage, oldImage]);
  assert.equal(f.read().active, oldImage);
});

test('公网回验失败后自动恢复旧镜像并拒绝失败候选', t => {
  const f = fixture(t);
  f.update({ failure: 'public' });
  const result = f.promote();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /restored/i);
  assert.deepEqual(f.read().replacements, [nextImage, oldImage]);
  assert.notEqual(f.run(['rollback', nextSha]).status, 0);
});

test('容器替换中断后拒绝再晋级，显式回滚恢复已验证前驱', t => {
  const f = fixture(t);
  f.update({ failure: 'interrupt' });
  const result = f.promote();
  assert.notEqual(result.status, 0);
  assert.equal(f.read().active, null);
  assert.match(f.promote().stderr, /pending/i);
  success(f.run(['rollback', oldSha]));
  assert.equal(f.read().active, oldImage);
  assert.deepEqual(f.read().replacements, [nextImage, oldImage]);
});

test('发布进程被杀后，仍在写入的 Compose 阻止并发回滚', async t => {
  const f = fixture(t);
  f.update({ failure: 'interrupt-lock' });
  assert.notEqual(f.promote().status, 0);
  assert.match(f.run(['rollback', oldSha]).stderr, /lock is held/i);
  for (let attempt = 0; attempt < 50 && f.read().active !== nextImage; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  assert.equal(f.read().active, nextImage, 'pending writer finished without the original process');
  success(f.run(['rollback', oldSha]));
  assert.equal(f.read().active, oldImage);
});

test('同 SHA 晋级重跑幂等，旧快照要求的当前版本已变时拒绝新切换', t => {
  const f = fixture(t);
  success(f.promote());
  success(f.promote());
  success(f.run(['rollback', oldSha]));
  assert.match(f.promote(migrations, nextSha).stderr, /current/i);
  assert.deepEqual(f.read().replacements, [nextImage, oldImage]);
});

test('回滚前检测 schema 漂移，保留当前容器', t => {
  const f = fixture(t);
  success(f.promote());
  f.update({ migrations: migrations + '20260103_unreviewed.sql\n' });
  assert.match(f.run(['rollback', oldSha]).stderr, /schema/i);
  assert.deepEqual(f.read().replacements, [nextImage]);
});
