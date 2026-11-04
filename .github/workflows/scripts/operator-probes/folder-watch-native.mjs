// Real OS integration probe, loaded with the package's pinned tsx. The real
// production manager receives only an observational fs.watch forwarding wrapper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createFolderWatchManager} from '../../../../services/agent/src/handlers/folder-watch.ts';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zj-native-watch-diagnostic-')));
const watched = path.join(root, 'watched');
const incoming = path.join(root, 'incoming');
const target = path.join(watched, 'native-event.mp4');
const events = [], rawEvents = [];
const started = performance.now();
const phaseBudgetMs = 8000, totalBudgetMs = 16000;
let phase = 'registration', phaseStarted = started;
let readinessMs = null, deliveryMs = null;
let probes = 0, published = 0, completed = false;
let writer, phaseDeadline, totalDeadline;
let resolveReady, resolveTarget, fail;
const ready = new Promise(resolve => { resolveReady = resolve; });
const delivered = new Promise(resolve => { resolveTarget = resolve; });
const failure = new Promise((_, reject) => { fail = reject; });
const registration = {attempted: false, registered: false, closed: false, errors: []};
const errorInfo = error => ({code: error.code, message: error.message});
const elapsed = () => Math.round(performance.now() - started);
const isReadyFile = file => /^ready-\d+\.txt$/.test(path.basename(file));
const diagnostics = () => ({
  root, watched, cwd: process.cwd(), node: process.version, execPath: process.execPath,
  tmpdir: os.tmpdir(), TMPDIR: process.env.TMPDIR, uid: process.getuid?.(),
  rootStat: {uid: fs.statSync(root).uid, mode: fs.statSync(root).mode},
  watchFunctionHash: createHash('sha256').update(fs.watch.toString()).digest('hex'),
  managerFunctionHash: createHash('sha256').update(createFolderWatchManager.toString()).digest('hex'),
  registration, phase, phaseElapsedMs: Math.round(performance.now() - phaseStarted),
  phaseBudgetMs, totalBudgetMs, readinessMs, deliveryMs, elapsedMs: elapsed(),
  rawReady: rawEvents.filter(event => event.filename && isReadyFile(event.filename)).length,
  rawEvents, events, probes, published,
});
function beginPhase(name) {
  clearTimeout(phaseDeadline);
  phase = name;
  phaseStarted = performance.now();
  phaseDeadline = setTimeout(() => fail(new Error(`Native ${name} phase exceeded ${phaseBudgetMs}ms`)), phaseBudgetMs);
}
const manager = createFolderWatchManager({
  fsWatch: (directory, options, listener) => {
    registration.attempted = true;
    try {
      const watcher = fs.watch(directory, options, (event, filename) => {
        rawEvents.push({event, filename: filename?.toString() ?? null, elapsedMs: elapsed()});
        listener(event, filename);
      });
      registration.registered = true;
      watcher.on('error', error => { registration.errors.push(errorInfo(error)); fail(error); });
      watcher.on('close', () => {
        registration.closed = true;
        if (!completed) fail(new Error('Native watcher closed before target delivery'));
      });
      return watcher;
    } catch (error) {
      registration.errors.push(errorInfo(error));
      throw error;
    }
  },
  onChange: file => {
    events.push({file, elapsedMs: elapsed()});
    if (phase === 'readiness' && isReadyFile(file)) resolveReady(file);
    if (phase === 'delivery' && file === target) resolveTarget(file);
  },
});
let report;
try {
  fs.mkdirSync(watched);
  fs.mkdirSync(incoming);
  manager.bind(watched);
  if (!registration.registered) throw new Error('Production bind did not register a native watcher');
  // Subscription startup and subsequent delivery have separate bounded costs.
  // There are no retries of the subscription or target publication.
  totalDeadline = setTimeout(() => fail(new Error(`Native total budget exceeded ${totalBudgetMs}ms`)), totalBudgetMs);
  beginPhase('readiness');
  const probe = () => {
    try {
      const name = `ready-${++probes}.txt`, staged = path.join(incoming, 'ready.partial');
      fs.writeFileSync(staged, name);
      fs.renameSync(staged, path.join(watched, name));
    } catch (error) { fail(error); }
  };
  writer = setInterval(probe, 250);
  probe();
  await Promise.race([ready, failure]);
  readinessMs = Math.round(performance.now() - phaseStarted);
  clearInterval(writer);
  clearTimeout(phaseDeadline);
  // Drain the readiness callback batch before starting the target's own clock.
  await Promise.race([new Promise(resolve => setImmediate(resolve)), failure]);
  beginPhase('delivery');
  const staged = path.join(incoming, 'video.partial');
  fs.writeFileSync(staged, 'native video publication');
  fs.renameSync(staged, target);
  published++;
  assert.equal(await Promise.race([delivered, failure]), target);
  deliveryMs = Math.round(performance.now() - phaseStarted);
  assert.equal(published, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), 'native video publication');
  assert.deepEqual(manager.listMp4s(), [target]);
  assert.ok(readinessMs <= phaseBudgetMs);
  assert.ok(deliveryMs <= phaseBudgetMs);
  assert.ok(elapsed() <= totalBudgetMs);
  assert.ok(rawEvents.some(event => event.filename && path.basename(event.filename) === path.basename(target)));
  completed = true;
  report = {platform: process.platform, target, ...diagnostics()};
} catch (error) {
  const failedPhaseMs = Math.round(performance.now() - phaseStarted);
  if (phase === 'readiness') readinessMs = failedPhaseMs;
  if (phase === 'delivery') deliveryMs = failedPhaseMs;
  console.error(JSON.stringify({error: errorInfo(error), failedPhase: phase, ...diagnostics()}));
  throw error;
} finally {
  completed = true;
  clearInterval(writer);
  clearTimeout(phaseDeadline);
  clearTimeout(totalDeadline);
  manager.stop();
  await new Promise(resolve => setImmediate(resolve));
  fs.rmSync(root, {recursive: true, force: true});
}
process.stdout.write(JSON.stringify({...report, cleanupCompleted: true}) + '\n');
