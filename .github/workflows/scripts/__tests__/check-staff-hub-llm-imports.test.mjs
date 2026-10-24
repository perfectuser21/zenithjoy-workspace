import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const cli = fileURLToPath(new URL('../../../../scripts/check-staff-hub-llm-imports.mjs', import.meta.url));
const extensions = ['mjs', 'cjs', 'js', 'ts', 'tsx', 'jsx'];
const modules = ['openai', 'anthropic', '@anthropic-ai/sdk'];
const forms = [
  ['单引号 import', mod => `import client from '${mod}';`],
  ['双引号 import', mod => `import client from "${mod}";`],
  ['单引号 require', mod => `const client = require('${mod}');`],
  ['双引号 require', mod => `const client = require("${mod}");`],
];

function sandbox(t, createApp = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-088c3431-imports-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'apps', 'staff-hub');
  if (createApp) fs.mkdirSync(app, { recursive: true });
  return {
    root,
    app,
    write(relative, content) {
      const file = path.join(app, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    },
  };
}

function run(root) {
  return spawnSync(process.execPath, [cli], { cwd: root, encoding: 'utf8', timeout: 10000 });
}

function exited(result, status) {
  assert.equal(result.error, undefined, 'CLI 必须正常启动且未超时');
  assert.equal(result.signal, null, 'CLI 不得被信号终止');
  assert.equal(result.status, status, 'CLI 退出码');
}

function allowed(result) {
  exited(result, 0);
  assert.equal(result.stdout, 'OK\n');
  assert.equal(result.stderr, '');
}

function blocked(result, diagnostics) {
  exited(result, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(result.stderr.trimEnd().split('\n').sort(), [...diagnostics].sort());
}

for (const extension of extensions) {
  for (const mod of modules) {
    for (const [label, source] of forms) {
      test(`${extension} 阻断 ${mod}（${label}）`, t => {
        const box = sandbox(t);
        const file = box.write(`src/sample.${extension}`, source(mod));
        blocked(run(box.root), [`${file}: ${mod}`]);
      });
    }
  }
  test(`${extension} 允许内置模块且不执行源码`, t => {
    const box = sandbox(t);
    box.write(`sample.${extension}`, [
      ...forms.map(([, source], i) => source(i % 2 ? 'node:fs' : 'node:path')),
      'throw new Error("待扫描文本不得执行");',
    ].join('\n'));
    allowed(run(box.root));
  });
}

for (const excluded of ['node_modules', 'dist', 'src/node_modules', 'src/dist']) {
  for (const extension of ['mjs', 'cjs']) {
    test(`${excluded} 排除 ${extension}，普通 src 仍扫描`, t => {
      const box = sandbox(t);
      const source = extension === 'mjs' ? "import x from 'openai';" : "require('anthropic');";
      const mod = extension === 'mjs' ? 'openai' : 'anthropic';
      box.write(`${excluded}/bad.${extension}`, source);
      box.write('src/allowed.js', 'export const ok = 1;');
      allowed(run(box.root));
      const visible = box.write(`src/visible.${extension}`, source);
      // 精确诊断同时保证被排除目录的路径没有泄漏。
      blocked(run(box.root), [`${visible}: ${mod}`]);
    });
  }
}

test('缺失应用目录明确拒绝', t => {
  const box = sandbox(t, false);
  const result = run(box.root);
  exited(result, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'apps/staff-hub not found\n');
});

test('空目录和六种空文件均通过', t => {
  const box = sandbox(t);
  allowed(run(box.root));
  for (const extension of extensions) box.write(`empty.${extension}`, '');
  allowed(run(box.root));
});

function runAsync(root) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cli], { cwd: root, timeout: 10000 });
    const result = { stdout: '', stderr: '', error: undefined };
    child.stdout.setEncoding('utf8').on('data', chunk => { result.stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { result.stderr += chunk; });
    child.on('error', error => { result.error = error; });
    child.on('close', (status, signal) => resolve({ ...result, status, signal }));
  });
}

test('重复命中去重、大文件末尾、多模块、重跑与并发只读且修正后恢复', async t => {
  const box = sandbox(t);
  const repeated = "import x from 'openai';\nimport x from 'openai';\nrequire('@anthropic-ai/sdk');";
  const long = `${' '.repeat(1024 * 1024)}require('anthropic');`;
  const repeatFile = box.write('src/repeat.mjs', repeated);
  const longFile = box.write('src/long.cjs', long);
  const diagnostics = [`${repeatFile}: openai`, `${repeatFile}: @anthropic-ai/sdk`, `${longFile}: anthropic`];
  blocked(run(box.root), diagnostics);
  blocked(run(box.root), diagnostics);
  const results = await Promise.all([runAsync(box.root), runAsync(box.root)]);
  for (const result of results) blocked(result, diagnostics);
  assert.equal(fs.readFileSync(repeatFile, 'utf8'), repeated);
  assert.equal(fs.readFileSync(longFile, 'utf8'), long);
  box.write('src/repeat.mjs', "import x from 'node:path';");
  box.write('src/long.cjs', "require('node:fs');");
  allowed(run(box.root));
});
