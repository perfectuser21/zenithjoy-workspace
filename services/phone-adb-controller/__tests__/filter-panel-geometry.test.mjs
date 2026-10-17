import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const replay = new URL('./filter-panel-geometry-replay.mjs', import.meta.url).pathname;
const source = new URL('../douyin-phone-adb', import.meta.url).pathname;
function check(kind, width = 720, rows = 5, status = 0) {
  const r = spawnSync(process.execPath, [replay, '--source', source, '--case', kind, '--width', String(width), '--rows', String(rows), '--gap', '12'], { encoding: 'utf8' });
  const data = JSON.parse(r.stdout.trim());
  assert.equal(r.status, status, `${kind}/${width}/${rows}: ${r.stdout} ${r.stderr}`);
  assert.equal(data.exit_code, status);
  return data;
}

test('720 和 1080 的 12px 空白分列，坐标来自原定位器并落在目标矩形内', () => {
  for (const width of [720, 1080]) {
    const data = check('split', width);
    assert.ok(data.locator.data.bands.length >= 4);
    assert.equal(data.inside_target, true);
  }
});

test('4/5/6 行保持原定位和选中态拒绝', () => {
  for (const rows of [4, 5, 6]) {
    const data = check('filters', 720, rows);
    assert.equal(data.all_inside, true);
    assert.equal(data.selected.code, 0);
    assert.notEqual(data.unselected.code, 0);
  }
});

test('4 行从真实命令入口降级，向原下游传 unlimited', () => {
  const data = check('no-location-shell', 720, 4);
  assert.match(data.shell.stdout, /location=unavailable/);
  assert.ok(data.received.includes('selected_location=unlimited'));
});

test('错选、缺列、不支持参数继续失败，且没有目标坐标', () => {
  const wrong = check('wrong-selected', 720, 5, 1);
  assert.notEqual(wrong.verification.code, 0);
  for (const kind of ['missing-column', 'unsupported', 'missing-column']) {
    const data = check(kind, 720, 5, 1);
    assert.equal(data.locator.data, null);
    assert.notEqual(data.locator.code, 0);
  }
});
