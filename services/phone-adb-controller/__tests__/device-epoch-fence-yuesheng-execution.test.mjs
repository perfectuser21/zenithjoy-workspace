import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createYueshengRouteOperator } from '../device-epoch-fence-yuesheng-execution.mjs';
import { yueshengMigrationRoute as route } from '../device-epoch-fence-yuesheng-readback.mjs';

function fixture(t) {
  const journalRoot = mkdtempSync(join(realpathSync(tmpdir()), 'yuesheng-wire-'));
  t.after(() => rmSync(journalRoot, { recursive: true, force: true }));
  const journal = join(journalRoot, 'yuesheng-5044-to-5045');
  mkdirSync(journal, { mode: 0o700 });
  const daemons = { old: { endpoint: route.old_endpoint }, next: { endpoint: route.new_endpoint } };
  const expiry = new Date(Date.now() + 60_000).toISOString();
  const seen = [];
  const operator = createYueshengRouteOperator({ journalRoot, daemons }, {
    bindDaemon: async daemon => { seen.push(daemon.endpoint); return daemon; },
    send: async call => {
      assert.equal(statSync(call.directory).mode & 0o777, 0o700);
      for (let i = 0; i < 3; i++) {
        assert.deepEqual(await call.readAuthority(), {
          scope: call.scope, authorized_action: call.operation, lease_until: expiry,
        });
      }
      return { operation: call.operation };
    },
  });
  return { journal, operator, seen, assertAuthority: async () => ({ lease: { expires_at: expiry } }) };
}

test('every wire admission rebinds the daemon for its own fixed operation', async t => {
  const { journal, operator, seen, assertAuthority } = fixture(t);
  for (const [operation, endpoint] of [['disconnect', route.old_endpoint], ['connect', route.new_endpoint]]) {
    assert.deepEqual(await operator({ operation, scope: { endpoint, serial: route.transport_serial }, assertAuthority, journal }), { operation });
  }
  assert.deepEqual(seen, [route.old_endpoint, route.old_endpoint, route.old_endpoint, route.new_endpoint, route.new_endpoint, route.new_endpoint]);
});

test('rejects another port, serial, operation or scope member before transport', async t => {
  const { journal, operator, seen, assertAuthority } = fixture(t);
  const scope = { endpoint: route.old_endpoint, serial: route.transport_serial };
  for (const [operation, proposed] of [
    ['connect', scope], ['inventory', scope], ['disconnect', { ...scope, serial: 'unrelated' }],
    ['disconnect', { ...scope, task: 'extra' }],
  ]) {
    await assert.rejects(operator({ operation, scope: proposed, assertAuthority, journal }), { code: 'YUESHENG_MIGRATION_ACTION_SCOPE' });
  }
  assert.deepEqual(seen, []);
});

test('stops on live authority loss during the wire gate', async t => {
  const { journal, operator, seen } = fixture(t);
  const scope = { endpoint: route.old_endpoint, serial: route.transport_serial };
  const failure = new Error('authority lost');
  await assert.rejects(operator({ operation: 'disconnect', scope, journal, assertAuthority: async () => { throw failure; } }), failure);
  assert.deepEqual(seen, []);
});
