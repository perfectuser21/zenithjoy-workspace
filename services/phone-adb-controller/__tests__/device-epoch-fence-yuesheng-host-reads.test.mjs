import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readYueshengHostObservation, readYueshengMigrationAuthority } from '../device-epoch-fence-yuesheng-host-reads.mjs';
import { yueshengMigrationRoute as route } from '../device-epoch-fence-yuesheng-readback.mjs';

const taskId = '8f5f6442-540f-48b6-9577-c21cd848aa02';
const pendingActionId = '44444444-4444-4444-8444-444444444444';

function fixtureServer(t, fixture, calls) {
  const server = createServer(socket => {
    let buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 4 && buffer[0] !== 4) {
        const count = parseInt(buffer.subarray(0, 4).toString(), 16);
        if (!Number.isFinite(count) || buffer.length < 4 + count) return;
        const command = buffer.subarray(4, 4 + count).toString();
        buffer = buffer.subarray(4 + count);
        calls.push(command);
        if (command === 'host:devices-l' || command === 'host-serial:' + route.transport_serial + ':features') {
          const value = command === 'host:devices-l' ? fixture.inventory : 'shell_v2';
          socket.end('OKAY' + value.length.toString(16).padStart(4, '0') + value);
        } else if (command === 'host:transport:' + route.transport_serial) {
          socket.write('OKAY');
        } else if (command === 'shell,v2,raw:exec /system/bin/getprop ro.serialno') {
          const out = Buffer.from(fixture.physical + '\n');
          const frame = Buffer.alloc(5);
          frame[0] = 1;
          frame.writeUInt32LE(out.length, 1);
          socket.end(Buffer.concat([Buffer.from('OKAY'), frame, out, Buffer.from([3, 1, 0, 0, 0, 0])]));
        } else {
          socket.end('FAIL0000');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return once(server, 'listening').then(() => 'tcp:127.0.0.1:' + server.address().port);
}

test('reads the active claim, central rows and exact action through only the three existing Brain GET paths', async () => {
  const task = { id: taskId, status: 'in_progress' };
  const deviceLocks = { success: true, locks: [] };
  const pendingAction = { id: pendingActionId, status: 'approved' };
  const replies = { ['/tasks/' + taskId]: task, '/device-locks': deviceLocks, ['/pending-actions/' + pendingActionId]: { action: pendingAction } };
  const calls = [];
  const read = async (...args) => {
    assert.equal(args.length, 1);
    calls.push(args[0]);
    return replies[args[0]];
  };
  assert.deepEqual(await readYueshengMigrationAuthority({ taskId, pendingActionId }, { readBrain: read }), { task, deviceLocks, pendingAction });
  assert.deepEqual(calls.sort(), Object.keys(replies).sort());
  await assert.rejects(readYueshengMigrationAuthority({ taskId: pendingActionId, pendingActionId }, { readBrain: read }),
    { code: 'YUESHENG_MIGRATION_AUTHORITY_INPUT' });
  assert.equal(calls.length, 3);
});

test('observes exact routes and authenticates the TCP target as the physical device via shell-v2', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'yuesheng-reads-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const oldFixture = { inventory: route.transport_serial + ' device transport_id:7\n', physical: route.physical_serial };
  const nextFixture = { inventory: '', physical: route.physical_serial };
  const old = await fixtureServer(t, oldFixture, calls);
  const next = await fixtureServer(t, nextFixture, calls);
  const port = endpoint => Number(endpoint.split(':').at(-1));
  const routes = new Map([[port(route.old_endpoint), port(old)], [port(route.new_endpoint), port(next)]]);
  const connect = Socket.prototype.connect;
  t.mock.method(Socket.prototype, 'connect', function (port, host, ...rest) {
    assert.equal(host, '127.0.0.1');
    assert.ok(routes.has(port), 'fixed wire endpoint only');
    return connect.call(this, routes.get(port), host, ...rest);
  });
  const daemons = { old: { endpoint: route.old_endpoint }, next: { endpoint: route.new_endpoint } };
  const lease = { device_name: route.physical_serial, locked_by: taskId, lease_version: '42',
    locked_at: new Date(Date.now() - 5_000).toISOString(), expired: false, expires_at: new Date(Date.now() + 60_000).toISOString() };
  const binds = [];
  const deps = { bindDaemon: daemon => binds.push(daemon.endpoint), readBrain: async path => {
    assert.equal(path, '/device-locks');
    return { success: true, locks: [lease] };
  } };
  const reads = { phase: 'before', journalRoot: root, daemons, expectedLease: lease };
  const observed = await readYueshengHostObservation(reads, deps);
  assert.equal(observed.old_route.endpoint, route.old_endpoint);
  assert.deepEqual(observed.old_route.devices.map(x => x.serial), [route.transport_serial]);
  assert.deepEqual(observed.new_route.devices, []);
  assert.deepEqual(observed.physical_readback, {
    endpoint: route.old_endpoint, transport_serial: route.transport_serial, observed_at: observed.observed_at,
    'ro.serialno': { exit: 0, value: route.physical_serial, diagnostic: '' },
  });
  assert.deepEqual(calls.sort(), [
    'host:devices-l', 'host:devices-l', 'host:devices-l', 'host:devices-l', 'host-serial:' + route.transport_serial + ':features',
    'host:transport:' + route.transport_serial, 'shell,v2,raw:exec /system/bin/getprop ro.serialno',
  ].sort());
  assert.ok(binds.includes(route.old_endpoint) && binds.includes(route.new_endpoint));
  const sent = calls.length;
  await assert.rejects(readYueshengHostObservation({ ...reads, daemons: { ...daemons, old: daemons.next } }, deps),
    { code: 'YUESHENG_MIGRATION_DAEMON_SCOPE' });
  await assert.rejects(readYueshengHostObservation({ ...reads, expectedLease: { ...lease, lease_version: '43' } }, deps),
    { code: 'YUESHENG_MIGRATION_HOST_LEASE' });
  assert.equal(calls.length, sent);
  oldFixture.physical = 'wrong-device';
  await assert.rejects(readYueshengHostObservation(reads, deps), { code: 'YUESHENG_MIGRATION_HOST_IDENTITY' });
  oldFixture.inventory = '';
  assert.equal((await readYueshengHostObservation({ ...reads, phase: 'between' }, deps)).physical_readback, undefined);
  nextFixture.inventory = route.transport_serial + ' device transport_id:8\n';
  const after = await readYueshengHostObservation({ ...reads, phase: 'after' }, deps);
  assert.equal(after.physical_readback.endpoint, route.new_endpoint);
  assert.equal(after.physical_readback['ro.serialno'].value, route.physical_serial);
});
