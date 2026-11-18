// r3 真机回归：身份正确的主页没有旧 content-desc="作品 N"，可选展示值不能使导航失败。
// 执行源文件完整函数和真实页面资格判定；仅设备/网络边界替换为离线 stub。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const source = readFileSync(new URL('../douyin-phone-adb', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`${name}() {`);
  assert.ok(start >= 0, `${name} missing`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start);
  return source.slice(start, end + 2);
}
const profile = ({works = '', uid = 'fixture_target', extra = '', back = true} = {}) =>
  `<hierarchy><node text="抖音号：${uid}"/><node content-desc="离线昵称，复制名字和修改备注"/>${back ? '<node content-desc="返回"/>' : ''}${works}${extra}</hierarchy>`;

function run(xml, expected = 'fixture_target') {
  const dir = mkdtempSync(join(tmpdir(), 'profile-optional-'));
  try {
    writeFileSync(join(dir, 'landing.xml'), xml);
    const script = `set -euo pipefail
setopt EXTENDED_GLOB
EVIDENCE_ROOT="$1"
LANDING="$EVIDENCE_ROOT/landing.xml"
DOUYIN_PACKAGE=com.ss.android.ugc.aweme
ADB=/usr/bin/true
SERIAL=offline
require_evidence_id() { [[ "$1" == probe ]]; }
resolve_sec_uid() { print -- MS4wLjABAAAAfixture; }
ensure_feed() { print feed >> "$EVIDENCE_ROOT/steps"; }
wait_ms() { :; }
foreground_package() { print -- "$DOUYIN_PACKAGE"; }
foreground_gate() { print gate >> "$EVIDENCE_ROOT/steps"; }
_ui_evidence_wave() { cp "$LANDING" "$EVIDENCE_ROOT/$1.xml"; }
snapshot_evidence() { print snapshot >> "$EVIDENCE_ROOT/steps"; }
die() { print -u2 -- "$1"; exit 29; }
${extract('_profile_check_xml')}
${extract('open_user_profile')}
open_user_profile MS4wLjABAAAAfixture probe "$2"
`;
    const r = spawnSync('zsh', ['-c', script, 'offline', dir, expected], {encoding: 'utf8', timeout: 5000});
    assert.equal(r.error, undefined);
    return {code:r.status, out:r.stdout, err:r.stderr,
      steps:readFileSync(join(dir, 'steps'), 'utf8')};
  } finally { rmSync(dir, {recursive:true, force:true}); }
}

test('正确 UID 且缺旧作品数：完整函数成功并明确返回 unknown', () => {
  const r = run(profile({works:'<node text="作品" content-desc=""/>'}));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^profile_opened=1$/m);
  assert.match(r.out, /^douyin_id=fixture_target$/m);
  assert.match(r.out, /^works_count=unknown$/m);
  assert.match(r.steps, /^feed\ngate\nsnapshot\n$/);
});
test('有旧格式作品数：继续保留数值输出', () => {
  const r = run(profile({works:'<node content-desc="作品 0"/>'}));
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^works_count=0$/m);
});
test('缺作品数且错误 UID：仍在身份门禁拒绝，不截图或报成功', () => {
  const r = run(profile(), 'different_target');
  assert.equal(r.code, 29);
  assert.match(r.err, /identity mismatch/);
  assert.doesNotMatch(r.out, /profile_opened=1/);
  assert.doesNotMatch(r.steps, /snapshot/);
});
for (const [name, options, message] of [
  ['自己主页', {extra:'<node text="编辑主页"/>'}, /own 我 page/],
  ['私密主页', {extra:'<node text="私密账号"/>'}, /unavailable/],
  ['缺身份', {uid:''}, /did not land on a verified/],
  ['缺返回', {back:false}, /back button absent/],
]) test(`${name}：缺作品数不放宽原页面资格`, () => {
  const r = run(profile(options));
  assert.equal(r.code, 29);
  assert.match(r.err, message);
  assert.doesNotMatch(r.out, /profile_opened=1/);
  assert.doesNotMatch(r.steps, /snapshot/);
});
