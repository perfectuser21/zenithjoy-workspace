// 0930 任务 913a6b03：搜索筛选偶发失败（日志只留一句「筛选失败」）。
// 取证（09-29 02:30/06:00/06:30 三批 4/12、12/12、6/12 词失败）：失败词只留下
// filter-pretab-guard.xml，树里 综合/视频/筛选 都在——守卫已过，死在后面的视觉定位
// （视频 tab / 漏斗按钮走 UI-TARS，经 OpenRouter；09-29 OpenRouter 余额耗尽 402，
// 同时段所有视觉定位全挂 = 12/12 风暴）。结果页的树是可读的、按钮带 content-desc，
// 树定位零成本且不依赖外部模型；视觉只该做兜底。另：legacy 机面板是 4 行（无「位置距离」），
// same_city 请求原来整词作废，应降级为 unlimited 并标注 location=unavailable。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SCRIPT = new URL('../douyin-phone-adb', import.meta.url).pathname;
const DISCOVER = new URL('../discover-keyword.sh', import.meta.url).pathname;
const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const fixture = (name) => join(FIXTURES, name);

test('前置：zsh 可用（缺了就报红，绝不静默跳过）', () => {
  const r = spawnSync('zsh', ['-c', 'exit 0']);
  assert.equal(r.error, undefined, '没有 zsh —— 本文件所有守卫都会静默失效，请在 CI 里装上');
});

function makeRegistry(dir) {
  const p = join(dir, 'douyin-phone-profiles.tsv');
  writeFileSync(p, 'legacy\tSER1\tANY-MODEL\t1199\t2663\n');
  return p;
}

function cli(args, extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stl-'));
  return new Promise((resolve) => {
    const p = spawn('zsh', [SCRIPT, '--profile', 'legacy', ...args], {
      env: { ...process.env, DOUYIN_PHONE_REGISTRY: makeRegistry(dir), ...extraEnv },
    });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

function fnBody(name) {
  const src = readFileSync(SCRIPT, 'utf8');
  const start = src.indexOf(`\n${name}() {`);
  assert.ok(start >= 0, `找不到函数 ${name}`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end);
}

// ── 树定位（真机 UI 树回放）────────────────────────────────────────────────

test('真机证据：搜索结果页 UI 树 → 树定位视频 tab 与筛选按钮中心点，不调视觉', async () => {
  // fixture = 09-30 legacy 真机 ffp1-filter-pretab-guard.xml：
  //   视频 tab bounds [267,317][365,383] → 中心 316 350
  //   筛选按钮 content-desc="筛选，按钮" bounds [1105,278][1161,422] → 中心 1133 350
  const r = await cli(['results-controls-from-xml', fixture('real-search-results-tabbar.xml')]);
  assert.equal(r.code, 0, `stderr=${r.err}`);
  assert.match(r.out, /^vtab=316 350$/m);
  assert.match(r.out, /^fbtn=1133 350$/m);
});

test('UI 树里没有筛选按钮 → 非 0 且不输出 fbtn（让调用方退视觉兜底，不许瞎猜坐标）', async () => {
  const xml = readFileSync(fixture('real-search-results-tabbar.xml'), 'utf8')
    .replace(/<node[^>]*content-desc="筛选，按钮"[^>]*\/>/, '');
  assert.ok(!xml.includes('筛选，按钮'), 'fixture 改造失败');
  const dir = mkdtempSync(join(tmpdir(), 'stl-nofbtn-'));
  const p = join(dir, 'no-fbtn.xml');
  writeFileSync(p, xml);
  const r = await cli(['results-controls-from-xml', p]);
  assert.notEqual(r.code, 0);
  assert.doesNotMatch(r.out, /^fbtn=/m);
});

test('UI 树文件读不到 → 非 0（拿不到证据宁可退视觉，不能假成功）', async () => {
  const r = await cli(['results-controls-from-xml', '/nonexistent/tree.xml']);
  assert.notEqual(r.code, 0);
});

// ── 4 行面板（无「位置距离」组）──────────────────────────────────────────────

const HAS_PIL = spawnSync(process.env.DOUYIN_PYTHON_BIN || 'python3', ['-c', 'import PIL']).status === 0;

test('真机证据：legacy 机 4 行筛选面板 → 判无「位置距离」行（same_city 必须降级而不是整词作废）',
  { skip: HAS_PIL ? false : '本机 python3 缺 Pillow（CI 请装 Pillow，勿改成常驻 skip）' }, async () => {
  // fixture = 09-30 legacy 真机 ffp1-filter-panel1.png 等比缩到 600 宽
  const r = await cli(['filter-panel-location', fixture('real-filter-panel-4row.png')],
    { DOUYIN_PYTHON_BIN: process.env.DOUYIN_PYTHON_BIN || 'python3' });
  assert.equal(r.code, 0, `stderr=${r.err}`);
  assert.match(r.out, /^has_location=0$/m);
});

// ── 接线守卫 ──────────────────────────────────────────────────────────────

test('接线守卫：search_time_layer 树定位优先，locate_cached 只在树读不到/没节点时兜底', () => {
  const body = fnBody('search_time_layer');
  const tree = body.indexOf('results_controls_from_xml');
  const vision = body.indexOf('locate_cached vtab');
  assert.ok(tree >= 0, 'search_time_layer 没接 results_controls_from_xml');
  assert.ok(vision > tree, '视觉定位必须排在树定位之后作兜底');
  assert.match(body, /coord_source=/, '必须输出 coord_source 让日志能看出走的是树还是视觉');
});

test('接线守卫：same_city 在无「位置距离」行的面板上降级为 unlimited，并输出 location=unavailable', () => {
  const body = fnBody('search_time_layer');
  assert.match(body, /NO_LOCATION_ROW/);
  assert.match(body, /same_city/, '降级分支必须显式处理 same_city');
  assert.match(body, /location=unavailable/);
});

test('接线守卫：筛选选项点不到时重抓面板再试一次，不是一次失败就整词作废', () => {
  const body = fnBody('search_time_layer');
  assert.match(body, /_tfo_retry/, 'tap_filter_option 调用必须包在一次重抓面板的重试里');
});

test('接线守卫：discover-keyword.sh 的「筛选失败」必须带底层原因，且 search-time-layer 失败后重来一次', () => {
  const src = readFileSync(DISCOVER, 'utf8');
  assert.doesNotMatch(src, /search-time-layer[^\n]*>\/dev\/null 2>&1 \|\| \{ log "筛选失败"; exit 1; \}/,
    'stderr 不能再整段丢进 /dev/null（失败不留原因病，决策 f425e3fd 复盘）');
  assert.match(src, /筛选失败: /, '日志必须是「筛选失败: <原因>」');
  assert.ok((src.match(/search-time-layer/g) || []).length >= 2 || /for _stl_try in/.test(src),
    'search-time-layer 失败后必须重来一次');
});
