// douyin-phone-adb 截图回传 JPEG 副本回归测试（0929 新建）。
//
// 事故形状（0929 实证）：截图命令只产出原图 PNG（荣耀 1200x2664 约 3MB），agent 用
// OpenClaw file_fetch 回传时 base64 后约 4MB，和指令走同一条节点 ws 通道；西安上行
// 实测约 315KB/s → 30s 超时 → 后续指令排队 15s 超时 → 网关判 node disconnected。
// 实测 sips 转 JPEG（宽 720、质量 70）后约 180KB，清晰可读。
//
// 契约：凡产出截图的命令，在原图旁生成同名 .jpg（原图保留），并在输出里打印 jpg 路径；
// 转换失败不影响原命令成功，但不打印 jpg 行（且清掉旧 jpg，防回传上一张图）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const PROFILE = "legacy";

test("前置：zsh 可用", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined,
    "没有 zsh —— 本文件所有守卫都会静默失效，请在 CI 里装上");
});

// 假 adb：pull / exec-out screencap 产出假 PNG；前台恒为抖音。
const FAKE_ADB = `#!/bin/sh
args="$*"
case "$args" in
  *"get-state"*) echo device; exit 0;;
  *"getprop ro.product.model"*) echo ANY-MODEL; exit 0;;
  *"dumpsys window"*) printf 'mCurrentFocus=Window{abc u0 com.ss.android.ugc.aweme/.MainActivity}\\n'; exit 0;;
  *"exec-out screencap"*) printf 'PNGDATA'; exit 0;;
  *" pull "*)
    for last; do :; done
    printf 'PNGDATA' > "$last"; echo "1 file pulled"; exit 0;;
esac
exit 0`;

// 假 sips：记录参数，按 --out 写出 JPEG；SIPS_FAIL=1 时模拟转换失败。
const FAKE_SIPS = `#!/bin/sh
echo "$*" >> "$SIPS_LOG"
[ "$SIPS_FAIL" = "1" ] && exit 1
out=""
prev=""
for a in "$@"; do
  [ "$prev" = "--out" ] && out="$a"
  prev="$a"
done
[ -n "$out" ] && printf 'JPEGDATA' > "$out"
exit 0`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "shotjpg-"));
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, `${PROFILE}\tSER1\tANY-MODEL\t1199\t2663\n`);
  const adb = join(dir, "fake-adb");
  writeFileSync(adb, FAKE_ADB);
  chmodSync(adb, 0o755);
  const sips = join(dir, "fake-sips");
  writeFileSync(sips, FAKE_SIPS);
  chmodSync(sips, 0o755);
  const root = join(dir, "phone-tmp");
  return { dir, reg, adb, sips, root, sipsLog: join(dir, "sips.log") };
}

function run(ctx, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", PROFILE, ...args], {
      env: {
        ...process.env,
        DOUYIN_PHONE_REGISTRY: ctx.reg,
        DOUYIN_ADB_BIN: ctx.adb,
        DOUYIN_SIPS_BIN: ctx.sips,
        DOUYIN_PHONE_TMP_ROOT: ctx.root,
        SIPS_LOG: ctx.sipsLog,
        ...extraEnv,
      },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

function assertSidecar(ctx, r, pngPath) {
  assert.equal(r.code, 0, `err=${r.err}`);
  const jpgPath = pngPath.replace(/\.png$/, ".jpg");
  const lines = r.out.split("\n");
  assert.ok(lines.includes(pngPath), `输出里应有原图路径 ${pngPath}，实得:\n${r.out}`);
  assert.ok(lines.includes(`jpg=${jpgPath}`), `输出里应有 jpg=${jpgPath}，实得:\n${r.out}`);
  assert.ok(existsSync(pngPath), "原图 PNG 必须保留");
  assert.equal(readFileSync(jpgPath, "utf8"), "JPEGDATA", "同名 .jpg 必须生成在原图旁");
  const log = readFileSync(ctx.sipsLog, "utf8");
  assert.match(log, /-s format jpeg/);
  assert.match(log, /-s formatOptions 70/);
  assert.match(log, /--resampleWidth 720/);
}

test("snapshot-evidence：原图旁生成同名 .jpg 并打印 jpg= 行", async () => {
  const ctx = setup();
  const r = await run(ctx, ["snapshot-evidence", "ev-1"]);
  assertSidecar(ctx, r, join(ctx.root, "evidence", PROFILE, "ev-1.png"));
  assert.equal(r.out.split("\n")[0], join(ctx.root, "evidence", PROFILE, "ev-1.png"),
    "第一行仍是原图路径（旧调用方按第一行取路径，不能破坏）");
});

test("tap-evidence / swipe-evidence / back-evidence 同样生成 jpg", async () => {
  for (const [args, id] of [
    [["tap-evidence", "10", "10", "ev-tap", "0"], "ev-tap"],
    [["swipe-evidence", "10", "10", "20", "20", "100", "ev-swipe", "0"], "ev-swipe"],
    [["back-evidence", "ev-back", "0"], "ev-back"],
  ]) {
    const ctx = setup();
    const r = await run(ctx, args);
    assertSidecar(ctx, r, join(ctx.root, "evidence", PROFILE, `${id}.png`));
  }
});

test("snapshot / tap-snapshot / back-snapshot（固定路径截图）同样生成 jpg", async () => {
  for (const args of [["snapshot"], ["tap-snapshot", "10", "10", "0"], ["back-snapshot", "0"]]) {
    const ctx = setup();
    const r = await run(ctx, args);
    assertSidecar(ctx, r, join(ctx.root, `douyin-leadgen-shot-${PROFILE}.png`));
  }
});

test("pull：拉回原图后同样生成 jpg", async () => {
  const ctx = setup();
  const r = await run(ctx, ["pull"]);
  assertSidecar(ctx, r, join(ctx.root, `douyin-leadgen-shot-${PROFILE}.png`));
});

test("sips 失败：命令仍成功、原图照出，但不打印 jpg= 行且清掉旧 jpg（防回传上一张图）", async () => {
  const ctx = setup();
  const shot = join(ctx.root, `douyin-leadgen-shot-${PROFILE}.png`);
  mkdirSync(ctx.root, { recursive: true });
  writeFileSync(shot.replace(/\.png$/, ".jpg"), "STALE");
  const r = await run(ctx, ["snapshot"], { SIPS_FAIL: "1" });
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.ok(r.out.split("\n").includes(shot));
  assert.doesNotMatch(r.out, /^jpg=/m, "转换失败时不得打印 jpg= 行");
  assert.equal(existsSync(shot.replace(/\.png$/, ".jpg")), false, "旧 jpg 必须清掉");
  assert.match(r.err, /jpeg sidecar/);
});
