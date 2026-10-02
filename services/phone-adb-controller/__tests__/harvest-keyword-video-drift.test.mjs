// harvest-keyword.sh 评论-视频错配回归测试（0929 生产事故的永久闸）。
// 事故：commenter-identity 验证失败后的抢救逻辑（back + 重开评论区）不核对退回后屏幕上的
// 视频是否还是当前处理的 $VID——生产实证：悦升云端线索表 2026-09-28 晚 3 条记录，"来源视频"
// 都标着同一条视频（13岁满级小孩靠ai和代码拿到百万级别商单合作），但"原始评论"内容完全
// 不相关（讨论演员刘品言/电视剧绿光森林/游戏角色唐钰小宝）——退栈深度不固定（取决于此前
// 逐条评论者主页往返次数，0922 已实证退栈次数写死必错），抢救只解决"面板丢了"，没解决
// "退到了别的视频"，commenter-identity 在错误页面上照样能验证成功，评论被贴上了原视频的
// 标题/链接标签。
// 修法：抢救重开成功后，重新核对 current-video-link 的 video_id 是否仍等于本视频的 $VID，
// 不一致（漂移）就整条视频剩余评论作废，不再产出 LEAD 行。
//
// 做法：纯函数级断言走 HARVEST_KEYWORD_LIB=1 source；整链路断言用假 douyin-phone-adb 控制器
// 模拟"抢救后落到了别的视频"的时序，zsh 真跑 harvest-keyword.sh，断言不产出 LEAD 行且日志
// 报"漂移"。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SSH_QUAL, FAKE_SCP } from "./qual-fakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const PY = spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!PY && "no python3");

function lib(cmd) {
  // set -uo pipefail 下 harvest-keyword.sh 顶部会读 $1..$4(P/KW/MAXV/TAG)——source 时不给
  // 占位位置参数会在那一步触发 unbound variable 直接中断，源文件里定义在其后的函数(包括
  // video_drifted)根本不会被声明，调用会拿到 127(command not found)而不是函数本身的返回值。
  return spawnSync(ZSH, ["-c", `set -- P kw 1 TAG; HARVEST_KEYWORD_LIB=1 source ${HK}; ${cmd}`], { encoding: "utf8" });
}

test("video_drifted: 预期与观测一致 → 未漂移(非0)", { skip: SKIP }, () => {
  assert.notEqual(lib(`video_drifted VID_A VID_A`).status, 0);
});
test("video_drifted: 观测为空(读不到) → 判漂移(0)", { skip: SKIP }, () => {
  assert.equal(lib(`video_drifted VID_A ""`).status, 0);
});
test("video_drifted: 观测与预期不同 → 判漂移(0)", { skip: SKIP }, () => {
  assert.equal(lib(`video_drifted VID_A VID_B`).status, 0);
});
test("video_drifted: 预期本身为空 → 保守放行,不判定(非0)", { skip: SKIP }, () => {
  assert.notEqual(lib(`video_drifted "" VID_B`).status, 0);
});

// ── 整链路：模拟"身份验证失败→抢救→落到了别的视频"的生产事故时序 ──
const FAKE_ADB = `#!/bin/sh
shift; shift  # 去掉 --profile P
CMD="$1"; shift
printf '%s\\n' "$CMD $*" >> "$HOME/adb-calls.log"
seq_reply() {
  cnt="$HOME/cnt-$1"; n=$(cat "$cnt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cnt"
  seqfile="$HOME/seq-$1"
  if [ -f "$seqfile" ]; then
    line=$(sed -n "\${n}p" "$seqfile")
    if [ -n "$line" ]; then printf '%b\\n' "$line"; return 0; fi
  fi
  printf '%b\\n' "$2"
}
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
  current-video-link) seq_reply current-video-link "video_id=VID_A\\\\nshort_url=urlA"; exit 0;;
  # 0929测试: 故意让倍速菜单"找不到"(exit 1),走 harvest-keyword.sh 自带的降级分支
  # ("跳过本视频音频,不影响评论采集")——跳过整段录屏(真机约 25s+ 睡眠),音频录制跟本次
  # 要测的视频漂移 bug 完全无关,不缩短它测试要跑几十秒真等待，纯粹是无谓的慢。
  set-playback-speed) exit 1;;
  record-start) exit 0;;
  record-stop) printf 'record_stopped mean_volume_db=-20\\n'; exit 0;;
  record-extract-audio) printf 'audio_extracted path=/tmp/a.wav\\n'; exit 0;;
  open-comments) seq_reply open-comments "comments_opened=1\\\\ncomment_count=5"; exit 0;;
  collect-comments) seq_reply collect-comments "NICK1\\tBODY1\\tDATE1\\tREGION1\\tpersonal\\ttap=10 20\\tb64=AAA\\\\nexhausted=1" "exhausted=1"; exit 0;;
  commenter-identity) seq_reply commenter-identity "" "nickname=WRONGNICK\\\\ndouyin_id=wrongid123"; exit 0;;
  commenter-card-link) printf 'profile_url=https://drifted-profile\\n'; exit 0;;
  back) exit 0;;
  back-to-results) exit 0;;
  swipe) exit 0;;
esac
exit 0`;

// 先判后采(8bb3af55): 假 ssh 对 qualify-video.js 回 matched,整链路照常采集(判定本身见 harvest-keyword-judge-before-collect)
const FAKE_SSH = FAKE_SSH_QUAL;

function setup() {
  const home = mkdtempSync(join(tmpdir(), "hkvd-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), FAKE_ADB);
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  writeFileSync(join(home, ".local", "bin", "scp"), FAKE_SCP);
  chmodSync(join(home, ".local", "bin", "scp"), 0o755);
  // commenter-identity: 第1次失败(空,触发抢救) → 第2次"成功"但其实是抢救后落到的别的视频
  writeFileSync(join(home, "seq-commenter-identity"), "\n" + "nickname=WRONGNICK\\ndouyin_id=wrongid123\n");
  // current-video-link: 第1次(tap进视频后)=VID_A ; 第2次(抢救重开后的漂移核对)=VID_B(漂移)
  writeFileSync(join(home, "seq-current-video-link"), "video_id=VID_A\\nshort_url=urlA\n" + "video_id=VID_B\\nshort_url=urlB\n");
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1" };
  return { home, env };
}

test("整链路: 抢救后视频漂移 → 不产出 LEAD 行, 日志报漂移, 不再重试身份验证", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.doesNotMatch(r.stdout, /^LEAD\t/m, `漂移后不应产出 LEAD 行, stdout=${r.stdout}`);
  assert.match(r.stderr, /漂移/, `日志应报告视频漂移, stderr=${r.stderr}`);
  const calls = readFileSync(join(home, "adb-calls.log"), "utf8").split("\n").filter(Boolean);
  const idCalls = calls.filter((l) => l.startsWith("commenter-identity"));
  assert.equal(idCalls.length, 1, `漂移确认后不应再重试身份验证, 实际调用=${idCalls.length}`);
  const cardCalls = calls.filter((l) => l.startsWith("commenter-card-link"));
  assert.equal(cardCalls.length, 0, "漂移后不应再去取主页直链(那是错误视频评论者的主页)");
});

test("整链路(对照): 抢救后视频未漂移(仍是VID_A) → 正常产出 LEAD 行", { skip: SKIP }, () => {
  const { home, env } = setup();
  // 覆盖 seq: 第2次 current-video-link 也回 VID_A(未漂移)
  writeFileSync(join(home, "seq-current-video-link"), "video_id=VID_A\\nshort_url=urlA\n" + "video_id=VID_A\\nshort_url=urlA\n");
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.match(r.stdout, /^LEAD\t/m, `未漂移应正常产出 LEAD 行, stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.doesNotMatch(r.stderr, /漂移/);
});

test("video_drifted: 坏格式观测仍保守拒绝，独立身份分类不能放开旧守卫", { skip: SKIP }, () => {
  assert.equal(lib(`video_drifted 7412345678901234567 malformed`).status, 0);
});
