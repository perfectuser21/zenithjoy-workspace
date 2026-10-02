import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const here = new URL('../', import.meta.url).pathname;
const VID = '7412345678901234567';
function replay(fault = '', budget = '60', rows = '3', cardFailures = '0', { flat = false, omitKeyModule = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'comment-context-'));
  const bin = join(home, '.local/bin'); mkdirSync(bin, { recursive: true });
  const fake = `#!/bin/sh
shift 2
cmd="$1"; shift
printf '%s %s\\n' "$cmd" "$*" >> "$HOME/calls"
case "$cmd" in
 preflight) echo serial=fixture-serial;;
 lock-status) echo 'lock=held owner=TAG';;
 lock-refresh) echo lock=refreshed;;
 open-video)
  n=$(cat "$HOME/opens" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$HOME/opens"
  [ "$n" -gt 1 ] && [ "$FAULT" = open ] && exit 1
  [ "$n" -gt 1 ] && [ "$FAULT" = slow ] && /bin/sleep 10
  echo video_opened=1;;
 current-video-link)
  n=$(cat "$HOME/opens")
  if [ "$n" -gt 1 ]; then
   case "$FAULT" in identity-timeout) echo video_id=${VID}; exit 124;; slow-identity) /bin/sleep 10;; empty) exit 0;; bad) echo video_id=BAD; exit 0;; mismatch) echo video_id=7512345678901234567; exit 0;; nonzero) echo video_id=${VID}; exit 7;; esac
  fi
  printf 'video_id=${VID}\\nshort_url=https://v.douyin.com/fixture/\\n';;
 open-comments)
  if [ "$FAULT" = open-badflag ]; then echo comments_opened=10; exit 0; fi
  if [ "$FAULT" = open-nonzero ]; then echo comments_opened=1; exit 7; fi
  if [ "$FAULT" = retry-open-nonzero ]; then
   n=$(cat "$HOME/oc" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$HOME/oc"
   [ "$n" = 1 ] && exit 0
   echo comments_opened=1; exit 7
  fi
  [ "$FAULT" = panel ] && [ "$(cat "$HOME/opens")" -gt 1 ] && exit 1; printf 'comments_opened=1\\ncomment_count=3\\n';;
 collect-comments)
  n=$(cat "$HOME/opens")
  [ "$FAULT" = collect-empty-nonzero ] && exit 7
  [ "$FAULT" = later-collect-nonzero ] && case "$1" in *-cc2) exit 7;; esac
  [ "$FAULT" = missing ] && [ "$n" -gt 1 ] && { echo exhausted=1; exit 0; }
  for k in $(seq 1 "$ROWS"); do
   x=$((k*10)); y=$((k*20)); [ "$n" -gt 1 ] && { x=$((x+n*100)); y=$((y+n*100)); }
   nk="$k"; bk="$k"
   case "$FAULT" in homonyms|homonym-dirty|homonyms-sparse) nk=1; bk=1;; prefix-collision) nk=1; bk="ABCDEFGHIJKLMNOPQRST$k";; esac
   printf 'NICK%s\\tBODY%s\\tDATE\\tREGION\\tpersonal\\ttap=%s %s\\tb64=AAA\\n' "$nk" "$bk" "$x" "$y"
   [ "$FAULT" = duplicate ] && [ "$n" -gt 1 ] && [ "$k" = 2 ] && printf 'NICK2\\tBODY2\\tDATE\\tREGION\\tpersonal\\ttap=900 901\\tb64=AAA\\n'
  done
  [ "$FAULT" = fresh-no-flag ] && [ "$n" -gt 1 ] && exit 0
  if { [ "$FAULT" = scroll ] || [ "$FAULT" = sameid-scroll ] || [ "$FAULT" = known-then-sparse-scroll ] || [ "$FAULT" = sparse-then-known-scroll ] || [ "$FAULT" = known-then-unidentified-scroll ] || [ "$FAULT" = unidentified-then-known-scroll ] || [ "$FAULT" = later-collect-nonzero ]; } && [ "$n" = 1 ]; then echo exhausted=0; else echo exhausted=1; fi
  [ "$FAULT" = collect-nonzero ] && exit 7;;
 commenter-identity)
  n=$(cat "$HOME/ids" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$HOME/ids"
  [ "$n" = 2 ] && [ "$FAULT" = identity ] && exit 1
  # 行坐标映射稳定身份：恢复/翻屏重读相同客户不能按调用次数制造新ID。
  k=$(( ($1 % 100) / 10 )); nk="$k"; dyid="id$k"
  case "$FAULT" in prefix-collision) nk=1; dyid=id1;; homonyms|homonym-dirty) nk=1;; homonyms-sparse) nk=1; dyid="";; esac
  # 同一稳定客户在不同屏幕观测中ID可暂不可见；不按调用序号改变实际客户。
  screen=$(cat "$HOME/opens")
  if { [ "$FAULT" = known-then-sparse-scroll ] || [ "$FAULT" = known-then-unidentified-scroll ]; } && [ "$screen" -gt 1 ]; then dyid=""; fi
  if { [ "$FAULT" = sparse-then-known-scroll ] || [ "$FAULT" = unidentified-then-known-scroll ]; } && [ "$screen" = 1 ]; then dyid=""; fi
  atype=personal; [ -z "$dyid" ] && atype=id_not_visible
  if [ -z "$dyid" ] && { [ "$FAULT" = known-then-sparse-scroll ] || [ "$FAULT" = sparse-then-known-scroll ]; }; then atype=organization; fi
  printf 'nickname=NICK%s\\ndouyin_id=%s\\naccount_type=%s\\n' "$nk" "$dyid" "$atype";;
 commenter-card-link)
  n=$(cat "$HOME/cards" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$HOME/cards"
  [ "$n" -le "$CARD_FAILURES" ] && exit 7
  restored=0
  case "$FAULT" in homonyms|homonyms-sparse|prefix-collision) restored=1;; esac
  printf 'profile_url=https://v.douyin.com/person/\\ncomment_context_restored=%s\\ncomment_context_frame=/fixture/restored.xml\\n' "$restored";;
 tap-evidence) :;;
 back) exit 99;;
esac
exit 0`;
  const ssh = `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls"
case "$*" in *' discover '*) echo 'QUAL_DISCOVER {"status":"matched","has_transcript":true}';; *' collected '*) echo 'QUAL_COLLECTED {"updated":1}';; esac`;
  for (const [name, body] of [['douyin-phone-adb', fake], ['ssh', ssh]]) { writeFileSync(join(bin, name), body); chmodSync(join(bin, name), 0o755); }
  let executionRoot = here;
  if (flat) {
    executionRoot = join(home, 'bin-harvest'); mkdirSync(executionRoot);
    const deploy = readFileSync(join(here, 'deploy.sh'), 'utf8');
    for (const group of ['DEVICE_SH_FILES', 'DEVICE_NODE_FILES']) {
      const block = deploy.match(new RegExp(group + '=\\(([\\s\\S]*?)\\n\\)'))?.[1];
      assert.ok(block, '真实部署清单缺失：' + group);
      for (const file of block.trim().split(/\s+/)) {
        if (omitKeyModule && file === 'comment-tier-lib.js') continue;
        mkdirSync(join(executionRoot, file, '..'), { recursive: true });
        copyFileSync(join(here, file), join(executionRoot, file));
      }
    }
  }
  const r = spawnSync('zsh', [join(executionRoot, 'video-phone-activity.sh'), 'collection', 'P', 'jinuo', VID, Buffer.from('FIXTURE').toString('base64'), '', 'TAG', 'kw', budget, 'fixture-serial', 'TAG'], { encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: '1', FAULT: fault, ROWS: rows, CARD_FAILURES: cardFailures, WF_BOUNDED_POLL: '0.05' } });
  assert.equal(r.status, 0, r.stderr);
  return { ...r, executionRoot, calls: readFileSync(join(home, 'calls'), 'utf8') };
}
test('名片丢失后同视频恢复两次独立episode，fresh唯一nick/body使用新坐标且不重采首条', () => {
  const r = replay();
  assert.match(r.stdout, /ACTIVITY_STATUS\tcompleted/);
  assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 3);
  assert.match(r.calls, /commenter-identity 220 240 /);
  assert.match(r.calls, /commenter-identity 330 360 /);
  assert.doesNotMatch(r.calls, /commenter-identity 20 40 |commenter-identity 30 60 |^back /m);
  assert.equal(r.calls.match(/qualify-video.js collected/g)?.length, 1);
});
for (const [fault, reason] of [['empty', 'video_identity_unavailable'], ['bad', 'video_identity_unavailable'], ['nonzero', 'video_identity_unavailable'], ['mismatch', 'video_mismatch'], ['open', 'comment_context_unavailable'], ['panel', 'comment_context_unavailable'], ['missing', 'comment_context_unavailable'], ['duplicate', 'comment_context_unavailable']]) {
 test(`恢复${fault}一次即pending，保留第一确认评论，不用旧坐标、不标已采`, () => {
  const r = replay(fault);
  assert.match(r.stdout, new RegExp(`ACTIVITY_STATUS\\tpending\\t${reason}`));
  assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
  assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 1);
  assert.equal(r.calls.match(/^open-video /gm)?.length, 2);
  assert.doesNotMatch(r.calls, /qualify-video.js collected|^back /m);
  if (fault === 'nonzero') assert.match(r.stdout, /ACTIVITY_BINDING\t7412345678901234567\t7412345678901234567\t7/);
 });
}
test('严格panel证据拒搜索页和详情评论按钮，只接受面板结构', () => {
 const src = readFileSync(join(here, 'douyin-phone-adb'), 'utf8');
 const helper = src.match(/strict_comment_panel_open\(\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(helper, '缺少专用严格面板守卫');
 for (const [fixture, status] of [['context-search.xml', 1], ['context-panel.xml', 0], ['context-detail.xml', 1]]) {
  const r = spawnSync('zsh', ['-c', `${helper}\nstrict_comment_panel_open "$1"`, 'fixture', join(here, '__tests__/fixtures', fixture)], { encoding: 'utf8' });
  assert.equal(r.status, status, `${fixture}: ${r.stderr}`);
 }
});

function controllerReplay(command, finalFrame) {
 const home = mkdtempSync(join(tmpdir(), 'comment-controller-'));
 const registry = join(home, 'registry.tsv');
 writeFileSync(registry, 'P\tfixture-serial\tFIXTURE_MODEL\t1199\t2663\n');
 const xml = body => `<hierarchy><node ${body} /></hierarchy>`;
 const frames = {
  more: xml('content-desc="更多" bounds="[900,100][1000,200]"'),
  panel: xml('text="发私信" bounds="[400,1000][500,1100]"'),
  panel2: '<hierarchy><node text="发私信" bounds="[400,1000][500,1100]" /><node text="举报" bounds="[600,1000][700,1100]" /></hierarchy>',
  share: '<hierarchy><node text="分享给" /><node text="复制链接" bounds="[200,1000][300,1100]" /></hierarchy>',
  scratch: xml('resource-id="com.ss.android.ugc.aweme:id/et_search_kw" bounds="[144,134][833,265]"'),
  scratch2: xml('resource-id="com.ss.android.ugc.aweme:id/et_search_kw" text="https://v.douyin.com/fixture/" bounds="[144,134][833,265]"'),
 };
 for (const [name, body] of Object.entries(frames)) writeFileSync(join(home, name + '.xml'), body);
 writeFileSync(join(home, 'restored.xml'), readFileSync(join(here, '__tests__/fixtures', finalFrame)));
 writeFileSync(join(home, 'comments.xml'), readFileSync(join(here, '__tests__/fixtures', finalFrame)));
 const adb = join(home, 'adb');
 writeFileSync(adb, `#!/bin/sh
shift 2
printf '%s\\n' "$*" >> "$HOME/physical-calls"
case "$1 $2" in
 'get-state ') echo device;;
 'shell getprop') echo FIXTURE_MODEL;;
 'shell dumpsys') echo 'mCurrentFocus com.ss.android.ugc.aweme/FIXTURE';;
 'shell stat') echo 100;;
 'shell wm') echo 'Physical size: 1200x2664';;
 'pull '*)
  case "$3" in
   *-panel2.xml) frame=panel2;; *-scratch2.xml) frame=scratch2;;
   *-more.xml) frame=more;; *-panel.xml) frame=panel;; *-share.xml) frame=share;; *-scratch.xml) frame=scratch;;
   *-restored.xml) frame=restored;; *-comments.xml) frame=comments;;
   *) exit 9;;
  esac
  cp "$HOME/$frame.xml" "$3";;
esac
exit 0`);
 chmodSync(adb, 0o755);
 const args = ['commenter-card-link', 'collect-comments'].includes(command) ? [command, 'fixture'] : [command, '10', '20', Buffer.from('NICK').toString('base64'), 'fixture'];
 const result = spawnSync('zsh', [process.env.CONTEXT_CONTROLLER_TEST_PATH || join(here, 'douyin-phone-adb'), '--profile', 'P', ...args], { encoding: 'utf8', timeout: 30000,
  env: { ...process.env, HOME: home, DOUYIN_ADB_BIN: adb, DOUYIN_PHONE_REGISTRY: registry, DOUYIN_PHONE_TMP_ROOT: join(home, 'phone') } });
 return { ...result, home, calls: readFileSync(join(home, 'physical-calls'), 'utf8') };
}
for (const [frame, restored] of [['context-search.xml', 0], ['context-panel.xml', 1], ['context-detail.xml', 0]]) {
 test(`真实名片controller CLI ${frame} 保存frame并严格报告restored=${restored}`, () => {
  const r = controllerReplay('commenter-card-link', frame);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /profile_url=https:\/\/v\.douyin\.com\/fixture\//);
  assert.match(r.stdout, new RegExp(`^comment_context_restored=${restored}$`, 'm'));
  const path = r.stdout.match(/^comment_context_frame=(.+)$/m)?.[1];
  assert.equal(readFileSync(path, 'utf8'), readFileSync(join(here, '__tests__/fixtures', frame), 'utf8'));
  assert.equal(r.calls.match(/shell input keyevent 4/g)?.length, 2);
 });
}
test('真实identity CLI拒搜索推荐页，绝不点击旧行坐标', () => {
 const r = controllerReplay('commenter-identity', 'context-search.xml');
 assert.equal(r.status, 2, r.stderr);
 assert.match(r.stderr, /verified comment context was not found/);
 assert.doesNotMatch(r.calls, /input tap/);
});

test('同一episode恢复后identity仍失败即停，不能再次恢复或复用旧坐标', () => {
 const r = replay('identity');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.equal(r.calls.match(/^open-video /gm)?.length, 2);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 2);
 assert.doesNotMatch(r.calls, /qualify-video.js collected|^back /m);
});
test('恢复命令受活动剩余预算封顶，超预算立即停止且保留第一评论', () => {
 const t0 = Date.now(); const r = replay('slow', '2');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tbudget_exceeded/);
 assert.ok(Date.now() - t0 < 6000);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.equal(r.calls.match(/^open-video /gm)?.length, 2);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});

test('恢复后翻屏坐标变化也只计一次已确认评论，不重复输出LEAD', () => {
 const r = replay('scroll');
 assert.match(r.stdout, /ACTIVITY_STATUS\tcompleted/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 3);
 assert.match(r.stdout, /^VIDEO\t[^\n]+\t3$/m);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 6);
});

for (const fault of ['open-nonzero', 'retry-open-nonzero', 'open-badflag', 'collect-nonzero', 'collect-empty-nonzero']) {
 test(`独立初始${fault}即pending，不能将非零stdout当合法界面或零评论`, () => {
  const r = replay(fault);
  assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
  assert.doesNotMatch(r.stdout, /^LEAD\t|^VIDEO\t/m);
  assert.doesNotMatch(r.calls, /commenter-identity|qualify-video.js collected|^swipe |context[0-9]/m);
 });
}
test('常规后屏collect非零即pending，保留全部已确认评论不重采不标已采', () => {
 const r = replay('later-collect-nonzero');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 3);
 assert.equal(r.calls.match(/^collect-comments .*?-cc2$/gm)?.length, 1);
 assert.doesNotMatch(r.calls, /qualify-video.js collected|cc3/);
});
for (const failures of ['0', '2', '3']) {
 test(`同一已确认评论名片失败${failures}次：最多三次，安全fresh重入且只输出一次`, () => {
  const r = replay('', '60', '1', failures);
  assert.match(r.stdout, /ACTIVITY_STATUS\tcompleted/);
  const leads = r.stdout.split('\n').filter(x => x.startsWith('LEAD\t'));
  assert.equal(leads.length, 1);
  assert.equal(r.calls.match(/^commenter-card-link /gm)?.length, failures === '0' ? 1 : 3);
  if (failures !== '3') assert.match(leads[0], /https:\/\/v\.douyin\.com\/person\//);
  else assert.equal(leads[0].split('\t')[10], '');
  if (failures !== '0') {
   assert.match(r.calls, /tap-evidence 210 220 .*cl2-re/);
   assert.match(r.calls, /tap-evidence 310 320 .*cl3-re/);
  }
  assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 1);
  assert.equal(r.calls.match(/qualify-video.js collected/g)?.length, 1);
 });
}
for (const fault of ['empty', 'nonzero', 'missing']) {
 test(`名片retry恢复${fault}失败，保留当前已确认评论一次并pending`, () => {
  const r = replay(fault, '60', '1', '2');
  assert.match(r.stdout, /ACTIVITY_STATUS\tpending\t(?:video_identity_unavailable|comment_context_unavailable)/);
  assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
  assert.equal(r.calls.match(/^commenter-card-link /gm)?.length, 1);
  assert.equal(r.calls.match(/^open-video /gm)?.length, 2);
  assert.doesNotMatch(r.calls, /qualify-video.js collected|cl2-re/);
 });
}

test('恢复身份命令124而活动预算未到点应unavailable，保留安全binding返回码', () => {
 const r = replay('identity-timeout');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tvideo_identity_unavailable/);
 assert.match(r.stdout, /ACTIVITY_BINDING\t7412345678901234567\t7412345678901234567\t124/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});
test('恢复身份命令超时且真活动预算到点，应预算pending且保留binding返回码', () => {
 const t0 = Date.now(); const r = replay('slow-identity', '2');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tbudget_exceeded/);
 assert.match(r.stdout, /ACTIVITY_BINDING\t7412345678901234567\t[^\t]*\t124/);
 assert.ok(Date.now() - t0 < 6000);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});
test('真实collect controller CLI零评论panel形状变体严格接受，返回exhausted与证据', () => {
 const r = controllerReplay('collect-comments', 'context-empty-panel.xml');
 assert.equal(r.status, 0, r.stderr);
 assert.match(r.stdout, /^exhausted=[01]$/m);
 assert.doesNotMatch(r.stdout, /\ttap=/);
 assert.match(r.stdout, /^evidence=.+fixture-comments.xml$/m);
});

for (const frame of ['context-search.xml', 'context-detail.xml']) {
 test(`真实collect controller CLI拒${frame}，不能把非面板空行当零评论`, () => {
  const r = controllerReplay('collect-comments', frame);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /comment panel is not open/);
  assert.doesNotMatch(r.stdout, /^exhausted=/m);
 });
}

test('恢复fresh collect没有真实exhausted标志即pending，不继续后续旧行', () => {
 const r = replay('fresh-no-flag');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.equal(r.calls.match(/^open-video /gm)?.length, 2);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});

test('同屏同nick/body不同tap与稳定id1/id2，读取两客户并准确计数', () => {
 const r = replay('homonyms', '60', '2');
 assert.match(r.stdout, /ACTIVITY_STATUS\tcompleted/);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 2);
 assert.match(r.stdout, /^LEAD\tNICK1\tid1\t/m);
 assert.match(r.stdout, /^LEAD\tNICK1\tid2\t/m);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 2);
 assert.match(r.stdout, /^VIDEO\t[^\n]+\t2$/m);
 assert.match(r.calls, /collected.*'--count' '2'/);
});
test('同名同正文恢复fresh歧义仍pending，保首位已确认ID而不选第二旧坐标', () => {
 const r = replay('homonym-dirty', '60', '2');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 1);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.match(r.stdout, /^LEAD\tNICK1\tid1\t/m);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});
test('稳定id1坐标变化翻屏重复，只输出一条LEAD、计数1，不再次取名片', () => {
 const r = replay('sameid-scroll', '60', '1');
 assert.match(r.stdout, /ACTIVITY_STATUS\tcompleted/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.match(r.stdout, /^VIDEO\t[^\n]+\t1$/m);
 assert.equal(r.calls.match(/^commenter-card-link /gm)?.length, 1);
 assert.match(r.calls, /collected.*'--count' '1'/);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 2);
});
test('两个同nick/body且稀疏ID无法区别，保留首条并pending不能虚标已采', () => {
 const r = replay('homonyms-sparse', '60', '2');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 2);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});

test('同一ID正文前20字碰撞但全文不同，保留首条并pending不吞rawid冲突', () => {
 const r = replay('prefix-collision', '60', '2');
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 2);
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});

test('真实DEVICE清单平铺部署独立collection post-ID成功，不从repo解析key模块', () => {
 const r = replay('', '60', '1', '0', { flat: true });
 assert.match(r.stdout, /ACTIVITY_STATUS\tcompleted/);
 assert.equal(r.stdout.match(/^LEAD\t/gm)?.length, 1);
 assert.match(r.stdout, /^VIDEO\t[^\n]+\t1$/m);
 assert.ok(existsSync(join(r.executionRoot, 'comment-tier-lib.js')));
 assert.notEqual(r.executionRoot, here);
 assert.match(r.calls, /collected.*'--count' '1'/);
});
test('真实DEVICE平铺突变删除key模块必须pending，不能绕回repo或冒充已采', () => {
 const r = replay('', '60', '1', '0', { flat: true, omitKeyModule: true });
 assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
 assert.doesNotMatch(r.stdout, /^LEAD\t|^VIDEO\t/m);
 assert.match(r.stderr, /Cannot find module/);
 assert.ok(r.stderr.includes(join(r.executionRoot, 'comment-tier-lib.js')));
 assert.ok(!existsSync(join(r.executionRoot, 'comment-tier-lib.js')));
 assert.doesNotMatch(r.calls, /qualify-video.js collected/);
});

for (const fault of ['known-then-sparse-scroll', 'sparse-then-known-scroll', 'known-then-unidentified-scroll', 'unidentified-then-known-scroll']) {
 test(`同一稳定客户${fault}任一侧ID缺失，不得虚报第二客户或已采`, () => {
  const r = replay(fault, '60', '1');
  assert.match(r.stdout, /ACTIVITY_STATUS\tpending\tcomment_context_unavailable/);
  const leads = r.stdout.split('\n').filter(x => x.startsWith('LEAD\t'));
  assert.equal(leads.length, 1);
  assert.equal(leads[0].split('\t')[2], fault.startsWith('known') ? 'id1' : '');
  assert.equal(leads[0].split('\t')[3], fault.startsWith('known') ? 'personal' : fault.startsWith('sparse') ? 'organization' : 'id_not_visible');
  assert.equal(r.calls.match(/^commenter-identity /gm)?.length, 2);
  assert.equal(r.calls.match(/^commenter-card-link /gm)?.length, 1);
  assert.doesNotMatch(r.stdout, /^VIDEO\t/m);
  assert.doesNotMatch(r.calls, /qualify-video.js collected/);
 });
}
