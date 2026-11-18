import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPreflightLocalPool } from '../../preflight-control-scope.mjs';

const { Pool } = createRequire(import.meta.url)('pg');
const child = process.argv.includes('--owned-pool-probe');
if (child) {
  const kind = process.argv.at(-1);
  const pg = JSON.parse(readFileSync(process.env.ZJ_NATIVE_103_PG_FIXTURE, 'utf8'));
  assert.equal(pg.database, 'cecelia_scratch');
  assert.equal(pg.host, '127.0.0.1');
  assert.notEqual(pg.port, 15532);
  const connectionString = `postgresql://${pg.user}@127.0.0.1:${pg.port}/${pg.database}`;
  const owner = createPreflightLocalPool({ Pool, connectionString, deadlineMs: Date.now() + 10000 });
  const client = await owner.pool.connect();
  if (kind === 'healthy') {
    assert.equal((await client.query('SELECT 1 AS value')).rows[0].value, 1);
    client.release();
    const proof = await owner.transport.seal();
    assert.equal(proof.execution_stopped, true);
    assert.equal(proof.connection_error, false);
  } else {
  const backend = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const ended = new Promise(resolve => client.once('end', resolve));
  if (kind === 'idle') client.release();
  const query = kind === 'query' ? client.query('SELECT pg_sleep(5)') : null;
  query?.catch(() => {});
  const admin = new Pool({ connectionString, max: 1 });
  try { assert.equal((await admin.query('SELECT pg_terminate_backend($1) AS terminated', [backend])).rows[0].terminated, true); }
  finally { await admin.end(); }
  if (query) await assert.rejects(query, /terminat|connect/i);
  let timer;
  try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('BACKEND_END_TIMEOUT')), 3000); })]); }
  finally { clearTimeout(timer); }
  if (kind !== 'idle') client.release(true);
  const proof = await owner.transport.seal();
  assert.equal(proof.execution_stopped, false, 'a connection error cannot certify a clean stop');
  assert.equal(proof.connection_error, true, 'the owned connection error must remain observable');
  }
} else {
  for (const kind of ['healthy', 'leased', 'idle', 'query']) test(`real ${kind} PostgreSQL connection keeps honest error and stop evidence`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--owned-pool-probe', kind], {
      env: process.env, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.status, 0, `real ${kind} client crashed or incorrectly certified stop: ${result.stderr}`);
    assert.equal(result.signal, null);
  });
}
