import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { coordinate } from '../coordinator.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'listing-coordinator-'));
  return { root, businessKey: 'tenant:store:request-1', target: { store: 'store-1' }, payload: { title: 'book', price: 315 }, runId: 'run-1' };
}
function adapter(overrides = {}) {
  return { validate: async () => ({ ok: true, evidence: ['confirmed-plan'] }),
    submit: async () => ({ productId: '123', evidence: ['receipt'] }),
    lookup: async () => ({ state: 'not_found' }), ...overrides };
}

test('submission receipt is submitted, never verified; repeated request only looks up', async () => {
  const input = fixture(); let calls = 0;
  const a = adapter({ submit: async () => { calls++; return { productId: '123', evidence: ['receipt'] }; } });
  assert.equal((await coordinate(input, a)).status, 'submitted');
  assert.equal((await coordinate({ ...input, runId: 'run-2' }, a)).status, 'submitted');
  assert.equal(calls, 1);
});

test('unverified preconditions prevent any intent or submit', async () => {
  const input = fixture(); let calls = 0;
  await assert.rejects(coordinate(input, adapter({ validate: async () => ({ ok: false }), submit: async () => { calls++; } })), /PRECONDITIONS/);
  assert.equal(calls, 0);
  assert.deepEqual(readdirSync(input.root), []);
});

test('transport failure after effect is unknown, subsequent attempts never submit', async () => {
  const input = fixture(); let calls = 0;
  const a = adapter({ submit: async () => { calls++; throw new Error('connection lost'); } });
  assert.equal((await coordinate(input, a)).status, 'unknown');
  assert.equal((await coordinate(input, a)).status, 'unknown');
  assert.equal(calls, 1);
});

test('same business key rejects changed target or payload', async () => {
  const input = fixture(); await coordinate(input, adapter());
  await assert.rejects(coordinate({ ...input, target: { store: 'other' } }, adapter()), /IDENTITY_CONFLICT/);
  await assert.rejects(coordinate({ ...input, payload: { title: 'changed' } }, adapter()), /IDENTITY_CONFLICT/);
});

test('only correctly bound lookup evidence can verify', async () => {
  const input = fixture(); await coordinate(input, adapter());
  await assert.rejects(coordinate(input, adapter({ lookup: async () => ({ state: 'verified', productId: '123', evidence: ['screen'], binding: { intentId: 'wrong' } }) })), /LOOKUP_BINDING/);
  const result = await coordinate(input, adapter({ lookup: async intent => ({ state: 'verified', productId: '123', evidence: ['store-and-id-readback'], binding: { intentId: intent.intentId, fingerprint: intent.fingerprint, businessKey: intent.businessKey } }) }));
  assert.equal(result.status, 'verified');
  assert.equal((await coordinate(input, adapter())).status, 'verified');
});

test('malformed persisted intent fails closed', async () => {
  const input = fixture(); await coordinate(input, adapter());
  const directory = join(input.root, readdirSync(input.root)[0]);
  writeFileSync(join(directory, 'intent.json'), '{broken');
  await assert.rejects(coordinate(input, adapter()), /CORRUPT/);
});

const worker = new URL('./worker.mjs', import.meta.url);
function child(input, mode) {
  const p = spawn(process.execPath, [worker.pathname, JSON.stringify(input), mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = ''; p.stdout.on('data', x => output += x); p.stderr.on('data', x => error += x);
  return new Promise(resolve => p.on('close', (code, signal) => resolve({ code, signal, output, error })));
}

test('independent processes competing on one business identity submit once', async () => {
  const input = fixture();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => child({ ...input, runId: `run-${i}` }, 'normal')));
  assert.ok(results.every(x => x.code === 0), JSON.stringify(results));
  assert.equal(readFileSync(join(input.root, 'effects.log'), 'utf8').trim().split('\n').length, 1);
});

test('SIGKILL after external effect recovers with lookup across processes without second effect', async () => {
  const input = fixture();
  const first = await child(input, 'crash'); assert.equal(first.signal, 'SIGKILL');
  const second = await child({ ...input, runId: 'recovery' }, 'lookup');
  assert.equal(second.code, 0, second.error);
  assert.equal(JSON.parse(second.output).status, 'verified');
  assert.equal(readFileSync(join(input.root, 'effects.log'), 'utf8').trim().split('\n').length, 1);
});
