// douyin-phone-adb media-push / text-input 受控命令单元测试（1010 新建，Brain 任务 8fdeaeb4）。
//
// 背景：技能工厂首个样板「试跑 抖音·视频发布」(d4b74ac5) blocked——工位规定手机操作必须经控制器，
// 禁止裸 adb；控制器却没有素材下发/媒体扫描命令，中文输入只埋在 private-message-send 内部。
// 契约：
//   media-push  持锁才执行；推到 /sdcard/DCIM/Camera/ 相机风格文件名；回读大小一致 + 媒体库可查到才算成功；
//               输出一行可解析结果；失败带 failure_class=(empty_ok|retryable|fatal|needs_human)。
//   text-input  持锁才执行；切 ADBKeyboard 输入，焦点框回读与输入逐字一致才算成功；
//               无论成败输入法都还原为原输入法并回读确认。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const ORIG_IME = "com.baidu.input_huawei/.ImeService";
const RUN = "skill-factory-douyin-publish-1010";

test("前置：zsh 与 /usr/bin/xmllint 可用", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined, "没有 zsh，请在 CI 里装上");
  assert.equal(spawnSync("/usr/bin/xmllint", ["--version"]).error, undefined, "没有 /usr/bin/xmllint");
});

// 假 adb（node）：状态全放在 STATE_DIR，便于断言。
//   sdcard/      模拟手机存储（push 落这里，stat 读这里）
//   ime          当前默认输入法
//   typed        焦点输入框当前文字
//   calls.log    全部调用参数
// 行为开关（环境变量）：FAKE_SIZE_DELTA 回读大小偏移；FAKE_NOT_INDEXED=1 媒体库查不到；
// FAKE_TYPED_OVERRIDE 输入后框里实际文字；FAKE_IME_MISSING=1 未装 ADBKeyboard；
// FAKE_NO_FOCUS=1 没有焦点输入框；FAKE_RESTORE_STUCK=1 还原输入法无效。
const FAKE_ADB = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const S = process.env.STATE_DIR;
const argv = process.argv.slice(2);
fs.appendFileSync(path.join(S, "calls.log"), JSON.stringify(argv) + "\\n");
let a = argv;
if (a[0] === "-s") a = a.slice(2);
const sd = (p) => path.join(S, "sdcard", p);
const read = (f, d = "") => { try { return fs.readFileSync(path.join(S, f), "utf8"); } catch { return d; } };
const write = (f, v) => fs.writeFileSync(path.join(S, f), v);
const out = (s) => process.stdout.write(s);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\\n/g, "&#10;");
if (a[0] === "get-state") { out("device\\n"); process.exit(0); }
if (a[0] === "push") {
  const dst = sd(a[2]); fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(a[1], dst); out("1 file pushed\\n"); process.exit(0);
}
if (a[0] === "pull") {
  if (process.env.FAKE_XHS_NATIVE_INPUT === "1") {
    const title = read("typed", "") || "输入标题";
    const pkg = "com.xingin.xhs";
    fs.writeFileSync(a[2], '<hierarchy><node class="android.widget.EditText" package="'+pkg+'" resource-id="com.xingin.xhs:id/0_resource_name_obfuscated" text="正文占位" focused="false" bounds="[79,265][1121,2354]"/><node class="android.widget.EditText" package="'+pkg+'" resource-id="com.xingin.xhs:id/0_resource_name_obfuscated" text="'+esc(title)+'" focused="false" bounds="[79,265][1121,385]"/></hierarchy>');
    process.exit(0);
  }
  const typed = read("typed");
  const focus = process.env.FAKE_NO_FOCUS === "1" ? "false" : "true";
  const xml = "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\\"0\\">" +
    "<node index=\\"0\\" text=\\"\\" resource-id=\\"\\" class=\\"android.widget.FrameLayout\\" package=\\"com.ss.android.ugc.aweme\\" content-desc=\\"\\" focused=\\"false\\" bounds=\\"[0,0][1200,2664]\\">" +
    "<node index=\\"1\\" text=\\"" + esc(typed) + "\\" resource-id=\\"com.ss.android.ugc.aweme:id/caption_et\\" class=\\"android.widget.EditText\\" package=\\"com.ss.android.ugc.aweme\\" content-desc=\\"\\" focused=\\"" + focus + "\\" bounds=\\"[40,300][1160,600]\\" />" +
    "</node></hierarchy>";
  fs.writeFileSync(a[2], xml); process.exit(0);
}
if (a[0] !== "shell") process.exit(0);
const sh = a.slice(1);
const cmd = sh.join(" ");
if (sh[0] === "readlink" && process.env.FAKE_CANONICAL_MEDIA === "1") {
  out(sh[sh.length - 1].replace("/sdcard/", "/storage/emulated/0/") + "\\n"); process.exit(0);
}
if (cmd.startsWith("getprop ro.product.model")) { out("ANY-MODEL\\n"); process.exit(0); }
if (sh[0] === "stat") {
  const p = sh[sh.length - 1];
  if (p.endsWith(".xml")) { out("4096\\n"); process.exit(0); }
  if (!fs.existsSync(sd(p))) { process.stderr.write("stat: No such file\\n"); process.exit(1); }
  out(String(fs.statSync(sd(p)).size + Number(process.env.FAKE_SIZE_DELTA || 0)) + "\\n"); process.exit(0);
}
if (sh[0] === "rm") { const p = sh[sh.length - 1]; if (!p.endsWith(".xml")) fs.rmSync(sd(p), { force: true }); process.exit(0); }
if (sh[0] === "uiautomator") { out("UI hierchary dumped to: /sdcard/x.xml\\n"); process.exit(0); }
if (cmd.includes("MEDIA_SCANNER_SCAN_FILE")) { write("scanned", cmd); out("Broadcast completed: result=0\\n"); process.exit(0); }
if (sh[0] === "content" && sh[1] === "query") {
  const m = cmd.match(/_data='([^']+)'/);
  const p = m && m[1];
  if (process.env.FAKE_CANONICAL_MEDIA === "1") {
    if (!p || !p.startsWith("/storage/emulated/0/")) { out("No result found.\\n"); process.exit(0); }
    const disk = sd(p.replace("/storage/emulated/0/", "/sdcard/"));
    if (!fs.existsSync(disk) || !read("scanned")) { out("No result found.\\n"); process.exit(0); }
    out("Row: 0 _id=4242, _size=" + fs.statSync(disk).size + "\\n"); process.exit(0);
  }
  if (process.env.FAKE_NOT_INDEXED === "1" || !p || !fs.existsSync(sd(p)) || !read("scanned")) { out("No result found.\\n"); process.exit(0); }
  out("Row: 0 _id=4242, _size=" + fs.statSync(sd(p)).size + "\\n"); process.exit(0);
}
if (cmd.startsWith("settings get secure default_input_method")) { out(read("ime") + "\\n"); process.exit(0); }
if (sh[0] === "ime" && sh[1] === "enable") {
  if (process.env.FAKE_IME_MISSING === "1") { out("Unknown input method com.android.adbkeyboard/.AdbIME cannot be enabled for user #0\\n"); process.exit(0); }
  out("Input method com.android.adbkeyboard/.AdbIME: now enabled\\n"); process.exit(0);
}
if (sh[0] === "ime" && sh[1] === "set") {
  const target = sh[2];
  if (process.env.FAKE_RESTORE_STUCK === "1" && !target.includes("adbkeyboard")) process.exit(0);
  write("ime", target); out("Input method " + target + " selected for user #0\\n"); process.exit(0);
}
if (sh[0] === "pm" && sh[1] === "list") {
  out(process.env.FAKE_IME_MISSING === "1" ? "package:com.ss.android.ugc.aweme\\n" : "package:com.android.adbkeyboard\\n"); process.exit(0);
}
if (cmd.includes("ADB_CLEAR_TEXT")) { if (read("ime").includes("adbkeyboard")) write("typed", ""); process.exit(0); }
if (cmd.includes("ADB_INPUT_B64")) {
  const i = sh.indexOf("msg");
  const msg = Buffer.from(sh[i + 1], "base64").toString("utf8");
  if (read("ime").includes("adbkeyboard")) write("typed", process.env.FAKE_TYPED_OVERRIDE ?? msg);
  process.exit(0);
}
if (cmd.includes("dumpsys input_method")) {
  const pkg = process.env.FAKE_IME_EDITOR_CHANGED_ON_SWITCH === "1" && read("ime").includes("adbkeyboard") ? "com.other.app" : (process.env.FAKE_IME_EDITOR_PACKAGE || "com.xingin.xhs");
  out("  mServedView=com.xingin.capa.post.ui.UnderLineRichEdit{abc VFED..CL. 79,0-1121,120 #7f090fa2 app:id/0_resource_name_obfuscated aid=1073741825}\\n  mServedConnecting=false\\n  mCurrentEditorInfo:\\n    inputType=0x20001 imeOptions=0x48000005 privateImeOptions=null\\n    hintText=输入标题 label=null\\n    packageName="+pkg+" autofillId=1073741825 fieldId=2131300258 fieldName=null\\n  mServedInputConnection=RemoteInputConnectionImpl{connection=com.xingin.redview.richtext.RichEditTextPro$h@abc mDeactivateRequested=false mServedView=com.xingin.capa.post.ui.UnderLineRichEdit{abc}}\\n  mServedInputConnectionHandler=null\\n"); process.exit(0);
}
if (cmd.includes("dumpsys window")) { out("mCurrentFocus=Window{abc u0 " + (process.env.FAKE_XHS_NATIVE_INPUT === "1" ? "com.xingin.xhs" : "com.ss.android.ugc.aweme") + "/.MainActivity}\\n"); process.exit(0); }
process.exit(0);
`;

function setup({ lockOwner = RUN, lockAgeSec = 10 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mpti-"));
  const state = join(dir, "state");
  mkdirSync(join(state, "sdcard"), { recursive: true });
  writeFileSync(join(state, "ime"), ORIG_IME);
  writeFileSync(join(state, "typed"), "");
  writeFileSync(join(state, "calls.log"), "");
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, "legacy\tSER1\tANY-MODEL\t1199\t2663\n");
  const adb = join(dir, "fake-adb");
  writeFileSync(adb, FAKE_ADB);
  chmodSync(adb, 0o755);
  const tmpRoot = join(dir, "tmp");
  if (lockOwner) {
    const lock = join(tmpRoot, "locks", "SER1.lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner"), lockOwner + "\n");
    writeFileSync(join(lock, "acquired_at"), String(Math.floor(Date.now() / 1000) - lockAgeSec) + "\n");
  }
  const video = join(dir, "clip.mp4");
  writeFileSync(video, Buffer.alloc(2048, 7));
  return { dir, state, reg, adb, tmpRoot, video };
}

function run(ctx, args, extraEnv = {}, { owner = RUN } = {}) {
  const pre = owner ? ["--lock-owner", owner] : [];
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", "legacy", ...pre, ...args], {
      env: {
        ...process.env, STATE_DIR: ctx.state, DOUYIN_PHONE_REGISTRY: ctx.reg, DOUYIN_ADB_BIN: ctx.adb,
        DOUYIN_PHONE_TMP_ROOT: ctx.tmpRoot, ...extraEnv,
      },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

const calls = (ctx) => readFileSync(join(ctx.state, "calls.log"), "utf8");
const ime = (ctx) => readFileSync(join(ctx.state, "ime"), "utf8");
const parse = (line) => Object.fromEntries(line.split(" ").filter((t) => t.includes("=")).map((t) => [t.slice(0, t.indexOf("=")), t.slice(t.indexOf("=") + 1)]));

// ── media-push ─────────────────────────────────────────────────────────

test("media-push 查询媒体库使用 /sdcard 的真实路径，避免已上传文件被误删", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", ctx.video, "--name", "VID_20261010_170000.mp4"], { FAKE_CANONICAL_MEDIA: "1", DOUYIN_MEDIA_SCAN_POLLS: "1" });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(parse(r.out).path, "/sdcard/DCIM/Camera/VID_20261010_170000.mp4");
  assert.match(calls(ctx), /_data='\/storage\/emulated\/0\/DCIM\/Camera\/VID_20261010_170000.mp4'/);
  assert.ok(existsSync(join(ctx.state, "sdcard", parse(r.out).path)));
});

test("media-push 成功：相机风格默认文件名、大小回读一致、媒体库可查到，输出一行可解析结果", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", ctx.video]);
  assert.equal(r.code, 0, `err=${r.err}`);
  const lines = r.out.split("\n");
  assert.equal(lines.length, 1, `必须只输出一行: ${r.out}`);
  const kv = parse(lines[0]);
  assert.equal(kv.media_push, "ok");
  assert.match(kv.name, /^VID_\d{8}_\d{6}\.mp4$/, "缺省文件名必须是 VID_yyyymmdd_hhmmss.mp4");
  assert.equal(kv.path, `/sdcard/DCIM/Camera/${kv.name}`);
  assert.equal(kv.size, "2048");
  assert.equal(kv.scan, "indexed");
  assert.equal(kv.media_id, "4242");
  assert.ok(existsSync(join(ctx.state, "sdcard", kv.path)), "文件必须真的落到相册目录");
  assert.match(calls(ctx), /MEDIA_SCANNER_SCAN_FILE/, "必须触发媒体扫描");
});

test("media-push --name 显式文件名原样使用", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", ctx.video, "--name", "VID_20261010_153000.mp4"]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(parse(r.out).path, "/sdcard/DCIM/Camera/VID_20261010_153000.mp4");
});

test("media-push --name 非相机风格文件名 → fatal 拒绝，不碰设备", async () => {
  const ctx = setup();
  for (const bad of ["clip.mp4", "VID_2026_1530.mp4", "VID_20261010_153000.mov", "../VID_20261010_153000.mp4", "IMG_20261010_153000.mp4"]) {
    const r = await run(ctx, ["media-push", ctx.video, "--name", bad]);
    assert.notEqual(r.code, 0, `${bad} 不应被接受`);
    assert.match(r.err, /failure_class=fatal/, `${bad}: ${r.err}`);
  }
  assert.doesNotMatch(calls(ctx), /"push"/, "文件名非法时绝不能 push");
});

test("media-push 已存在同名文件 → 拒绝覆盖", async () => {
  const ctx = setup();
  const first = await run(ctx, ["media-push", ctx.video, "--name", "VID_20261010_153002.mp4"]);
  assert.equal(first.code, 0, `err=${first.err}`);
  const r = await run(ctx, ["media-push", ctx.video, "--name", "VID_20261010_153002.mp4"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /reason=remote_name_taken/);
});

test("media-push 未持锁（锁空闲）→ 拒绝，不 push", async () => {
  const ctx = setup({ lockOwner: null });
  const r = await run(ctx, ["media-push", ctx.video]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /lock/i);
  assert.match(r.out, /^media_push=fail class=fatal reason=lock_not_held/);
  assert.doesNotMatch(calls(ctx), /"push"/);
});

test("media-push 锁被别的 run 持有 → 拒绝，不 push", async () => {
  const ctx = setup({ lockOwner: "other-run-123" });
  const r = await run(ctx, ["media-push", ctx.video]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /reason=lock_not_held/);
  assert.doesNotMatch(calls(ctx), /"push"/);
});

test("media-push 锁已过期（超 TTL）→ 拒绝，不 push", async () => {
  const ctx = setup({ lockAgeSec: 4000 });
  const r = await run(ctx, ["media-push", ctx.video]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /reason=lock_stale/);
  assert.doesNotMatch(calls(ctx), /"push"/);
});

test("media-push 未带 --lock-owner → 拒绝，不 push", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", ctx.video], {}, { owner: null });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /reason=lock_owner_required/);
  assert.doesNotMatch(calls(ctx), /"push"/);
});

test("media-push 回读大小不一致 → retryable 失败，并清掉手机上的残缺文件", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", ctx.video, "--name", "VID_20261010_153001.mp4"], { FAKE_SIZE_DELTA: "-100" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^media_push=fail class=retryable reason=size_mismatch/);
  assert.ok(!existsSync(join(ctx.state, "sdcard", "sdcard/DCIM/Camera/VID_20261010_153001.mp4")), "残缺文件必须删除");
});

test("media-push 媒体库查不到 → retryable 失败，不报成功", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", ctx.video], { FAKE_NOT_INDEXED: "1", DOUYIN_MEDIA_SCAN_POLLS: "2" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^media_push=fail class=retryable reason=media_not_indexed/);
});

test("media-push 本地文件不存在 → fatal", async () => {
  const ctx = setup();
  const r = await run(ctx, ["media-push", join(ctx.dir, "nope.mp4")]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /class=fatal reason=local_file_missing/);
});

// ── text-input ─────────────────────────────────────────────────────────

test("text-input 成功：经 ADBKeyboard 输入，焦点框回读一致，输入法还原并回读确认", async () => {
  const ctx = setup();
  const text = "今天发一条测试视频 #AI 学姐 & <好>";
  const r = await run(ctx, ["text-input", text]);
  assert.equal(r.code, 0, `err=${r.err}`);
  const lines = r.out.split("\n");
  assert.equal(lines.length, 1, `必须只输出一行: ${r.out}`);
  const kv = parse(lines[0]);
  assert.equal(kv.text_input, "ok");
  assert.equal(kv.bytes, String(Buffer.byteLength(text)));
  assert.equal(kv.field, "com.ss.android.ugc.aweme:id/caption_et");
  assert.equal(kv.ime_restored, ORIG_IME);
  assert.equal(ime(ctx), ORIG_IME, "输入法必须还原");
  assert.equal(readFileSync(join(ctx.state, "typed"), "utf8"), text);
  assert.match(calls(ctx), /ADB_INPUT_B64/);
});

test("text-input 回读不一致 → 判失败(retryable)，且输入法仍被还原", async () => {
  const ctx = setup();
  const r = await run(ctx, ["text-input", "你好世界"], { FAKE_TYPED_OVERRIDE: "你好" });
  assert.notEqual(r.code, 0, "回读不一致绝不能判成功");
  assert.match(r.out, /^text_input=fail class=retryable reason=readback_mismatch/);
  assert.equal(ime(ctx), ORIG_IME, "失败时输入法也必须还原");
});

test("text-input 未安装 ADBKeyboard → 明确 die(needs_human)，输入法不变", async () => {
  const ctx = setup();
  const r = await run(ctx, ["text-input", "你好"], { FAKE_IME_MISSING: "1" });
  assert.notEqual(r.code, 0);
  assert.match(r.err, /AdbIME 未安装/);
  assert.match(r.out, /class=needs_human reason=adbkeyboard_not_installed/);
  assert.equal(ime(ctx), ORIG_IME);
});

test("text-input 输入法还原不生效 → needs_human，不报成功", async () => {
  const ctx = setup();
  const r = await run(ctx, ["text-input", "你好"], { FAKE_RESTORE_STUCK: "1" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /class=needs_human reason=ime_restore_failed/);
});

test("text-input 未持锁 → 拒绝，不切输入法", async () => {
  const ctx = setup({ lockOwner: "other-run-123" });
  const r = await run(ctx, ["text-input", "你好"]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^text_input=fail class=fatal reason=lock_not_held/);
  assert.doesNotMatch(calls(ctx), /"ime"/);
});

test("text-input 没有焦点输入框 → retryable，不切输入法", async () => {
  const ctx = setup();
  const r = await run(ctx, ["text-input", "你好"], { FAKE_NO_FOCUS: "1" });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /class=retryable reason=no_focused_input/);
  assert.doesNotMatch(calls(ctx), /"ime","set"/);
});

test("text-input 空文本 → empty_ok，退出码 0，不碰输入法", async () => {
  const ctx = setup();
  const r = await run(ctx, ["text-input", ""]);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(r.out, "text_input=empty_ok bytes=0");
  assert.doesNotMatch(calls(ctx), /"ime"/);
});

// 真机判例：小红书长文 UnderLineRichEdit 实际输入已连通，UI focused 仍为 false。
// 移除有效 IME 连接匹配或精确回读，应使成功例失败；放宽包名检查应使拒绝例失败。
test("text-input 小红书原生长文标题在有效IME连接下精确回读，尽管UI焦点为false", async () => {
  const ctx=setup();
  const r=await run(ctx,["text-input","傍晚的颜色"],{FAKE_XHS_NATIVE_INPUT:"1"});
  assert.equal(r.code,0, r.err);
  assert.equal(readFileSync(join(ctx.state,"typed"),"utf8"),"傍晚的颜色");
  assert.equal(ime(ctx),ORIG_IME);
});
test("text-input 小红书无障碍缺焦点且IME连接属于其它App时拒绝，不能清空或输入", async () => {
  const ctx=setup();
  const r=await run(ctx,["text-input","傍晚的颜色"],{FAKE_XHS_NATIVE_INPUT:"1",FAKE_IME_EDITOR_PACKAGE:"com.other.app"});
  assert.equal(r.code,2);
  assert.doesNotMatch(calls(ctx), /ADB_CLEAR_TEXT|ADB_INPUT_B64/);
});

test("text-input 小红书原生标题读回错误必须失败并还原输入法", async () => {
  const ctx=setup();
  const r=await run(ctx,["text-input","傍晚的颜色"],{FAKE_XHS_NATIVE_INPUT:"1",FAKE_TYPED_OVERRIDE:"错误文本"});
  assert.equal(r.code,2);
  assert.match(r.err,/readback_mismatch|readback did not exactly match/);
  assert.equal(ime(ctx),ORIG_IME);
});

test("text-input 切换输入法后原生连接换到其它App时停止，不能发送并还原输入法", async () => {
  const ctx=setup();
  const r=await run(ctx,["text-input","傍晚的颜色"],{FAKE_XHS_NATIVE_INPUT:"1",FAKE_IME_EDITOR_CHANGED_ON_SWITCH:"1"});
  assert.equal(r.code,2);
  assert.doesNotMatch(calls(ctx),/ADB_CLEAR_TEXT|ADB_INPUT_B64/);
  assert.equal(ime(ctx),ORIG_IME);
});

test("text-input 原生连接变化且输入法无法恢复时必须needs_human，不能报可重试", async () => {
  const ctx=setup();
  const r=await run(ctx,["text-input","傍晚的颜色"],{FAKE_XHS_NATIVE_INPUT:"1",FAKE_IME_EDITOR_CHANGED_ON_SWITCH:"1",FAKE_RESTORE_STUCK:"1"});
  assert.equal(r.code,2);
  assert.doesNotMatch(calls(ctx),/ADB_CLEAR_TEXT|ADB_INPUT_B64/);
  assert.match(r.err,/failure_class=needs_human/);
});
