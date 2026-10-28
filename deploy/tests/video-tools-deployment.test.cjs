/** Run with node --test deploy/tests/video-tools-deployment.test.cjs.
 * YAML is interpreted as volume mappings; Nginx handles real local HTTP uploads.
 * No containers, credentials or running services are changed.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');

function resolveMount(service, file) {
  const mounts = service.volumes.map(entry => {
    if (typeof entry !== 'string') return { source: entry.source, target: entry.target, readonly: entry.read_only };
    const [source, target, flags] = entry.split(':');
    return { source, target, readonly: flags === 'ro' };
  }).filter(mount => file.startsWith(`${mount.target}/`) || file === mount.target)
    .sort((a, b) => b.target.length - a.target.length);
  assert.ok(mounts[0], `${file} must survive container replacement through a host volume`);
  assert.ok(!mounts[0].readonly, 'task state volume must be writable');
  return path.join(mounts[0].source, path.relative(mounts[0].target, file));
}

test('production and staging task files resolve to separate durable host volumes', async () => {
  const files = [];
  for (const [stage, serviceName] of [['prod', 'zenithjoy-api-prod'], ['staging', 'zenithjoy-api-staging']]) {
    const document = YAML.parse(await fs.readFile(path.join(root, `deploy/docker-compose.${stage}-api.yml`), 'utf8'));
    const service = document.services[serviceName];
    const directory = service.environment.VIDEO_TOOLS_DATA_DIR;
    assert.ok(directory && path.isAbsolute(directory), 'runtime must use an explicit absolute data directory');
    const jobFile = resolveMount(service, path.join(directory, 'account-hash', 'job.json'));
    assert.equal(jobFile, `/opt/zenithjoy/${stage}-api/video-tools/account-hash/job.json`);
    files.push(jobFile);
  }
  assert.notEqual(files[0], files[1], 'staging must never overwrite production task or idempotency state');
});

function listen(server) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
}
function close(server) { return new Promise(resolve => server.close(resolve)); }
function request(port, pathname, bytes, declaredBytes = bytes.length) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'POST', headers: { 'Content-Length': declaredBytes } }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('local Nginx request timed out'))); req.end(bytes);
  });
}
async function ready(port, child, logs) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Nginx exited: ${logs.join('')}`);
    const connected = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Nginx startup timed out: ${logs.join('')}`);
}

for (const [configName, stage, shared] of [
  ['nginx.conf', 'prod', false], ['nginx.staging.conf', 'staging', false],
  ['staff-hub/common.conf', 'prod', true], ['staff-hub/common-staging.conf', 'staging', true],
]) {
  test(`${configName}: video upload reaches the correct API, excess body is rejected, general API limit remains`, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-tools-nginx-'));
    const backends = [];
    let nginx;
    try {
      const ports = {};
      for (const name of ['prod', 'staging']) {
        const backend = http.createServer((req, res) => {
          let size = 0;
          req.on('data', chunk => { size += chunk.length; });
          req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ stage: name, url: req.url, size })); });
        });
        ports[name] = await listen(backend); backends.push(backend);
      }
      const reservation = net.createServer();
      const port = await listen(reservation); await close(reservation);
      const source = await fs.readFile(path.join(root, 'deploy', configName), 'utf8');
      let server = shared ? `server { listen 127.0.0.1:${port}; ${source} }` : source.replace(/listen 80;/, `listen 127.0.0.1:${port};`);
      // Keep the actual location rules and distinct environment routing; only replace Docker DNS with local test APIs.
      for (const name of ['prod', 'staging']) server = server.replaceAll(`http://zenithjoy-api-${name}:5200`, `http://127.0.0.1:${ports[name]}`);
      const config = `pid ${dir}/nginx.pid; error_log ${dir}/error.log; events {} http { access_log off; client_body_temp_path ${dir}/body; proxy_temp_path ${dir}/proxy; ${server} }`;
      await fs.writeFile(path.join(dir, 'nginx.conf'), config);
      const logs = [];
      nginx = spawn(process.env.NGINX_BIN || 'nginx', ['-p', `${dir}/`, '-c', path.join(dir, 'nginx.conf'), '-g', 'daemon off;'], { stdio: ['ignore', 'pipe', 'pipe'] });
      nginx.on('error', error => { logs.push(error.message); });
      nginx.stderr.on('data', data => logs.push(data.toString()));
      await ready(port, nginx, logs);
      const body = Buffer.alloc(2 * 1024 * 1024, 'a');
      const uploaded = await request(port, '/api/video-tools/uploads', body);
      assert.equal(uploaded.status, 200, uploaded.body.slice(0, 200));
      assert.deepEqual(JSON.parse(uploaded.body), {stage, url:'/api/video-tools/uploads',size:body.length});
      assert.equal((await request(port, '/api/video-tools/uploads', Buffer.alloc(0), 111 * 1024 * 1024)).status, 413);
      assert.equal((await request(port, '/api/unrelated', body)).status, 413, 'large upload allowance must stay scoped to video tools');
    } finally {
      if (nginx && nginx.exitCode === null) { nginx.kill('SIGTERM'); await new Promise(resolve => nginx.once('exit', resolve)); }
      await Promise.all(backends.map(close));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
}
