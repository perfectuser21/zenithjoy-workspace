// harvest-keyword.sh 主页直链(commenter-card-link)重试回归测试（0929 DoD 审计批次4）。
// 事故形状：批次3发现 commenter-card-link 失败时 PURL 为空只留了一句警告就照发 LEAD——
// 主理人纠正："拿不到主页链接不代表线索没中，拿不到主页链接说明你这个网络有问题啊，
// 就重试呗"，跟 commenter-identity 同一个病，应该同一个药：先重试几次，只有重试用尽
// 仍拿不到才退化成"线索保留但主页链接缺失"的降级路径，不是一次不中就躺平。
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
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

function makeFakeAdb() {
  return `#!/bin/sh
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
  set-playback-speed) exit 1;;
  record-start) exit 0;;
  record-stop) printf 'record_stopped mean_volume_db=-20\\n'; exit 0;;
  record-extract-audio) printf 'audio_extracted path=/tmp/a.wav\\n'; exit 0;;
  open-comments) printf 'comments_opened=1\\ncomment_count=1\\n'; exit 0;;
  collect-comments) printf 'NICK1\\tBODY1\\tDATE1\\tREGION1\\tpersonal\\ttap=10 20\\tb64=AAA\\nexhausted=1\\n'; exit 0;;
  commenter-identity) printf 'nickname=NICK1\\ndouyin_id=id123\\naccount_type=personal\\n'; exit 0;;
  commenter-card-link)
    cnt="$HOME/cardlink-count"; n=$(cat "$cnt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cnt"
    if [ "$n" -le "$CARDLINK_FAIL_COUNT" ]; then exit 1; fi
    printf 'profile_url=https://profile-ok\\ncomment_context_restored=0\\n'; exit 0;;
  back) exit 0;;
  back-to-results) exit 0;;
  swipe) exit 0;;
esac
exit 0`;
}

// 先判后采(8bb3af55): 假 ssh 对 qualify-video.js 回 matched,整链路照常采集(判定本身见 harvest-keyword-judge-before-collect)
const FAKE_SSH = FAKE_SSH_QUAL;

function setup(cardlinkFailCount) {
  const home = mkdtempSync(join(tmpdir(), "hkpl-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), makeFakeAdb());
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  writeFileSync(join(home, ".local", "bin", "scp"), FAKE_SCP);
  chmodSync(join(home, ".local", "bin", "scp"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", CARDLINK_FAIL_COUNT: String(cardlinkFailCount) };
  return { home, env };
}

test("commenter-card-link 前2次失败第3次成功 → LEAD行带上正确的主页链接,不降级", { skip: SKIP }, () => {
  const { home, env } = setup(2);
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.match(r.stdout, /^LEAD\t/m, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  const leadLine = r.stdout.split("\n").find((l) => l.startsWith("LEAD\t"));
  assert.match(leadLine, /https:\/\/profile-ok/, `应带上重试成功后的主页链接, line=${leadLine}`);
  const n = Number(readFileSync(join(home, "cardlink-count"), "utf8").trim());
  assert.equal(n, 3, `应该重试到第3次才成功, 实际调用次数=${n}`);
  assert.doesNotMatch(r.stderr, /主页直链解析3次仍失败/);
  assert.doesNotMatch(readFileSync(join(home, "adb-calls.log"), "utf8"), /^open-video /m,
    "旧loop保持原契约，不启用独立活动恢复");
});

test("commenter-card-link 连续3次都失败 → 重试3次后降级(线索保留但链接为空),留痕日志", { skip: SKIP }, () => {
  const { home, env } = setup(3);
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.match(r.stdout, /^LEAD\t/m, `重试用尽仍应保留线索, stdout=${r.stdout}`);
  const n = Number(readFileSync(join(home, "cardlink-count"), "utf8").trim());
  assert.equal(n, 3, `应该恰好重试3次, 实际调用次数=${n}`);
  assert.match(r.stderr, /主页直链解析3次仍失败/, `stderr=${r.stderr}`);
});

test("commenter-card-link 首次即成功 → 不多余重试", { skip: SKIP }, () => {
  const { home, env } = setup(0);
  spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  const n = Number(readFileSync(join(home, "cardlink-count"), "utf8").trim());
  assert.equal(n, 1, `首次成功不应发起额外重试, 实际调用次数=${n}`);
});
