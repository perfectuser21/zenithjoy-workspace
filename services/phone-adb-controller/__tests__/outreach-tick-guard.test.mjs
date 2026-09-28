// outreach-tick.sh 护栏回归测试（0928 生产事故的永久闸）。
// 事故：①手机界面读取失败被归成笼统 other→连续 3 次永久熔断+线索被标「受阻」 ②熔断后无任何告警
//       ③账号熔断/停发/撞上限时 mark requeue 后 continue，选单器又随机选号取到同一条线索，
//         每 ~20 秒空转一轮（4 天累计 ~9800 次 ssh + 飞书调用） ④预写「触达中」不校验。
// 做法：把脚本复制进临时目录（state 落在临时目录），PATH 前置假 ssh / 假 douyin-phone-adb，
//       zsh 真跑整条 tick；假 ssh 记录 argv 并按远端命令内容回放。函数级断言走 OUTREACH_TICK_SOURCED=1 source。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, chmodSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const PY = spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!PY && "no python3");

const FAKE_SSH = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/ssh-calls.log"
seq_reply() {
  cnt="$HOME/$1.cnt"; n=$(cat "$cnt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cnt"
  line=$(sed -n "\${n}p" "$HOME/$1.seq" 2>/dev/null)
  if [ -n "$line" ]; then printf '%s\\n' "$line"; else printf '%s\\n' "$2"; fi
}
case "$*" in
  *notify-bark.js*) [ -f "$HOME/bark-fail" ] && exit 1; echo BARK_OK;;
  *"next-outreach.js next"*) seq_reply next NO_PENDING;;
  *"next-outreach.js done"*) seq_reply done "MARKED ok";;
esac
exit 0`;

// 假控制器：--profile P <cmd> ...；private-message-send 输出 $HOME/send.out 并失败，其余命令成功
const FAKE_ADB = `#!/bin/sh
echo "$*" >> "$HOME/adb-calls.log"
case "$3" in
  private-message-send) cat "$HOME/send.out" 2>/dev/null; exit 1;;
esac
exit 0`;

function shanghaiDate() {
  return spawnSync("date", ["+%Y%m%d"], { encoding: "utf8", env: { ...process.env, TZ: "Asia/Shanghai" } }).stdout.trim();
}

function setup({ ramp = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), "otg-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const tick = join(home, "tick");
  mkdirSync(join(tick, "config"), { recursive: true });
  mkdirSync(join(tick, "state"), { recursive: true });
  for (const f of ["outreach-tick.sh", "dm-daily-cap.js", "dm-rate-ramp-lib.js"]) copyFileSync(join(SRC, f), join(tick, f));
  writeFileSync(join(tick, "config", "dm-rate-ramp.json"), JSON.stringify(ramp));
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH); chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), FAKE_ADB); chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  const env = { ...process.env, HOME: home, OUTREACH_TICK_TESTING: "1", OUTREACH_TICK_LOCK: join(home, "tick.lock"), WALL_REPORT: "/nonexistent" };
  delete env.OUTREACH_TICK_SOURCED;
  const state = join(tick, "state");
  return {
    home, tick, state, env,
    script: join(tick, "outreach-tick.sh"),
    seq(name, lines) { writeFileSync(join(home, `${name}.seq`), lines.join("\n") + "\n"); },
    flag(profile, content = "") { writeFileSync(join(state, `dm-paused-${profile}.flag`), content); },
    stateFile(name, content) { writeFileSync(join(state, name), content); },
    tickRun() { return spawnSync(ZSH, [join(tick, "outreach-tick.sh")], { encoding: "utf8", env, timeout: 60000 }); },
    // source 后执行一段 zsh：args 作为 $1..
    fn(code, ...args) { return spawnSync(ZSH, ["-c", `OUTREACH_TICK_SOURCED=1 source "${join(tick, "outreach-tick.sh")}"; ${code}`, "_", ...args], { encoding: "utf8", env, timeout: 60000 }); },
    ssh() { const p = join(home, "ssh-calls.log"); return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []; },
    adb() { const p = join(home, "adb-calls.log"); return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean) : []; },
    log() { const p = join(home, "outreach.log"); return existsSync(p) ? readFileSync(p, "utf8") : ""; },
  };
}
const nextCalls = (c) => c.ssh().filter((l) => l.includes("next-outreach.js next"));
const doneCalls = (c) => c.ssh().filter((l) => l.includes("next-outreach.js done"));
const barkCalls = (c) => c.ssh().filter((l) => l.includes("notify-bark.js"));
const decodeBark = (line) => {
  const m = line.match(/notify-bark\.js (\S+) (\S+) (\S+)/);
  return { title: Buffer.from(m[1], "base64").toString(), body: Buffer.from(m[2], "base64").toString(), level: m[3] };
};
const ORDER_LEGACY = JSON.stringify({ rid: "recX1", nick: "测试昵称", dyid: "abc12345", msg_b64: "aGk=", profile: "legacy", sender_id: "44997267357", seq: 5, profile_url: "https://v.douyin.com/x/" });

// ── a. 两号都熔断：选单只问 1 次、带 --exclude、NO_SENDER 即停、无 requeue 空转、Bark 只 1 次且当日去重 ──
test("a 两个账号都熔断：只取单 1 次(带 --exclude 两号)、无 requeue、Bark 1 次；同日再跑不再发", { skip: SKIP }, () => {
  const c = setup();
  c.flag("jinoshengyuan-work", "熔断: 测试\n");
  c.flag("legacy", "");
  c.seq("next", ["NO_SENDER", "NO_SENDER"]);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const nexts = nextCalls(c);
  assert.equal(nexts.length, 1, `应只取单 1 次，实际 ${nexts.length}: ${nexts.join(" | ")}`);
  assert.match(nexts[0], /next-outreach\.js next --exclude jinoshengyuan-work,legacy(\s|$)/);
  assert.equal(doneCalls(c).length, 0, "NO_SENDER 后不得再 mark(requeue 空转)");
  assert.equal(c.adb().length, 0, "不得碰手机");
  const barks = barkCalls(c);
  assert.equal(barks.length, 1, "熔断停摆只应告警 1 次");
  const b = decodeBark(barks[0]);
  assert.match(b.title, /获客触达停摆/);
  assert.match(b.body, /legacy/); assert.match(b.body, /dm-paused/);
  assert.match(c.log(), /NO_SENDER|均不可用/);
  // 同一天再跑一次 tick：仍只问 1 次选单，但 Bark 不再发（notify_once 去重）
  const r2 = c.tickRun();
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(nextCalls(c).length, 2);
  assert.equal(barkCalls(c).length, 1, "同日第二次 tick 不得重复告警");
});

// ── b. 只有 legacy 熔断 ──
test("b 只有 legacy 熔断：取单带 --exclude legacy；选不到单就正常收工", { skip: SKIP }, () => {
  const c = setup();
  c.flag("legacy", "");
  c.seq("next", ["NO_PENDING"]);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const nexts = nextCalls(c);
  assert.equal(nexts.length, 1);
  assert.match(nexts[0], /--exclude legacy(\s|$)/);
  assert.ok(!/--exclude\s+\S*jinoshengyuan-work/.test(nexts[0]));
  assert.equal(barkCalls(c).length, 0, "只有一个号熔断且仍有单可选时，这次 tick 不该发停摆告警");
});

test("b2 都没有问题：取单不带 --exclude", { skip: SKIP }, () => {
  const c = setup();
  c.seq("next", ["NO_PENDING"]);
  c.tickRun();
  const nexts = nextCalls(c);
  assert.equal(nexts.length, 1);
  assert.ok(!nexts[0].includes("--exclude"), nexts[0]);
});

// ── c. 当日停发 / 撞上限 能被 unavailable_list 识别 ──
test("c 当日停发(halt文件)与撞上限(计数≥上限)被 unavailable_list / profile_unavailable 识别", { skip: SKIP }, () => {
  const c = setup({ ramp: { legacy: { mode: "fixed", base_per_day: 3 } } });
  const d = shanghaiDate();
  // 无任何标记：可用
  assert.equal(c.fn("unavailable_list").stdout.trim(), "");
  assert.equal(c.fn('profile_unavailable legacy').stdout.trim(), "");
  // 撞上限：3/3
  c.stateFile(`dm-count-legacy-${d}.txt`, "3\n");
  assert.equal(c.fn('profile_unavailable legacy').stdout.trim(), "cap");
  assert.equal(c.fn("unavailable_list").stdout.trim(), "legacy");
  // 没到上限 2/3
  c.stateFile(`dm-count-legacy-${d}.txt`, "2\n");
  assert.equal(c.fn('profile_unavailable legacy').stdout.trim(), "");
  // 当日停发（jinoshengyuan-work 无 ramp 配置=不限量，但有 halt 文件）
  c.stateFile(`dm-halt-jinoshengyuan-work-${d}.txt`, "触发平台风控\n");
  assert.equal(c.fn('profile_unavailable jinoshengyuan-work').stdout.trim(), "halted");
  assert.equal(c.fn("unavailable_list").stdout.trim(), "jinoshengyuan-work");
  // 昨天的 halt 文件不算
  c.stateFile("dm-halt-legacy-19990101.txt", "old\n");
  assert.equal(c.fn('profile_unavailable legacy').stdout.trim(), "");
  // 熔断优先于停发/上限；两号都不可用 → 逗号分隔、顺序固定
  c.flag("legacy", "");
  c.stateFile(`dm-count-legacy-${d}.txt`, "9\n");
  assert.equal(c.fn('profile_unavailable legacy').stdout.trim(), "paused");
  assert.equal(c.fn("unavailable_list").stdout.trim(), "jinoshengyuan-work,legacy");
});

test("c2 整 tick：撞上限的账号被排除，且不发生 requeue 空转", { skip: SKIP }, () => {
  const c = setup({ ramp: { legacy: { mode: "fixed", base_per_day: 1 } } });
  c.stateFile(`dm-count-legacy-${shanghaiDate()}.txt`, "1\n");
  c.stateFile(`dm-halt-jinoshengyuan-work-${shanghaiDate()}.txt`, "x\n");
  c.seq("next", ["NO_SENDER"]);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(nextCalls(c).length, 1);
  assert.match(nextCalls(c)[0], /--exclude jinoshengyuan-work,legacy(\s|$)/);
  assert.equal(doneCalls(c).length, 0);
  assert.equal(barkCalls(c).length, 0, "仅停发/撞上限（非熔断）不属于「停摆告警」，由平台风控/日上限自身语义承载");
});

// ── d. CLAIM_FAILED ──
test("d CLAIM_FAILED：tick 结束、Bark 1 次、无发送、不 mark", { skip: SKIP }, () => {
  const c = setup();
  c.seq("next", ["CLAIM_FAILED 状态=待触达", "CLAIM_FAILED 状态=待触达"]);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(nextCalls(c).length, 1, "CLAIM_FAILED 后应立即结束 tick，不得再取单");
  assert.equal(c.adb().length, 0, "不得发送");
  assert.equal(doneCalls(c).length, 0);
  const barks = barkCalls(c);
  assert.equal(barks.length, 1);
  assert.match(decodeBark(barks[0]).body + decodeBark(barks[0]).title, /认领|占位|CLAIM|触达中/);
  assert.match(c.log(), /CLAIM_FAILED/);
  // 1 小时内同类告警去重
  c.tickRun();
  assert.equal(barkCalls(c).length, 1);
});

// ── e. 分类 / 软熔断 / notify_once ──
test("e1 classify_failure：device_ui 各信号 + 优先级 + 原有分类不变", { skip: SKIP }, () => {
  const c = setup();
  const cases = [
    ["ui hierarchy unavailable", "device_ui"],
    ["uiautomator dump did not produce a fresh complete hierarchy", "device_ui"],
    ["could not return to the Douyin feed", "device_ui"],
    ["blah\nfailure_class=WRONG_FOREGROUND", "device_ui"],
    ["failure_class=NO_ROOT", "device_ui"],
    // 账号不符比界面问题更严重
    ["current sender account does not match the claimed distribution account\nui hierarchy unavailable\nfailure_class=WRONG_FOREGROUND", "account_mismatch"],
    ["Douyin account identity was not visible on the verified Me page\nfailure_class=WRONG_FOREGROUND", "account_mismatch"],
    // TARGET_ABSENT 仍最优先
    ["ui hierarchy unavailable\nfailure_class=TARGET_ABSENT", "terminal"],
    // 输入框没找到可能是账号被限制，保守仍归 other
    ["verified private-message input was not found", "other"],
    ["some other die message", "other"],
    // 原有 transient 不变
    ["Unknown input method com.android.adbkeyboard/.AdbIME cannot be enabled for user #0", "transient"],
    ["warning: foreground gate: douyin not foreground (round 1)\nno card matched\nfailure_class=TARGET_ABSENT", "terminal"],
  ];
  for (const [out, want] of cases) {
    const r = c.fn('classify_failure "$1"', out);
    assert.equal(r.stdout.trim(), want, `输出 ${JSON.stringify(out)} 应归 ${want}，实际 ${r.stdout.trim()} ${r.stderr}`);
  }
});

test("e2 expire_soft_pauses：过期软熔断被清（连同 uifail 计数），未过期/永久熔断保留", { skip: SKIP }, () => {
  const c = setup();
  const now = Math.floor(Date.now() / 1000);
  c.flag("legacy", `soft_until=${now - 10}\n环境性软熔断\n`);
  c.stateFile("dm-uifail-legacy.txt", "3\n");
  c.flag("jinoshengyuan-work", `soft_until=${now + 3600}\n环境性软熔断\n`);
  c.stateFile("dm-uifail-jinoshengyuan-work.txt", "3\n");
  c.flag("other-profile", "永久熔断，需人工删\n");
  const r = c.fn("expire_soft_pauses");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(c.state, "dm-paused-legacy.flag")), "过期软熔断应被删除");
  assert.ok(!existsSync(join(c.state, "dm-uifail-legacy.txt")), "过期后 uifail 计数应重置");
  assert.ok(existsSync(join(c.state, "dm-paused-jinoshengyuan-work.flag")), "未过期软熔断应保留");
  assert.ok(existsSync(join(c.state, "dm-uifail-jinoshengyuan-work.txt")));
  assert.ok(existsSync(join(c.state, "dm-paused-other-profile.flag")), "永久熔断绝不自动清");
  assert.match(c.log(), /legacy/);
});

test("e2b 人工清掉熔断 flag 后，该账号的熔断告警去重 marker 被重置（当天再熔断能再响）；flag 仍在则保留", { skip: SKIP }, () => {
  const c = setup();
  const now = String(Math.floor(Date.now() / 1000));
  c.flag("legacy", "永久熔断\n");
  c.stateFile("notify-pause-legacy.marker", now);              // flag 还在 → 保留
  c.stateFile("notify-pause-jinoshengyuan-work.marker", now);  // flag 已被人工删 → 重置
  c.stateFile("notify-halt-legacy-x.marker", now);             // 其它 key 不动
  const r = c.fn("expire_soft_pauses");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(c.state, "notify-pause-legacy.marker")), "flag 仍在，去重 marker 应保留");
  assert.ok(!existsSync(join(c.state, "notify-pause-jinoshengyuan-work.marker")), "flag 已清，去重 marker 应被重置");
  assert.ok(existsSync(join(c.state, "notify-halt-legacy-x.marker")), "无关 marker 不得被删");
});

test("e3 软熔断的可用性：未过期→paused；过期未清→可用；永久熔断→paused", { skip: SKIP }, () => {
  const c = setup();
  const now = Math.floor(Date.now() / 1000);
  c.flag("legacy", `soft_until=${now + 600}\n`);
  assert.equal(c.fn("profile_unavailable legacy").stdout.trim(), "paused");
  c.flag("legacy", `soft_until=${now - 600}\n`);
  assert.equal(c.fn("profile_unavailable legacy").stdout.trim(), "");
  c.flag("legacy", "");
  assert.equal(c.fn("profile_unavailable legacy").stdout.trim(), "paused");
  c.flag("legacy", "20260928 12:00 自动检测: 账号身份校验失败\n");
  assert.equal(c.fn("profile_unavailable legacy").stdout.trim(), "paused");
});

test("e4 notify_once：ttl 内不重发、过期重发、发送失败不记 marker", { skip: SKIP }, () => {
  const c = setup();
  c.fn('notify_once k1 "标题" "正文" 3600');
  assert.equal(barkCalls(c).length, 1);
  const b = decodeBark(barkCalls(c)[0]);
  assert.equal(b.title, "标题"); assert.equal(b.body, "正文"); assert.equal(b.level, "timeSensitive");
  assert.match(barkCalls(c)[0], /-o BatchMode=yes/);
  assert.match(barkCalls(c)[0], /-o ConnectTimeout=15/);
  assert.match(barkCalls(c)[0], /\.openclaw\/leadgen-scripts\/notify-bark\.js/);
  c.fn('notify_once k1 "标题" "正文" 3600');
  assert.equal(barkCalls(c).length, 1, "ttl 内不重发");
  // 把 marker 拨到 2 小时前 → 过期，重发并刷新
  const marker = join(c.state, "notify-k1.marker");
  assert.ok(existsSync(marker));
  writeFileSync(marker, String(Math.floor(Date.now() / 1000) - 7200));
  c.fn('notify_once k1 "标题" "正文" 3600');
  assert.equal(barkCalls(c).length, 2, "过期后应重发");
  assert.ok(Number(readFileSync(marker, "utf8")) > Math.floor(Date.now() / 1000) - 60, "marker 应被刷新");
  // 发送失败（假 ssh 不回 BARK_OK）不记 marker，下次再试
  writeFileSync(join(c.home, "bark-fail"), "1");
  c.fn('notify_once k2 "t" "b" 3600');
  assert.ok(!existsSync(join(c.state, "notify-k2.marker")), "失败不得记 marker");
  rmFile(join(c.home, "bark-fail"));
  c.fn('notify_once k2 "t" "b" 3600');
  assert.ok(existsSync(join(c.state, "notify-k2.marker")));
  assert.equal(barkCalls(c).length, 4);
});
function rmFile(p) { rmSync(p, { force: true }); }

// ── f. mark 重试与回写失败告警 ──
test("f1 mark：第一次 MARK_FAIL 第二次 MARKED → 只多 1 次调用，无告警", { skip: SKIP }, () => {
  const c = setup();
  c.seq("done", ["MARK_FAIL {\"code\":99}", "MARKED sent"]);
  const r = c.fn('mark recAAA sent "note 中文"');
  assert.equal(r.status, 0, r.stderr);
  const dones = doneCalls(c);
  assert.equal(dones.length, 2);
  assert.match(dones[0], /next-outreach\.js done recAAA sent /);
  assert.equal(barkCalls(c).length, 0);
  // note 仍以 base64 透传
  const b64 = dones[0].split(" ").pop();
  assert.equal(Buffer.from(b64, "base64").toString(), "note 中文");
});

test("f2 mark：两次都失败 → 触发 markfail 告警（同一小时内去重）", { skip: SKIP }, () => {
  const c = setup();
  c.seq("done", ["MARK_FAIL x", "MARK_FAIL y", "MARK_FAIL z", "MARK_FAIL w"]);
  c.fn("mark recBBB sent n1");
  assert.equal(doneCalls(c).length, 2);
  const barks = barkCalls(c);
  assert.equal(barks.length, 1);
  const b = decodeBark(barks[0]);
  assert.match(b.title, /回写失败/); assert.match(b.body, /recBBB/); assert.match(b.body, /40分钟/);
  assert.match(c.log(), /MARK_FAIL/);
  c.fn("mark recCCC sent n2");
  assert.equal(barkCalls(c).length, 1, "markfail 告警 1 小时内去重");
});

test("f3 mark：一次成功 → 只 1 次调用，日志保留 ssh 输出", { skip: SKIP }, () => {
  const c = setup();
  c.seq("done", ["MARKED sent"]);
  c.fn("mark recDDD sent n");
  assert.equal(doneCalls(c).length, 1);
  assert.match(c.log(), /MARKED sent/);
});

// ── device_ui 整 tick：回队列不废线索，3 次软熔断 ──
test("g1 device_ui 单次失败：mark requeue（不是 failed）、uifail 计数 1、不熔断、不重试", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.home, "send.out"), "ui hierarchy unavailable\nfailure_class=WRONG_FOREGROUND\n");
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const dones = doneCalls(c);
  assert.equal(dones.length, 1, dones.join("|"));
  assert.match(dones[0], /done recX1 requeue /);
  assert.ok(!/ failed /.test(dones[0]));
  assert.equal(c.adb().filter((l) => l.includes("private-message-send")).length, 1, "device_ui 不做就地重试");
  assert.equal(readFileSync(join(c.state, "dm-uifail-legacy.txt"), "utf8").trim(), "1");
  assert.ok(!existsSync(join(c.state, "dm-paused-legacy.flag")));
  assert.ok(!existsSync(join(c.state, "dm-anomaly-legacy.txt")), "device_ui 不计入 other 的连续异常");
  assert.equal(barkCalls(c).length, 0);
});

test("g2 device_ui 连续第 3 次：写软熔断 flag(soft_until) + 告警；下一轮取单排除该号", { skip: SKIP }, () => {
  const c = setup();
  c.stateFile("dm-uifail-legacy.txt", "2\n");
  writeFileSync(join(c.home, "send.out"), "could not return to the Douyin feed\nfailure_class=WRONG_FOREGROUND\n");
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const before = Math.floor(Date.now() / 1000);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const flagPath = join(c.state, "dm-paused-legacy.flag");
  assert.ok(existsSync(flagPath), "应写软熔断 flag");
  const lines = readFileSync(flagPath, "utf8").split("\n");
  const m = lines[0].match(/^soft_until=(\d+)$/);
  assert.ok(m, `第一行应为 soft_until=<epoch>，实际 ${lines[0]}`);
  const until = Number(m[1]);
  assert.ok(until >= before + 7000 && until <= before + 7400, `应约 2 小时后，实际差 ${until - before}s`);
  assert.ok(lines.slice(1).join("\n").includes("Douyin feed"), "第二行起应记录最近一次原始输出片段");
  assert.match(doneCalls(c)[0], / requeue /);
  const barks = barkCalls(c);
  assert.equal(barks.length, 1);
  assert.match(decodeBark(barks[0]).title, /软熔断|界面|熔断/);
  const nexts = nextCalls(c);
  assert.equal(nexts.length, 2);
  assert.match(nexts[1], /--exclude legacy(\s|$)/);
});

test("g3 发送成功清零 uifail 与 anomaly 计数", { skip: SKIP }, () => {
  const c = setup();
  c.stateFile("dm-uifail-legacy.txt", "2\n");
  c.stateFile("dm-anomaly-legacy.txt", "1\n");
  // 让发送成功：覆盖假控制器
  const adb = join(c.home, ".local", "bin", "douyin-phone-adb");
  writeFileSync(adb, `#!/bin/sh
echo "$*" >> "$HOME/adb-calls.log"
case "$3" in private-message-send) echo "send_status=sent"; exit 0;; esac
exit 0`);
  chmodSync(adb, 0o755);
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(c.state, "dm-uifail-legacy.txt")));
  assert.ok(!existsSync(join(c.state, "dm-anomaly-legacy.txt")));
  assert.match(doneCalls(c)[0], / sent /);
});

// ── 纵深防御：选单器（被替换/回退）仍返回不可用账号的单，连续 3 次即收工，不空转 ──
test("h 纵深防御：仍拿到熔断账号的单时最多空转 3 次即 break 整个 tick", { skip: SKIP }, () => {
  const c = setup();
  c.flag("legacy", "");
  c.seq("next", Array(10).fill(ORDER_LEGACY));
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(nextCalls(c).length, 3, "连续 3 次进入不可用分支后必须 break");
  assert.equal(doneCalls(c).filter((l) => l.includes(" requeue ")).length, 3);
  assert.equal(c.adb().filter((l) => l.includes("private-message-send")).length, 0);
  assert.match(c.log(), /空转|STALL|连续3次/);
});

// ── 测试开关只在设置时生效：生产脚本里不得默认跳过拟人节奏 ──
test("i OUTREACH_TICK_TESTING 只由环境变量开启（脚本内不得默认设置）", () => {
  const src = readFileSync(join(SRC, "outreach-tick.sh"), "utf8");
  assert.ok(/OUTREACH_TICK_TESTING/.test(src));
  assert.ok(!/^\s*(export\s+)?OUTREACH_TICK_TESTING=/m.test(src), "脚本内不得给 OUTREACH_TICK_TESTING 赋值");
});

// ── j. 熔断自动恢复（决策 e08227ee：熔断后恢复由系统自动判定，不再要人工删 flag） ──
// 冷却 = min(2h × 2^(n-1), 24h)，n = 连续自动熔断次数（dm-pausecount-<p>.txt）；到期由 expire_soft_pauses 自动解除，
// 到期后的第一单即半开试发：anomaly 计数保留在 1，再遇一次 other 立刻再熔断且冷却翻倍；任一发送成功全部清零。
const soft = (c, p) => {
  const lines = readFileSync(join(c.state, `dm-paused-${p}.flag`), "utf8").split("\n");
  const m = lines[0].match(/^soft_until=(\d+)$/);
  assert.ok(m, `熔断 flag 第一行应为 soft_until=<epoch>（自动恢复），实际 ${lines[0]}`);
  return { until: Number(m[1]), rest: lines.slice(1).join("\n") };
};

test("j1 other 连续第 2 次：写软熔断 2 小时（不再永久）+ 计数 1 + 告警写明自动试发、不要求人工删文件", { skip: SKIP }, () => {
  const c = setup();
  c.stateFile("dm-anomaly-legacy.txt", "1\n");
  writeFileSync(join(c.home, "send.out"), "some brand new failure nobody has seen\n");
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const before = Math.floor(Date.now() / 1000);
  const r = c.tickRun();
  assert.equal(r.status, 0, r.stderr);
  const { until, rest } = soft(c, "legacy");
  assert.ok(until >= before + 7000 && until <= before + 7400, `首次自动熔断应约 2 小时，实际差 ${until - before}s`);
  assert.match(rest, /brand new failure/, "flag 应记录最近一次原始输出片段");
  assert.equal(readFileSync(join(c.state, "dm-pausecount-legacy.txt"), "utf8").trim(), "1");
  assert.equal(readFileSync(join(c.state, "dm-anomaly-legacy.txt"), "utf8").trim(), "1", "熔断后 anomaly 留 1：到期后的第一单即半开试发");
  const barks = barkCalls(c);
  assert.equal(barks.length, 1);
  const b = decodeBark(barks[0]);
  assert.match(b.body, /自动/);
  assert.ok(!/删除/.test(b.body), `告警不得再要求人工删除 flag：${b.body}`);
});

test("j2 半开试发再失败：冷却翻倍（第 3 次自动熔断 = 8 小时）", { skip: SKIP }, () => {
  const c = setup();
  c.stateFile("dm-anomaly-legacy.txt", "1\n");
  c.stateFile("dm-pausecount-legacy.txt", "2\n");
  writeFileSync(join(c.home, "send.out"), "still broken in a new way\n");
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const before = Math.floor(Date.now() / 1000);
  assert.equal(c.tickRun().status, 0);
  const { until } = soft(c, "legacy");
  const want = 8 * 3600;
  assert.ok(until >= before + want - 200 && until <= before + want + 200, `应约 8 小时，实际差 ${until - before}s`);
  assert.equal(readFileSync(join(c.state, "dm-pausecount-legacy.txt"), "utf8").trim(), "3");
});

test("j3 冷却封顶 24 小时", { skip: SKIP }, () => {
  const c = setup();
  c.stateFile("dm-anomaly-legacy.txt", "1\n");
  c.stateFile("dm-pausecount-legacy.txt", "9\n");
  writeFileSync(join(c.home, "send.out"), "yet another unknown\n");
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const before = Math.floor(Date.now() / 1000);
  assert.equal(c.tickRun().status, 0);
  const { until } = soft(c, "legacy");
  assert.ok(until <= before + 24 * 3600 + 200 && until >= before + 24 * 3600 - 200, `应封顶 24 小时，实际差 ${until - before}s`);
});

test("j4 账号身份不符：软熔断 2 小时自动复查（发送前核验，不会用错身份发出），原因写进 flag", { skip: SKIP }, () => {
  const c = setup();
  writeFileSync(join(c.home, "send.out"), "sender account does not match the claimed distribution account\n");
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  const before = Math.floor(Date.now() / 1000);
  assert.equal(c.tickRun().status, 0);
  const { until, rest } = soft(c, "legacy");
  assert.ok(until >= before + 7000 && until <= before + 7400, `应约 2 小时，实际差 ${until - before}s`);
  assert.match(rest, /账号身份校验失败/);
  const b = decodeBark(barkCalls(c)[0]);
  assert.ok(!/删除/.test(b.body), `告警不得再要求人工删除 flag：${b.body}`);
});

test("j5 到期自动解除保留半开状态：expire 后 flag 消失、pausecount 与 anomaly 保留", { skip: SKIP }, () => {
  const c = setup();
  const now = Math.floor(Date.now() / 1000);
  c.flag("legacy", `soft_until=${now - 5}\n自动熔断\n`);
  c.stateFile("dm-pausecount-legacy.txt", "2\n");
  c.stateFile("dm-anomaly-legacy.txt", "1\n");
  const r = c.fn("expire_soft_pauses");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(c.state, "dm-paused-legacy.flag")));
  assert.equal(readFileSync(join(c.state, "dm-pausecount-legacy.txt"), "utf8").trim(), "2");
  assert.equal(readFileSync(join(c.state, "dm-anomaly-legacy.txt"), "utf8").trim(), "1");
});

test("j6 发送成功清零自动熔断计数", { skip: SKIP }, () => {
  const c = setup();
  c.stateFile("dm-pausecount-legacy.txt", "3\n");
  c.stateFile("dm-anomaly-legacy.txt", "1\n");
  const adb = join(c.home, ".local", "bin", "douyin-phone-adb");
  writeFileSync(adb, `#!/bin/sh
echo "$*" >> "$HOME/adb-calls.log"
case "$3" in private-message-send) echo "send_status=sent"; exit 0;; esac
exit 0`);
  chmodSync(adb, 0o755);
  c.seq("next", [ORDER_LEGACY, "NO_PENDING"]);
  assert.equal(c.tickRun().status, 0);
  assert.ok(!existsSync(join(c.state, "dm-pausecount-legacy.txt")));
  assert.ok(!existsSync(join(c.state, "dm-anomaly-legacy.txt")));
});
