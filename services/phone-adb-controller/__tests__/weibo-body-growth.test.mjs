import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const helper = new URL('../text-input-focus.py', import.meta.url).pathname;
const fixture = phase => new URL(`./fixtures/weibo-body-${phase}.xml`, import.meta.url);
const before = readFileSync(fixture('before'), 'utf8');
const ready = readFileSync(fixture('ready'), 'utf8');
const typed = readFileSync(fixture('typed'), 'utf8');
const source = '把今天调成温柔一点的颜色。忙碌告一段落，给自己留几秒安静。愿今晚好眠，明天继续慢慢向前。';
const run = (...args) => spawnSync('python3', [helper, ...args], {encoding: 'utf8', timeout: 10000});

function context(t, initial = before) {
  const dir = mkdtempSync(join(tmpdir(), 'weibo-growth-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const xml = join(dir, 'frame.xml'), selection = join(dir, 'selection.json');
  writeFileSync(xml, initial);
  const result = run('standard-resolve', xml);
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(selection, result.stdout);
  return {xml, selection};
}

// Removing the composer-bound growth rule must reproduce the live 89→96px failure.
test('real Weibo frames allow downward body growth with exact text and current account', t => {
  const c = context(t);
  writeFileSync(c.xml, ready);
  assert.equal(run('standard-check', c.selection, c.xml).status, 0);
  writeFileSync(c.xml, typed);
  const result = run('standard-compare', c.selection, c.xml, source);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.comparison_mode, 'exact');
  assert.equal(report.actual.bytes, 132);
  assert.equal(report.actual.sha256, 'bc88254227c70b9fda44db9e8314e1fec19ca5a1c3153e3921d3736fd0ee85c5');
});

test('Weibo growth is unavailable before typing', t => {
  const c = context(t); writeFileSync(c.xml, typed);
  assert.equal(run('standard-check', c.selection, c.xml).status, 2);
});

const changeBody = (xml, fn) => xml.replace(/<node[^>]*resource-id="com.sina.weibo:id\/edit_view"[^>]*>/, fn);
for (const [name, change] of [
  ['wrong screen', x => x.replace('text="发微博"', 'text="写评论"')],
  ['changed account', x => x.replace('text="企业Ai员工智能体"', 'text="另一个账号"')],
  ['missing cancel marker', x => x.replace('com.sina.weibo:id/titleBack', 'com.sina.weibo:id/other')],
  ['missing send marker', x => x.replace('com.sina.weibo:id/titleSave', 'com.sina.weibo:id/other')],
  ['changed parent', x => x.replace('com.sina.weibo:id/sv_element_container', 'com.sina.weibo:id/other')],
  ['wrong package', x => x.replaceAll('com.sina.weibo', 'com.other.app')],
  ['body id changed', x => x.replace('com.sina.weibo:id/edit_view', 'com.sina.weibo:id/other')],
  ['left shifted', x => x.replace('[23,124][697,220]', '[24,124][697,220]')],
  ['top shifted', x => x.replace('[23,124][697,220]', '[23,125][697,220]')],
  ['right shifted', x => x.replace('[23,124][697,220]', '[23,124][698,220]')],
  ['body shrunk', x => x.replace('[23,124][697,220]', '[23,124][697,212]')],
  ['outside composer', x => x.replace('[23,124][697,220]', '[23,124][697,1000]')],
  ['password', x => changeBody(x, n => n.replace('password="false"', 'password="true"'))],
  ['disabled', x => changeBody(x, n => n.replace('enabled="true"', 'enabled="false"'))],
  ['readonly', x => changeBody(x, n => n.replace('enabled="true"', 'enabled="true" editable="false"'))],
  ['duplicate unfocused body', x => x.replace('</hierarchy>', '<node package="com.sina.weibo" class="android.widget.EditText" resource-id="com.sina.weibo:id/edit_view" focused="false"/></hierarchy>')],
  ['conflicting focus', x => x.replace('</hierarchy>', '<node package="com.sina.weibo" class="android.widget.EditText" focused="true"/></hierarchy>')],
  ['wrong text', x => x.replace('把今天调成', '把昨天调成')],
]) test(`Weibo typed readback rejects ${name}`, t => {
  const c = context(t); writeFileSync(c.xml, change(typed));
  assert.equal(run('standard-compare', c.selection, c.xml, source).status, 2);
});

test('a lookalike editor without composer markers retains strict bounds', t => {
  const c = context(t, before.replace('text="发微博"', 'text="评论"'));
  writeFileSync(c.xml, typed.replace('text="发微博"', 'text="评论"'));
  assert.equal(run('standard-compare', c.selection, c.xml, source).status, 2);
});
