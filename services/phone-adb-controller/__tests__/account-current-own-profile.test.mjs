// douyin-phone-adb account-current 误读他人主页回归测试（0930 新建）。
//
// 事故（0930 00:39 后，xian-m4 legacy）：抖音重开时恢复到了**别人的主页**（outreach-tick 刚私信过的
// 用户「乌啦啦啦」，页面有「私信」按钮），account-current 见到「抖音号：」就当成自己主页直接读号，
// 输出 douyin_id=1958291263（别人的号）；wf-run.sh 预检据此判 account_mismatch 拦掉整批。
// 现场证据（fixtures 均为真机原样 dump）：
//   real-0930-foreign-profile-after-dm.xml  误读现场：他人主页，content-desc="私信"、无「编辑主页」/「切换账号」
//   real-0930-own-profile-cold-start.xml    强制重启抖音后读到的真·自己主页（44997267357）：有「编辑主页」「切换账号」
//   real-0929-2230-preflight-search-results.xml  22:30 批预检现场：停在搜索结果页（全屏无底部导航）
// 契约：只有「抖音号：」+ 自己主页标记（text=编辑主页 或 content-desc 以「切换账号」开头）且无「私信」
//      按钮才算自己主页；落在他人主页先按 verified back 退回再点「我」；点完仍不是自己主页就报错退出——
//      宁可读不到，也不能读错。wf-run.sh 预检读号前先 force-stop + 冷启动 MainActivity（0914 铁律）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const WF_RUN = new URL("../wf-run.sh", import.meta.url).pathname;
const FX = new URL("./fixtures/", import.meta.url).pathname;
const PROFILE = "legacy";
const HAS_XMLLINT = spawnSync("/usr/bin/xmllint", ["--version"]).error === undefined;
const HAS_ZSH = spawnSync("zsh", ["-c", "exit 0"]).error === undefined;
const SKIP = !(HAS_XMLLINT && HAS_ZSH) && "缺 zsh 或 /usr/bin/xmllint（CI 装 zsh libxml2-utils）";

const fx = (name) => readFileSync(join(FX, name), "utf8");
const FOREIGN = fx("real-0930-foreign-profile-after-dm.xml");
const OWN = fx("real-0930-own-profile-cold-start.xml");
const SEARCH = fx("real-0929-2230-preflight-search-results.xml");
const FEED = fx("feed-home.xml");
const FOREIGN_ID = "1958291263";
const OWN_ID = "44997267357";

// 假 adb：每次 uiautomator dump 按序取下一份夹具（用完重复最后一份），argv 记日志。
const FAKE_ADB = `#!/bin/sh
args="$*"
echo "$args" >> "$FIXTURE_DIR/adb-argv.log"
n=$(cat "$DUMP_COUNT" 2>/dev/null || echo 0)
case "$args" in
  *"get-state"*) echo device; exit 0;;
  *"getprop ro.product.model"*) echo ANY-MODEL; exit 0;;
  *"dumpsys window"*) printf 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\\n'; exit 0;;
  *"uiautomator dump"*)
    n=$((n+1)); echo $n > "$DUMP_COUNT"
    f="$FIXTURE_DIR/$n.xml"; [ -f "$f" ] || f="$FIXTURE_DIR/last.xml"
    cp "$f" "$FIXTURE_DIR/current.xml"; echo "UI hierchary dumped"; exit 0;;
  *"stat -c"*) wc -c < "$FIXTURE_DIR/current.xml" | tr -d ' '; exit 0;;
  *" pull "*) for last; do :; done; cp "$FIXTURE_DIR/current.xml" "$last"; exit 0;;
esac
exit 0`;

function setup(fixtures) {
  const dir = mkdtempSync(join(tmpdir(), "acctown-"));
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, `${PROFILE}\tSER1\tANY-MODEL\t1199\t2663\n`);
  const adb = join(dir, "fake-adb");
  writeFileSync(adb, FAKE_ADB);
  chmodSync(adb, 0o755);
  fixtures.forEach((xml, i) => writeFileSync(join(dir, `${i + 1}.xml`), xml));
  writeFileSync(join(dir, "last.xml"), fixtures[fixtures.length - 1]);
  return { dir, reg, adb, count: join(dir, "dump-count") };
}

function run(ctx, args) {
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", PROFILE, ...args], {
      env: {
        ...process.env,
        DOUYIN_PHONE_REGISTRY: ctx.reg,
        DOUYIN_ADB_BIN: ctx.adb,
        DOUYIN_PHONE_TMP_ROOT: join(ctx.dir, "phone-tmp"),
        FIXTURE_DIR: ctx.dir,
        DUMP_COUNT: ctx.count,
      },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

const field = (out, k) => (out.split("\n").find((l) => l.startsWith(`${k}=`)) || "").slice(k.length + 1);
const adbLog = (ctx) => { try { return readFileSync(join(ctx.dir, "adb-argv.log"), "utf8"); } catch { return ""; } };

test("own-profile 纯判定：真机自己主页=1，他人主页/搜索结果页=0", { skip: SKIP }, async () => {
  const cases = [
    ["real-0930-own-profile-cold-start.xml", 0, "own"],
    ["own-me-page.xml", 0, "own"],
    ["real-0930-foreign-profile-after-dm.xml", 1, "foreign"],
    ["profile-other-top.xml", 1, "foreign"],
    ["real-0929-2230-preflight-search-results.xml", 1, "none"],
  ];
  for (const [name, code, kind] of cases) {
    const ctx = setup([FEED]);
    const r = await run(ctx, ["own-profile", join(FX, name)]);
    assert.equal(r.code, code, `${name}: err=${r.err}`);
    assert.equal(field(r.out, "own_profile"), code === 0 ? "1" : "0", name);
    assert.equal(field(r.out, "profile_kind"), kind, name);
  }
});

test("0930 原样：一直停在他人主页 → 报错退出，绝不输出别人的 douyin_id", { skip: SKIP }, async () => {
  const ctx = setup([FOREIGN]);
  const r = await run(ctx, ["account-current", "acct-t"]);
  assert.notEqual(r.code, 0, `不该成功: out=${r.out}`);
  assert.ok(!r.out.includes(FOREIGN_ID), `stdout 泄出了他人抖音号: ${r.out}`);
  assert.equal(field(r.out, "douyin_id"), "");
  assert.match(adbLog(ctx), /keyevent 4/, "落在他人主页应先走 verified back 退回");
});

test("他人主页 → verified back 一步回到自己主页 → 读出自己的号", { skip: SKIP }, async () => {
  const ctx = setup([FOREIGN, OWN]);
  const r = await run(ctx, ["account-current", "acct-t"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "douyin_id"), OWN_ID);
  assert.match(adbLog(ctx), /keyevent 4/);
});

test("点「我」tab 后落地的却是他人主页 → 报错退出，不读号", { skip: SKIP }, async () => {
  const ctx = setup([FEED, FOREIGN]);
  const r = await run(ctx, ["account-current", "acct-t"]);
  assert.notEqual(r.code, 0, `不该成功: out=${r.out}`);
  assert.ok(!r.out.includes(FOREIGN_ID), `stdout 泄出了他人抖音号: ${r.out}`);
});

test("首页 → 点「我」→ 真自己主页：照常读出自己的号", { skip: SKIP }, async () => {
  const ctx = setup([FEED, OWN]);
  const r = await run(ctx, ["account-current", "acct-t"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "douyin_id"), OWN_ID);
  assert.match(adbLog(ctx), /input tap/, "应点过「我」tab");
});

test("已在自己主页：直接读号，不按返回", { skip: SKIP }, async () => {
  const ctx = setup([OWN]);
  const r = await run(ctx, ["account-current", "acct-t"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "douyin_id"), OWN_ID);
  assert.doesNotMatch(adbLog(ctx), /keyevent 4/);
});

test("接线守卫：wf-run.sh 预检读号前先 force-stop 抖音 → 冷启动 MainActivity → 等 4 秒（0914 铁律）", () => {
  const src = readFileSync(WF_RUN, "utf8");
  const iIdle = src.indexOf("CALL_STATE_IDLE=1");
  const iAcct = src.indexOf('account-current "$TAG');
  const seg = src.slice(iIdle, iAcct);
  assert.ok(iIdle > 0 && iAcct > iIdle, "找不到通话检测/读号锚点");
  const iStop = seg.indexOf("am force-stop com.ss.android.ugc.aweme");
  const iStart = seg.indexOf("am start -n com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity");
  const iSleep = seg.indexOf("/bin/sleep 4");
  assert.ok(iStop >= 0, "读号前缺 force-stop 抖音");
  assert.ok(iStart > iStop, "force-stop 之后要冷启动 MainActivity");
  assert.ok(iSleep > iStart, "冷启动后要等 4 秒再读号");
});
