import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { runWorkflowActivity } = createRequire(import.meta.url)('../keyword-workflow-activity.js');

test('真实gateway子进程逐字节返回中文评论，wrapper保留原产物与证据', async t => {
  const cwd = mkdtempSync(join(tmpdir(), 'workflow-utf8-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const expected = { schema_version: 1, run_tag: 'utf8-run', line_key: 'jinuo', status: 'completed',
    outputs: { comments: [{ text: '如何报名人工智能课程' }] }, metrics: { comments_scored: 1 },
    evidence: [{ detail: '地区：杭州' }] };
  writeFileSync(join(cwd, 'ssh'), `#!${process.execPath}
const value=${JSON.stringify(expected)};
async function main(){ for(const b of Buffer.from(JSON.stringify(value))) {
 process.stdout.write(Buffer.from([b])); await new Promise(r=>setTimeout(r,5));
}}main();`, { mode: 0o700 });
  const originalPath = process.env.PATH;
  process.env.PATH = cwd + ':' + originalPath;
  try {
    const result = await runWorkflowActivity('scoring', { run_tag: 'utf8-run', line_key: 'jinuo',
      comments: [], execution: { gateway: { host: 'fixture', cwd } } });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.outputs.comments, expected.outputs.comments);
    assert.deepEqual(result.evidence, expected.evidence);
  } finally { process.env.PATH = originalPath; }
});


// 等到入口真正开始读取stdin才分字节写入，避免进程启动时管道把字节合并。
async function fragmentedStdin(t, entry, args, input, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), 'workflow-stdin-utf8-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const marker = 'fixture-stdin-ready\n';
  const preload = join(home, 'ready.cjs');
  writeFileSync(preload, `const iterator=process.stdin[Symbol.asyncIterator];
process.stdin[Symbol.asyncIterator]=function(...args){
 process.stderr.write(${JSON.stringify(marker)});return iterator.apply(this,args);
};`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { HOME: home, PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
        NODE_OPTIONS: '--require=' + preload, ...extraEnv } });
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', feeding = false;
    const timer = setTimeout(() => { child.kill('SIGKILL');reject(Error('逐字节stdin超时')); }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stdin.on('error', () => {});
    child.stderr.on('data', chunk => {
      stderr += chunk;
      if (!feeding && stderr.includes(marker)) {
        feeding = true;
        (async () => {
          for (const byte of Buffer.from(JSON.stringify(input))) {
            child.stdin.write(Buffer.from([byte]));await new Promise(done => setTimeout(done, 4));
          }
          child.stdin.end();
        })().catch(reject);
      }
    });
    child.on('error', error => { clearTimeout(timer);reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try { resolve({ code, signal, value: JSON.parse(stdout), stderr: stderr.replaceAll(marker, '') }); }
      catch (error) { reject(error); }
    });
  });
}
const service = fileURLToPath(new URL('../', import.meta.url));
const originalRun = '无效中文批次🙂';
for (const [entry, action] of [['keyword-workflow.js', null], ['batch-activity.js', 'preflight'],
  ['video-activity.js', 'qualification'], ['comment-activity.js', 'scoring'], ['keyword-workflow-activity.js', 'collection']]) {
  test(`真实${entry}逐字节stdin本地拒绝时保留原始中文身份`, async t => {
    const out = await fragmentedStdin(t, join(service, entry), action ? [action] : [], {
      run_tag: originalRun, line_key: 'jinuo', comments: null, video: {}, device: {}, workflow_artifacts: {},
    });
    assert.equal(out.signal, null);assert.equal(out.code, 1);assert.equal(out.stderr, '');
    assert.equal(out.value.run_tag, originalRun);
    assert.equal(out.value.line_key, 'jinuo');assert.equal(out.value.status, 'failed');
  });
}

test('真实workflow-probe逐字节stdin保留中文关键词并交给显式本地读回', async t => {
  const home = mkdtempSync(join(tmpdir(), 'probe-stdin-utf8-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const word = '人工智能报名🙂';
  const trace = join(home, 'params.json');
  const deps = join(home, 'deps.mjs');
  writeFileSync(deps, `import{writeFileSync}from'node:fs';
export default{pool:{async query(text,values){writeFileSync(${JSON.stringify(trace)},JSON.stringify(values));
 return{rows:[{count:'1'}],fields:[{name:'count'}]};}}};`);
  const out = await fragmentedStdin(t, join(service, 'workflow-probe.js'), ['--deps', deps], {
    run_tag: 'utf8-probe', line_key: 'jinuo', stage: 'discovery', word, metrics: { candidates: 1 },
  });
  assert.equal(out.signal, null);assert.equal(out.code, 0);assert.equal(out.stderr, '');
  assert.deepEqual(JSON.parse(readFileSync(trace, 'utf8')), ['utf8-probe', word]);
  assert.equal(out.value.probes[0].pass, true);assert.equal(out.value.probes[0].observed, 1);
});
