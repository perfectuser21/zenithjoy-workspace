// harvest-keyword.sh 视频链接解析失败回归测试（0929 DoD 审计发现的漏洞）。
// 事故形状：current-video-link 调用被 `|| true` 吞掉失败，VID/VURL 就是空字符串，
// 之前不检查空值直接往下录屏、采评论、产出 video_id/video_url 都是空的 LEAD/VIDEO 行——
// 跟本次先修的评论-视频错配 bug 是同一个"底层有真实校验、脚本层用 || true 吞掉且不检查
// 返回字段是否为空"的结构性模式。video_drifted 对 VID 为空时是"保守放行,不判定"，
// 拦不住这种情况，需要单独在拿到链接的地方就判断。
//
// 修法：VID/VURL 任一为空就跳过这个视频（同"图文帖跳过"分支），不产出任何数据。
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
const PY = spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!PY && "no python3");

// 同款假控制器：commenter-identity/commenter-card-link 都给出会成功的响应，只让
// current-video-link 第一次调用(拿视频身份那次)返回一个"解析失败"的坏形状(不含 video_id/
// short_url 任何一个 key，真机上超时/解析失败就是这样)。
const FAKE_ADB = `#!/bin/sh
shift; shift
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
  current-video-link) seq_reply current-video-link ""; exit 0;;
  set-playback-speed) exit 1;;
  open-comments) printf 'comments_opened=1\\ncomment_count=5\\n'; exit 0;;
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

function setup() {
  const home = mkdtempSync(join(tmpdir(), "hklf-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), FAKE_ADB);
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}` };
  return { home, env };
}

test("current-video-link 解析失败(空VID/VURL) → 跳过本视频，不产出 LEAD/VIDEO 行", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.doesNotMatch(r.stdout, /^LEAD\t/m, `视频身份解析失败时不应产出 LEAD 行, stdout=${r.stdout}`);
  assert.doesNotMatch(r.stdout, /^VIDEO\t/m, `视频身份解析失败时不应产出 VIDEO 行, stdout=${r.stdout}`);
  assert.match(r.stderr, /解析失败/, `日志应报告视频链接解析失败, stderr=${r.stderr}`);
  const calls = readFileSync(join(home, "adb-calls.log"), "utf8").split("\n").filter(Boolean);
  assert.equal(calls.filter((l) => l.startsWith("open-comments")).length, 0, "拿不到视频身份就不该继续打开评论区");
});

test("整链路(对照): current-video-link 正常解析 → 正常产出 LEAD/VIDEO 行", { skip: SKIP }, () => {
  const { home, env } = setup();
  writeFileSync(join(home, "seq-current-video-link"), "video_id=VID_A\\nshort_url=urlA\n");
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 60000 });
  assert.match(r.stdout, /^LEAD\t/m, `正常解析应产出 LEAD 行, stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stdout, /^VIDEO\t/m, `正常解析应产出 VIDEO 行, stdout=${r.stdout}`);
});
