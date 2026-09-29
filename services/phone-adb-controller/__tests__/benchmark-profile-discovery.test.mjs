// 对标发现（对标链接获客 · discovery 活动）控制器子命令守卫。
//
// 0929 真机探明（xian-m4 legacy 机）：
//   · `snssdk1128://user/profile/?sec_uid=` 能直开他人主页（UserProfileActivity）；
//   · v.douyin.com 短链 302 → iesdouyin.com/share/user/<sec_uid>；
//   · 主页作品格子是无文字无描述的 clickable View，只能按几何取（fixture 全是真机 dump）；
//   · 「我」页同样有「抖音号：」——deeplink 失效被吞回「我」页时不能当成对标主页（靠「编辑主页」排除）；
//   · 采收循环归位不能用 back-to-results（只认搜索结果页，在主页上会一路 back 把人退出抖音），
//     改用 back-to-profile，且看见 feed 就停手不再按 back。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const FIX = new URL("./fixtures/", import.meta.url).pathname;
const SU = "MS4wLjABAAAAq88f7-bGK0rGhXKUJuqHn1Gu6EfHJfv2mPrH5o39UD4";

test("前置：zsh 可用（缺了就报红，绝不静默跳过）", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined,
    "没有 zsh —— 本文件所有守卫都会静默失效，请在 CI 里装上（别改成 skip）");
});

function registry() {
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, "legacy\tSER1\tANY-MODEL\t1200\t2664\n");
  return { dir, reg };
}

function ctl(args, extraEnv = {}) {
  const { dir, reg } = registry();
  const r = spawnSync("zsh", [SCRIPT, "--profile", "legacy", ...args], {
    encoding: "utf8",
    env: { ...process.env, DOUYIN_PHONE_REGISTRY: reg, DOUYIN_PHONE_TMP_ROOT: join(dir, "phone"), ...extraEnv },
  });
  return { code: r.status, out: r.stdout.replace(/\n+$/, ""), err: r.stderr.trim(), dir };
}

const cards = (out) => out.split("\n").filter((l) => /^\d+\t\d+\t/.test(l));

// ── 纯函数：作品网格抽卡 ──────────────────────────────────────────────────
test("主页首屏（真机 dump）→ 6 张卡，四列格式与 search-video-cards 对齐", () => {
  const r = ctl(["profile-grid-cards", FIX + "profile-other-top.xml"]);
  assert.equal(r.code, 0, r.err);
  const c = cards(r.out);
  assert.deepEqual(c.map((l) => l.split("\t").slice(0, 2).join(",")),
    ["199,1919", "600,1919", "1001,1919", "199,2426", "600,2426", "1001,2426"]);
  for (const l of c) assert.equal(l.split("\t").length, 4, `列数不齐: ${JSON.stringify(l)}`);
});

test("作品 tab 吸顶后（真机 dump）→ 12 张卡，被屏底裁掉大半的一行不出", () => {
  const c = cards(ctl(["profile-grid-cards", FIX + "profile-other-grid-scrolled.xml"]).out);
  assert.equal(c.length, 12);
  assert.ok(c.every((l) => Number(l.split("\t")[1]) < 2453), "屏底只露 211px 的格子不该出");
});

test("有合集栏的主页 → 合集栏不当卡片，只出完整可见的格子", () => {
  const c = cards(ctl(["profile-grid-cards", FIX + "profile-other-collection-bar.xml"]).out);
  assert.deepEqual(c.map((l) => l.split("\t")[1]), ["2183", "2183", "2183"]);
});

test("feed 页 → 一张卡都不出（没有已选中的作品 tab）", () => {
  assert.equal(cards(ctl(["profile-grid-cards", FIX + "feed-home.xml"]).out).length, 0);
});

// ── 纯判定：是不是他人主页 ────────────────────────────────────────────────
test("profile-check：他人主页 → 0；feed/吸顶后无身份行 → 1", () => {
  assert.equal(ctl(["profile-check", FIX + "profile-other-top.xml"]).code, 0);
  assert.equal(ctl(["profile-check", FIX + "profile-other-collection-bar.xml"]).code, 0);
  assert.equal(ctl(["profile-check", FIX + "feed-home.xml"]).code, 1);
});

test("profile-check：被吞回「我」页 → 1（「我」页也有抖音号，不能放行）", () => {
  const r = ctl(["profile-check", FIX + "own-me-page.xml"]);
  assert.equal(r.code, 1);
  assert.match(r.err, /own 我 page/);
});

test("profile-check：私密账号 → 3（主页不可用，交人工）", () => {
  const { dir } = registry();
  const x = join(dir, "private.xml");
  writeFileSync(x, readFileSync(FIX + "profile-other-top.xml", "utf8")
    .replace("</hierarchy>", '<node text="私密账号" bounds="[0,1700][1200,1800]"/></hierarchy>'));
  assert.equal(ctl(["profile-check", x]).code, 3);
});

// ── sec_uid 解析 ─────────────────────────────────────────────────────────
test("resolve-sec-uid：裸 sec_uid / www 主页链 / iesdouyin 分享链", () => {
  for (const s of [SU, `https://www.douyin.com/user/${SU}?from_tab_name=main`, `https://www.iesdouyin.com/share/user/${SU}?did=x`]) {
    const r = ctl(["resolve-sec-uid", s]);
    assert.equal(r.code, 0, `${s}: ${r.err}`);
    assert.equal(r.out.trim(), `sec_uid=${SU}`);
  }
});

test("resolve-sec-uid：短链逐跳读 302 Location（真机抓到的真实形状）", () => {
  const { dir } = registry();
  const curl = join(dir, "curl");
  writeFileSync(curl, `#!/bin/sh
printf 'HTTP/2 302\\r\\nlocation: https://www.iesdouyin.com/share/user/${SU}?did=MS4wLjABAAAAx&sec_uid=${SU}&from_ssr=1\\r\\n\\r\\n'
`);
  chmodSync(curl, 0o755);
  const r = ctl(["resolve-sec-uid", "https://v.douyin.com/ihr7Bb4kalg/"], { DOUYIN_CURL_BIN: curl });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), `sec_uid=${SU}`);
});

test("resolve-sec-uid：抖音号不是 sec_uid → 拒绝（不猜）", () => {
  assert.notEqual(ctl(["resolve-sec-uid", "aidayu000"]).code, 0);
});

// ── 归位 ─────────────────────────────────────────────────────────────────
const PKG = "com.ss.android.ugc.aweme";
test("on-user-profile：主页 Activity → 1；搜索结果页/详情页 → 0", () => {
  assert.equal(ctl(["on-user-profile", `${PKG}/${PKG}.profile.ui.UserProfileActivity`]).code, 0);
  assert.notEqual(ctl(["on-user-profile", `${PKG}/${PKG}.search.activity.SearchResultActivity`]).code, 0);
  assert.notEqual(ctl(["on-user-profile", `${PKG}/${PKG}.detail.ultra.ui.UltraDetailActivity`]).code, 0);
});

// 假 adb：前台按「已按 back 次数」取 FG_SEQ 里的第 n 项（用尽后停在最后一项）。
function backAdb(dir, seq) {
  const adb = join(dir, "adb");
  const cnt = join(dir, "backs");
  writeFileSync(adb, `#!/bin/sh
args="$*"
case "$args" in
  *get-state*) echo device;;
  *getprop*) echo ANY-MODEL;;
  *"keyevent 4"*) n=$(cat ${cnt} 2>/dev/null || echo 0); echo $((n+1)) > ${cnt};;
  *"dumpsys window"*) n=$(cat ${cnt} 2>/dev/null || echo 0); i=0
    for a in ${seq.map((s) => `'${s}'`).join(" ")}; do last="$a"; [ $i -eq $n ] && { echo "mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.$a}"; exit 0; }; i=$((i+1)); done
    echo "mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.$last}";;
esac
exit 0
`);
  chmodSync(adb, 0o755);
  return { adb, cnt };
}

test("back-to-profile：取链后多压两层（详情→暂存搜索→详情）→ 退到主页为止", () => {
  const { dir } = registry();
  const { adb, cnt } = backAdb(dir, ["detail.DetailActivity", "search.activity.SearchActivity", "detail.ultra.ui.UltraDetailActivity", "profile.ui.UserProfileActivity"]);
  const r = ctl(["back-to-profile"], { DOUYIN_ADB_BIN: adb });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /back_to_profile=1 backs=3/);
  assert.equal(readFileSync(cnt, "utf8").trim(), "3");
});

test("back-to-profile：已在 feed（主页被顶掉）→ 报错且一次 back 都不按（再按就退出抖音）", () => {
  const { dir } = registry();
  const { adb, cnt } = backAdb(dir, ["main.MainActivity"]);
  const r = ctl(["back-to-profile"], { DOUYIN_ADB_BIN: adb });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /profile page is gone/);
  assert.equal(existsSync(cnt), false, "看见 feed 还在按 back");
});

// ── open-user-profile 全流程（假 adb 按状态回 dump） ──────────────────────
function profileAdb(dir, landing) {
  const adb = join(dir, "adb");
  const st = join(dir, "state");
  const log = join(dir, "calls");
  writeFileSync(adb, `#!/bin/sh
echo "$*" >> ${log}
state=$(cat ${st} 2>/dev/null || echo other)
case "$state" in feed) x=${FIX}feed-home.xml;; *) x=${landing};; esac
case "$*" in
  *get-state*) echo device;;
  *getprop*) echo ANY-MODEL;;
  *"main.MainActivity"*) echo feed > ${st};;
  *"snssdk1128://user/profile"*) echo landed > ${st};;
  *"dumpsys window"*) echo "mCurrentFocus=Window{1 u0 ${PKG}/${PKG}.profile.ui.UserProfileActivity}";;
  *"stat -c"*) echo 100;;
  *" pull "*douyin-leadgen-ui*) eval "cp $x \\"\\$$#\\"";;
  *" pull "*) eval ": > \\"\\$$#\\"";;
esac
exit 0
`);
  chmodSync(adb, 0o755);
  return { adb, log };
}

test("open-user-profile：先归位 feed 再 deeplink，落他人主页 → 输出 sec_uid/抖音号/昵称/作品数", () => {
  const { dir } = registry();
  const { adb, log } = profileAdb(dir, FIX + "profile-other-collection-bar.xml");
  const r = ctl(["open-user-profile", `https://www.douyin.com/user/${SU}`, "t1"], { DOUYIN_ADB_BIN: adb });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, new RegExp(`^sec_uid=${SU}$`, "m"));
  assert.match(r.out, /^douyin_id=aidayu000$/m);
  assert.match(r.out, /^works_count=134$/m);
  const calls = readFileSync(log, "utf8");
  const feedAt = calls.indexOf("main.MainActivity");
  const linkAt = calls.indexOf(`snssdk1128://user/profile/?sec_uid=${SU}`);
  assert.ok(feedAt >= 0 && linkAt > feedAt, "必须先归位 feed 再开 deeplink（落点才可归因到本次 deeplink）");
});

test("open-user-profile：给了期望抖音号但页面不符 → 拒绝", () => {
  const { dir } = registry();
  const { adb } = profileAdb(dir, FIX + "profile-other-collection-bar.xml");
  const r = ctl(["open-user-profile", SU, "t2", "someoneelse"], { DOUYIN_ADB_BIN: adb });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /identity mismatch/);
});

test("open-user-profile：deeplink 被吞回「我」页 → 报错，不当成对标主页", () => {
  const { dir } = registry();
  const { adb } = profileAdb(dir, FIX + "own-me-page.xml");
  const r = ctl(["open-user-profile", SU, "t3"], { DOUYIN_ADB_BIN: adb });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /did not land on a verified user profile/);
});
