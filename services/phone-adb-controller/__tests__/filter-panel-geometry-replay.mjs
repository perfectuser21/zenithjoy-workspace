#!/usr/bin/env node
// Offline replay: only device, screenshot and vision I/O are replaced for the shell case.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const sourcePath = resolve(option('--source', new URL('../douyin-phone-adb', import.meta.url).pathname));
const scenario = option('--case', 'split');
const width = Number(option('--width', '720'));
const rows = Number(option('--rows', '5'));
const gap = Number(option('--gap', '12'));
const python = process.env.DOUYIN_PYTHON_BIN || 'python3';
const dir = mkdtempSync(join(tmpdir(), 'filter-panel-replay-'));
const output = { case: scenario, width, rows, gap, source: sourcePath, temp_isolated: true };
const run = (program, argv, opts = {}) => spawnSync(program, argv, { encoding: 'utf8', ...opts });
const emit = (code) => { output.exit_code = code; console.log(JSON.stringify(output)); process.exitCode = code; };

try {
  if (!Number.isInteger(width) || width < 480 || ![4, 5, 6].includes(rows) || !Number.isInteger(gap) || gap < 0 || gap > 50) throw Error('invalid replay geometry');
  const source = readFileSync(sourcePath, 'utf8');
  const panel = join(dir, 'panel.png');
  const result = join(dir, 'results.png');
  // Logical 4 rows have five visual chip rows: two sort rows plus time/duration/scope.
  const visualRows = rows === 4 ? 5 : rows;
  const chipWidth = Math.floor((width * 0.88 - 3 * gap) / 4);
  const left = Math.floor(width * 0.04);
  const top = 300;
  const height = 48;
  const pitch = 98;
  const rectangles = Array.from({ length: visualRows }, (_, r) =>
    Array.from({ length: rows === 6 && r === 1 ? 1 : 4 }, (_, c) => [left + c * (chipWidth + gap), top + r * pitch, left + c * (chipWidth + gap) + chipWidth - 1, top + r * pitch + height - 1]));
  const selected = scenario === 'wrong-selected' ? { sort: 2, time: 2, duration: 0, scope: 0, location: 0 } :
    { sort: 1, time: 3, duration: 0, scope: 0, location: 1 };
  const draw = `from PIL import Image,ImageDraw
import json,sys
panel,results,rectangles,selected,rows,width=sys.argv[1],sys.argv[2],json.loads(sys.argv[3]),json.loads(sys.argv[4]),int(sys.argv[5]),int(sys.argv[6])
im=Image.new('RGB',(width,1600),(45,45,45)); d=ImageDraw.Draw(im)
for r,line in enumerate(rectangles):
 for c,box in enumerate(line):
  if '${scenario}' == 'missing-column' and r==(2 if rows==6 else 1) and c==3: continue
  d.rectangle(box,fill=(245,240,240))
for r,c in [(0,selected['sort']),(2 if rows==6 else 1,selected['time']),(3 if rows==6 else 2,selected['duration']),(4 if rows==6 else 3,selected['scope'])]+([] if rows==4 else [(rows-1,selected['location'])]):
 if c<len(rectangles[r]):
  x1,y1,x2,y2=rectangles[r][c];d.rectangle((x1+15,y1+12,x1+38,y1+34),fill=(230,65,65))
d.rectangle((int(width*.52),int(1600*.62),int(width*.94),int(1600*.67)),fill=(235,55,75))
if rows==4:
 d.rectangle(rectangles[-1][0],fill=(245,240,240));d.rectangle((rectangles[-1][0][0]+5,rectangles[-1][0][1]+3,rectangles[-1][0][2]-5,rectangles[-1][0][3]-3),fill=(235,55,75))
im.save(panel)
Image.new('RGB',(width,1600),(45,45,45)).save(results)
`;
  const drawn = run(python, ['-c', draw, panel, result, JSON.stringify(rectangles), JSON.stringify(selected), String(rows), String(width)]);
  if (drawn.status !== 0) throw Error(`Pillow draw failed: ${drawn.stderr.trim()}`);
  const registry = join(dir, 'profiles.tsv');
  writeFileSync(registry, `replay\tSER1\tFAKE-MODEL\t${width}\t1600\n`);
  const env = { ...process.env, DOUYIN_PHONE_REGISTRY: registry, DOUYIN_PYTHON_BIN: python, DOUYIN_PHONE_TMP_ROOT: dir };
  const script = (name) => {
    const start = source.indexOf(`\n${name}() {`);
    const end = name === 'verify_filter_visual' ? source.indexOf('\nPY\n}\n', start) + 3 : source.indexOf('\n}\n', start);
    if (start < 0 || end < 0) throw Error(`missing original function ${name}`);
    return source.slice(start + 1, end + 2);
  };
  const pyBody = (name) => {
    const match = script(name).match(/<<'PY'\n([\s\S]*?)\nPY/);
    if (!match) throw Error(`missing original Python body ${name}`);
    return match[1];
  };
  const locate = (category, value) => {
    const grid = { 'sort:latest': [0, 1], 'time:six_months': [2, 3], 'duration:unlimited': [3, 0], 'scope:unlimited': [4, 0], 'location:same_city': [5, 1], 'location:unlimited': [5, 0] };
    if (!grid[`${category}:${value}`]) throw Error(`replay has no requested grid case: ${category}=${value}`);
    const [row, column] = grid[`${category}:${value}`];
    // Instrument the original computation at its output, preserving every branch and predicate.
    const body = pyBody('locate_filter_option').replace('import sys\n', 'import sys, json\n')
      .replace('print(f"{(left + right) // 2} {(top + bottom) // 2}")',
        'print(json.dumps({"coordinate": [(left + right) // 2, (top + bottom) // 2], "bands": column_bands, "row": [top, bottom]}))');
    const r = run(python, ['-c', body, panel, String(row), String(column)]);
    return { code: r.status, stderr: r.stderr.trim(), data: r.status === 0 ? JSON.parse(r.stdout.trim()) : null };
  };
  const verify = (sort = 'latest', time = 'six_months', location = rows === 4 ? 'unlimited' : 'same_city') => {
    const r = run(python, ['-c', pyBody('verify_filter_visual'), 'selected', panel, sort, time, 'unlimited', 'unlimited', location]);
    return { code: r.status, stderr: r.stderr.trim() };
  };
  const target = rectangles[0][1];
  output.target_rectangle = target;
  if (scenario === 'no-location-shell') {
    const fpl = run('zsh', [sourcePath, '--profile', 'replay', 'filter-panel-location', panel], { env });
    output.filter_panel_location = { code: fpl.status, stdout: fpl.stdout.trim(), stderr: fpl.stderr.trim() };
    // Temporary source copy changes I/O boundaries only; search_time_layer and its downgrade branch stay intact.
    const injected = `\ncheck_target() { :; }\nforeground_package() { print -- com.ss.android.ugc.aweme; }\n_ui_evidence_wave() { return 1; }\nlocate_cached() { print -- '100 100'; }\nwait_ms() { :; }\nsnapshot_evidence() { case "$1" in *results*) print -- '${result}';; *) print -- '${panel}';; esac; }\n${script('tap_filter_option').replace('tap_filter_option() {', '_real_tap_filter_option() {')}\ntap_filter_option() { print -- "$2=$3" >> '${join(dir, 'received.txt')}'; _real_tap_filter_option "$@"; }\n${script('verify_filter_visual').replace('verify_filter_visual() {', '_real_verify_filter_visual() {')}\nverify_filter_visual() { [[ "$1" != selected ]] || print -- "selected_location=$7" >> '${join(dir, 'received.txt')}'; _real_verify_filter_visual "$@"; }\n`;
    const caseAt = source.lastIndexOf('case "$command" in');
    const branch = source.slice(0, caseAt) + injected + '\n' + source.slice(caseAt);
    const tempSource = join(dir, 'douyin-phone-adb');
    writeFileSync(tempSource, branch);
    const adb = join(dir, 'adb');
    writeFileSync(adb, '#!/bin/sh\nexit 0\n'); chmodSync(adb, 0o755);
    const shell = run('zsh', [tempSource, '--profile', 'replay', 'search-time-layer', 'six_months', 'replay-filter', 'latest', 'unlimited', 'unlimited', 'same_city'], { env: { ...env, DOUYIN_ADB_BIN: adb } });
    output.command = ['--profile', 'replay', 'search-time-layer', 'six_months', 'replay-filter', 'latest', 'unlimited', 'unlimited', 'same_city'];
    output.shell = { code: shell.status, stdout: shell.stdout.trim(), stderr: shell.stderr.trim() };
    output.received = shell.status === 0 || shell.status === 2 ? readFileSync(join(dir, 'received.txt'), 'utf8').trim().split('\n') : [];
    emit(fpl.status === 0 && fpl.stdout.includes('has_location=0') && shell.status === 0 && shell.stdout.includes('location=unavailable') && output.received.includes('location=same_city') && output.received.includes('selected_location=unlimited') ? 0 : 1);
  } else if (scenario === 'unsupported') {
    const invalid = ['not_a_time', ''].map(value => {
      const r = run('zsh', ['-c', `${script('filter_option_grid_index')}\nfilter_option_grid_index time "$1"`, 'replay', value]);
      return { value, code: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
    });
    output.rejections = invalid;
    output.locator = { code: invalid[0].code, data: null, stderr: invalid[0].stderr };
    emit(invalid.every(v => v.code !== 0 && !v.stdout) ? 1 : 0);
  } else if (scenario === 'missing-column') {
    output.locator = locate('time', 'six_months');
    emit(output.locator.code !== 0 && !output.locator.data ? 1 : 0);
  } else if (scenario === 'wrong-selected') {
    output.verification = verify();
    emit(output.verification.code !== 0 ? 1 : 0);
  } else if (scenario === 'split' || scenario === 'filters') {
    output.locator = locate('sort', 'latest');
    const data = output.locator.data;
    const inside = data && data.coordinate[0] > target[0] && data.coordinate[0] < target[2] && data.coordinate[1] > target[1] && data.coordinate[1] < target[3];
    output.inside_target = Boolean(inside);
    if (scenario === 'filters') {
      output.targets = Object.fromEntries([['time', 'six_months'], ['duration', 'unlimited'], ['scope', 'unlimited'], ['location', rows === 4 ? 'unlimited' : 'same_city']].map(([k,v]) => [k, locate(k,v)]));
      const expected = {
        time: rectangles[rows === 6 ? 2 : 1][3],
        duration: rectangles[rows === 6 ? 3 : 2][0],
        scope: rectangles[rows === 6 ? 4 : 3][0],
        ...(rows === 4 ? {} : { location: rectangles[rows - 1][1] }),
      };
      output.target_rectangles = expected;
      output.all_inside = Object.entries(expected).every(([key, box]) => {
        const point = output.targets[key].data?.coordinate;
        return point && point[0] > box[0] && point[0] < box[2] && point[1] > box[1] && point[1] < box[3];
      });
      output.selected = verify();
      output.unselected = verify('most_liked');
    }
    const good = inside && data.bands.length >= 4 && (scenario !== 'filters' ||
      output.all_inside && Object.values(output.targets).every(v => rows === 4 && v === output.targets.location ? v.code !== 0 : v.code === 0) && output.selected.code === 0 && output.unselected.code !== 0);
    emit(good ? 0 : 1);
  } else throw Error(`unknown case ${scenario}`);
} catch (e) {
  output.error = e.message;
  emit(2);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
