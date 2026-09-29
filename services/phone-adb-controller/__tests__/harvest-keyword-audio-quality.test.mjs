// harvest-keyword.sh 音频质量拦截回归测试（0929 DoD 审计发现的两处"只警告不拦截"）。
//
// 事故①: 录到死寂音频(mean_volume_db<=-80)时,0924那次修复的注释本来就写着"不写就没人
// 看得见,会静默退化成title-only判定"——但代码从来没真的退化,AUDIO_PATH照样非空,照样
// 把死寂音频当正常数据送去转写，白烧一次API调用还占着pending队列(死寂不是暂时性问题，
// 重试不会变好)。
//
// 事故②: 契约要求"实际录制时长≥预算的80%"，之前完全没有这道比对。关键点(用户0929现场
// 核对过)：比较基准必须是 $REC_SECONDS(3倍速录制预算，比如60秒原视频→预算≈26秒)，
// 不是原视频时长——拿原视频秒数当分母会让所有录制永远达不到80%。
//
// 修法：两种情况都是"作废本段音频，AUDIO_PATH清空，让judge-video.js走已有的title-only
// 兜底分支"，不改变 Alex 0924 拍板的"真·无声视频是合法内容，不die"这个既有决定。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假控制器：DUR("01:00") → VIDEO_SECONDS=60 → REC_SECONDS=ceil(62/3)+5=26。
// 通过环境变量控制 record_stopped 回报的 duration_seconds / mean_volume_db，
// 模拟"死寂但时长够"、"时长不够但音量正常"、"两者都正常"三种场景。
const FAKE_ADB = `#!/bin/sh
shift; shift
CMD="$1"; shift
printf '%s\\n' "$CMD $*" >> "$HOME/adb-calls.log"
case "$CMD" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=TAG\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=TAG ttl=1800s\\n'; exit 0;;
  open-app) exit 0;;
  open-search) exit 0;;
  search-video-tab) exit 0;;
  search-time-layer) exit 0;;
  search-video-cards) printf '1\\t2\\t01:00\\tTITLE_A\\n'; exit 0;;
  tap-evidence) exit 0;;
  current-video-link) printf 'video_id=VID_A\\nshort_url=urlA\\n'; exit 0;;
  set-playback-speed) exit 0;;
  record-start) exit 0;;
  record-stop) printf 'record_stopped path=/tmp/x.mkv duration_seconds=%s video_streams=1 audio_streams=1 mean_volume_db=%s\\n' "\${REC_DUR:-26}" "\${MEAN_DB:--30}"; exit 0;;
  record-extract-audio) printf 'audio_extracted path=/tmp/x.wav\\n'; exit 0;;
  open-comments) printf 'comments_opened=1\\ncomment_count=1\\n'; exit 0;;
  collect-comments) printf 'NICK1\\tBODY1\\tDATE1\\tREGION1\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n'; exit 0;;
  commenter-identity) printf 'nickname=NICK1\\ndouyin_id=id1\\n'; exit 0;;
  commenter-card-link) printf 'profile_url=https://x\\n'; exit 0;;
  back) exit 0;;
  back-to-results) exit 0;;
  swipe) exit 0;;
esac
exit 0`;

const FAKE_SSH = `#!/bin/sh
exit 0`;

function setup(extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "hkaudio-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), FAKE_ADB);
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", ...extraEnv };
  return { home, env };
}

test("死寂音频(mean_volume_db<=-80，时长够) → 不产出 AUDIO 行(作废退回title-only)", { skip: SKIP }, () => {
  const { env } = setup({ MEAN_DB: "-91.0", REC_DUR: "26" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.doesNotMatch(r.stdout, /^AUDIO\t/m, `死寂时不应产出 AUDIO 行, stdout=${r.stdout}`);
  assert.match(r.stderr, /死寂/, `stderr=${r.stderr}`);
  assert.match(r.stdout, /^LEAD\t/m, "音频作废不影响评论照常采集");
});

test("录制时长不足预算80%(音量正常) → 不产出 AUDIO 行(作废退回title-only)", { skip: SKIP }, () => {
  // REC_SECONDS=26(60秒视频/3倍速), 80%=20.8, 只录了5秒明显不够
  const { env } = setup({ MEAN_DB: "-30.0", REC_DUR: "5" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.doesNotMatch(r.stdout, /^AUDIO\t/m, `时长不足时不应产出 AUDIO 行, stdout=${r.stdout}`);
  assert.match(r.stderr, /时长不足/, `stderr=${r.stderr}`);
});

test("对照: 音量正常+时长达标 → 正常产出 AUDIO 行", { skip: SKIP }, () => {
  const { env } = setup({ MEAN_DB: "-30.0", REC_DUR: "26" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.match(r.stdout, /^AUDIO\t/m, `正常情况应产出 AUDIO 行, stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.doesNotMatch(r.stderr, /死寂|时长不足/, `stderr=${r.stderr}`);
});

test("对照: 时长恰好80%边界(20.8s，向上取整场景) → 不误杀", { skip: SKIP }, () => {
  const { env } = setup({ MEAN_DB: "-30.0", REC_DUR: "21" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.match(r.stdout, /^AUDIO\t/m, `21秒(>20.8)应视为达标, stdout=${r.stdout}\nstderr=${r.stderr}`);
});
