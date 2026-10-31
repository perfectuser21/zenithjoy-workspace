import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createBrainClient } from '../phone-probe.mjs';

test('lock readback remains usable after synchronous ADB blocks past peer keepalive expiry', { timeout: 15000 }, async t => {
  const source = `import http from 'node:http';
const server = http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({success:true,locks:[{device_name:'SERIAL123',locked_by:'owner',expired:false,expires_at:new Date(Date.now()+7200000).toISOString()}]}));
});

test('read-only lease request retries a real connection reset once', { timeout: 15000 }, async t => {
  const source = `import http from 'node:http';let requests=0;
const server=http.createServer((req,res)=>{
  if(++requests===1){req.socket.destroy();return;}
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({success:true,locks:[{device_name:'SERIAL123',locked_by:'owner',expired:false,expires_at:new Date(Date.now()+7200000).toISOString(),requestOrdinal:requests}]}));
});server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`;
  const server = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => server.kill('SIGTERM'));
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.stdout.once('data', data => resolve(Number(data.toString().trim()))); });
  const record = await createBrainClient(`http://127.0.0.1:${port}`).lease('SERIAL123');
  assert.equal(record.requestOrdinal, 2);
});
server.keepAliveTimeout=20; server.listen(0,'127.0.0.1',()=>console.log(server.address().port));`;
  const server = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => server.kill('SIGTERM'));
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject); server.stdout.once('data', data => resolve(Number(data.toString().trim())));
  });
  assert.ok(Number.isInteger(port) && port > 0);
  const client = createBrainClient(`http://127.0.0.1:${port}`);
  assert.equal((await client.lease('SERIAL123')).locked_by, 'owner');
  for (let i = 0; i < 3; i++) {
    const block = spawnSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120)'], { timeout: 2000 });
    assert.equal(block.status, 0);
    assert.equal((await client.lease('SERIAL123')).locked_by, 'owner');
  }
});
