// harvest-keyword.sh 先判后采回归测试（任务 8bb3af55，决策 f18f56b8①「判定合格的视频才采集」）。
//
// 事故形状：视频判定(judge-video.js)挂在 batch2.sh 落池之后，判定不挡采集——每个视频不管合不合格，
// 评论都先采完、落池、进分拣，「先采后判则判定无意义」。纠正后每个视频在开评论区之前：
//   ssh mmv qualify-video.js discover（候选落库 pending，回报缓存判定）
//   → 未判过才录音 → scp 音频 → ssh mmv qualify-video.js judge → 只有 matched 才开评论区采集
//   → 采完 ssh mmv qualify-video.js collected（process_status=评论已采）
// 判定出错（接口故障/ssh 不通/库不可达）→ 视频留 pending，本轮跳过采集，后面的视频照常处理。
// 真跑 zsh：假 douyin-phone-adb / ssh / scp 都把调用顺序记进同一个 calls.log，断言先后。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 卡片 X 列 = 视频序号；tap-evidence（视频卡片那次，证据名以 -v<i> 结尾）记下当前视频，current-video-link 回 VID_<X>/url_<X>
const FAKE_ADB = `#!/bin/sh
shift; shift
CMD="$1"; shift
printf 'adb %s %s\\n' "$CMD" "$*" >> "$HOME/calls.log"
case "$CMD" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=TAG\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=TAG ttl=1800s\\n'; exit 0;;
  search-video-cards) printf '%b' "\${CARDS:-1\\t2\\t01:00\\tTITLE_1\\n}"; exit 0;;
  tap-evidence) case "$3" in *-v[0-9]) printf '%s' "$1" > "$HOME/cur";; esac; exit 0;;
  current-video-link) c=$(cat "$HOME/cur" 2>/dev/null); printf 'video_id=VID_%s\\nshort_url=url_%s\\n' "$c" "$c"; exit 0;;
  record-stop) printf 'record_stopped path=/tmp/x.mkv duration_seconds=26 video_streams=1 audio_streams=1 mean_volume_db=%s\\n' "\${MEAN_DB:--30}"; exit 0;;
  record-extract-audio) c=$(cat "$HOME/cur"); printf 'audio_extracted path=/tmp/rec-%s.wav\\n' "$c"; exit 0;;
  open-comments) printf 'comments_opened=1\\ncomment_count=1\\n'; exit 0;;
  collect-comments) printf 'NICK1\\tBODY1\\tDATE1\\tREGION1\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n'; exit 0;;
  commenter-identity) printf 'nickname=NICK1\\ndouyin_id=id1\\n'; exit 0;;
  commenter-card-link) printf 'profile_url=https://x\\n'; exit 0;;
esac
exit 0`;

// 假 ssh：按远端命令里的 qualify-video.js 子命令 + 视频号回话；每个视频的回话由 env QD_<VID>/QJ_<VID> 控制
//   QD_*：discover 回报的缓存判定（默认 pending）；QJ_*：judge 回报（默认 matched）；sshfail = 连不上 exit 255 无输出
const FAKE_SSH = `#!/bin/sh
printf 'ssh %s\\n' "$*" >> "$HOME/calls.log"
case "$*" in
  *qualify-video.js*)
    vid=$(printf '%s' "$*" | awk '{for(i=1;i<NF;i++) if($i=="--video-id"){v=$(i+1); gsub(/\\047/,"",v); print v}}')
    eval "qd=\\\${QD_$vid:-pending}"; eval "qj=\\\${QJ_$vid:-matched}"
    case "$*" in
      *"qualify-video.js discover"*) [ "$qd" = sshfail ] && exit 255; printf 'QUAL_DISCOVER {"status":"%s","has_transcript":%s}\\n' "$qd" "\${QT:-false}";;
      *"qualify-video.js judge"*) [ "$qj" = sshfail ] && exit 255; printf 'QUAL_RESULT {"verdict":"%s","reason":"r","kind":"k"}\\n' "$qj";;
      *"qualify-video.js collected"*) printf 'QUAL_COLLECTED {"updated":1}\\n';;
    esac;;
esac
exit 0`;
const FAKE_SCP = `#!/bin/sh
printf 'scp %s\\n' "$*" >> "$HOME/calls.log"; exit 0`;

function run(extraEnv = {}, tag = "TAG") {
  const home = mkdtempSync(join(tmpdir(), "hkjudge-"));
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  for (const [n, s] of [["douyin-phone-adb", FAKE_ADB], ["ssh", FAKE_SSH], ["scp", FAKE_SCP]]) { writeFileSync(join(bin, n), s); chmodSync(join(bin, n), 0o755); }
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", ...extraEnv };
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "2", tag, "unlimited", "jinoshengyuan-work"], { encoding: "utf8", env, timeout: 60000 });
  const p = join(home, "calls.log");
  const calls = existsSync(p) ? readFileSync(p, "utf8").trim().split("\n") : [];
  return { ...r, calls, idx: (re) => calls.findIndex((l) => re.test(l)), all: (re) => calls.filter((l) => re.test(l)) };
}
const leads = (out) => out.split("\n").filter((l) => l.startsWith("LEAD\t"));

test("matched：判定(judge)在开评论区之前；采完标「评论已采」；QUAL 行记判定结果", { skip: SKIP }, () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  const judge = r.idx(/^ssh .*qualify-video\.js judge/);
  const open = r.idx(/^adb open-comments/);
  const collected = r.idx(/^ssh .*qualify-video\.js collected/);
  assert.ok(judge >= 0, `没调判定: ${r.calls.join("\n")}`);
  assert.ok(judge < open, "开评论区必须在判定之后");
  assert.ok(r.idx(/^adb collect-comments/) < collected, "评论已采标记在采集之后");
  assert.ok(r.idx(/^ssh .*qualify-video\.js discover/) < r.idx(/^adb record-start/), "候选先落库(discover)再录音");
  assert.equal(leads(r.stdout).length, 1);
  assert.match(r.stdout, /^QUAL\tVID_1\tmatched\t/m);
});

test("rejected：判定不合格 → 不开评论区、不采、不出 LEAD/VIDEO 行，回结果页继续", { skip: SKIP }, () => {
  const r = run({ QJ_VID_1: "rejected" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.idx(/^adb open-comments/), -1, "不合格视频绝不开评论区");
  assert.equal(r.idx(/^adb collect-comments/), -1);
  assert.equal(r.idx(/qualify-video\.js collected/), -1);
  assert.equal(leads(r.stdout).length, 0);
  assert.doesNotMatch(r.stdout, /^VIDEO\t/m);
  assert.match(r.stdout, /^QUAL\tVID_1\trejected\t/m);
  assert.ok(r.idx(/qualify-video\.js judge/) < r.idx(/^adb back-to-results/));
});

test("判定接口出错(pending)：本视频跳过采集留待重判，后一个视频照常判定并采集（不挡整批）", { skip: SKIP }, () => {
  const r = run({ CARDS: "1\\t2\\t01:00\\tTITLE_1\\n2\\t3\\t01:00\\tTITLE_2\\n", QJ_VID_1: "pending" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^QUAL\tVID_1\tpending\t/m);
  assert.match(r.stdout, /^QUAL\tVID_2\tmatched\t/m);
  const L = leads(r.stdout);
  assert.equal(L.length, 1, r.stdout);
  assert.ok(L[0].endsWith("\turl_2"), "只有第二个视频的评论");
  assert.match(r.stderr, /留待重判/);
  assert.equal(r.all(/^adb open-comments/).length, 1);
});

test("ssh 不通(judge 无回话)：按 pending 处理，不采、不抛、后续视频照常", { skip: SKIP }, () => {
  const r = run({ CARDS: "1\\t2\\t01:00\\tTITLE_1\\n2\\t3\\t01:00\\tTITLE_2\\n", QJ_VID_1: "sshfail" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^QUAL\tVID_1\tpending\t/m);
  assert.equal(leads(r.stdout).length, 1);
});

test("discover 不通(库/ssh 不可达)：不录音不判定，本视频 pending 跳过", { skip: SKIP }, () => {
  const r = run({ QD_VID_1: "sshfail" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.idx(/^adb record-start/), -1);
  assert.equal(r.idx(/qualify-video\.js judge/), -1);
  assert.equal(r.idx(/^adb open-comments/), -1);
  assert.match(r.stdout, /^QUAL\tVID_1\tpending\t/m);
});

test("缓存已判 rejected：不录音、不判定、不采", { skip: SKIP }, () => {
  const r = run({ QD_VID_1: "rejected" });
  assert.equal(r.idx(/^adb record-start/), -1);
  assert.equal(r.idx(/qualify-video\.js judge/), -1);
  assert.equal(r.idx(/^adb open-comments/), -1);
  assert.match(r.stdout, /^QUAL\tVID_1\trejected\tcached/m);
});

test("缓存已判 matched：不录音不重判，直接采集", { skip: SKIP }, () => {
  const r = run({ QD_VID_1: "matched" });
  assert.equal(r.idx(/^adb record-start/), -1);
  assert.equal(r.idx(/qualify-video\.js judge/), -1);
  assert.equal(leads(r.stdout).length, 1);
  assert.match(r.stdout, /^QUAL\tVID_1\tmatched\tcached/m);
});

test("pending 但库里已有转写（上轮判定接口故障留下的）：不重录，直接判定", { skip: SKIP }, () => {
  const r = run({ QT: "true" });
  assert.equal(r.idx(/^adb record-start/), -1);
  assert.ok(r.idx(/qualify-video\.js judge/) >= 0);
  assert.equal(leads(r.stdout).length, 1);
});

test("音频有效 → scp 到 mmv 并以 --audio 传给 judge；死寂音频 → 不传音频(退回标题判定)", { skip: SKIP }, () => {
  const ok = run();
  assert.ok(ok.idx(/^scp .*rec-1\.wav mmv:/) >= 0, ok.calls.join("\n"));
  assert.ok(ok.idx(/^scp .*rec-1\.wav/) < ok.idx(/qualify-video\.js judge/));
  assert.match(ok.calls[ok.idx(/qualify-video\.js judge/)], /--audio/);
  const dead = run({ MEAN_DB: "-91.0" });
  assert.equal(dead.idx(/^scp /), -1);
  assert.doesNotMatch(dead.calls[dead.idx(/qualify-video\.js judge/)], /--audio/);
});

test("远端判定命令先 source zenithjoy-db.env（裸 ssh 没有 DATABASE_URL 会连错库）；discover 带本批 batch（去掉 -wN 词后缀）与业务线", { skip: SKIP }, () => {
  const r = run({}, "auto09292200-w3");
  for (const l of r.all(/qualify-video\.js/)) assert.match(l, /source ~\/\.credentials\/zenithjoy-db\.env/);
  const d = r.calls[r.idx(/qualify-video\.js discover/)];
  assert.match(d, /--batch '?auto09292200'? /);
  assert.match(d, /--line '?jinoshengyuan-work'?/);
});
