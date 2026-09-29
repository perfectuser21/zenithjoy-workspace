// discover-benchmark.sh 接口守卫（对标链接获客 · discovery；与 runner 共同遵守的约定）：
//   discover-benchmark.sh PROFILE SOURCE_ENC MAXV TAG LOC
//   stdout 每行 X\tY\tDUR\tTITLE 最多 MAXV 行；无作品 exit 0 空输出；失败 exit 1；日志只走 stderr。
// 假控制器经 DOUYIN_PHONE_ADB 注入，不碰真机。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../discover-benchmark.sh", import.meta.url).pathname;
const SU = "MS4wLjABAAAAKKpc_6_xIVRYXCDDKC3B3VEdFkXcrCIBHO5J5QyxguHmHzxvisPRYHrivB6PCQdL";
const ENC = encodeURIComponent(`https://www.douyin.com/user/${SU}`);

test("前置：zsh/python3 可用（缺了就报红，绝不静默跳过）", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined, "没有 zsh");
  assert.equal(spawnSync("python3", ["-c", "0"]).error, undefined, "没有 python3");
});

const grid = (rows) => rows.map(([x, y]) => `${x}\\t${y}\\t\\t`).join("\\n");
const SIX = grid([[199, 1919], [600, 1919], [1001, 1919], [199, 2426], [600, 2426], [1001, 2426]]);
const TWELVE = grid([740, 1273, 1807, 2341].flatMap((y) => [[199, y], [600, y], [1001, y]]));

// opts: openRc / works / first(首屏卡片输出) / second(上滑后卡片输出)
function run(opts, maxv = "4") {
  const dir = mkdtempSync(join(tmpdir(), "db-"));
  const log = join(dir, "calls");
  const evid = join(dir, "profile.xml");
  writeFileSync(evid, '<node content-desc="作品 1935,按钮,当前作品按最新发布排序,," selected="true" bounds="[0,1520][383,1651]"/>');
  const fake = join(dir, "ctl");
  writeFileSync(fake, `#!/bin/sh
shift; shift
echo "$*" >> ${log}
case "$1" in
  open-user-profile)
    [ "${opts.openRc ?? 0}" = 0 ] || { echo "profile deeplink did not land" >&2; exit 2; }
    printf 'profile_opened=1\\nsec_uid=${SU}\\ndouyin_id=61739090949\\nnickname=x\\nworks_count=${opts.works ?? 1935}\\nevidence=${evid}\\n';;
  profile-video-cards)
    case "$2" in
      *pcards2) printf '${opts.second ?? TWELVE}\\nevidence=/x\\n';;
      *) printf '${opts.first ?? SIX}\\nevidence=/x\\n';;
    esac;;
esac
exit 0
`);
  chmodSync(fake, 0o755);
  const r = spawnSync("zsh", [SCRIPT, "legacy", ENC, maxv, "T1", "same_city"], {
    encoding: "utf8", env: { ...process.env, DOUYIN_PHONE_ADB: fake },
  });
  let calls = "";
  try { calls = readFileSync(log, "utf8"); } catch {}
  return { code: r.status, out: r.stdout, err: r.stderr, calls };
}

const lines = (out) => out.split("\n").filter(Boolean);

test("首屏够 MAXV → 原样输出前 MAXV 张，不滑动；控制器收到的是解码后的主页链接", () => {
  const r = run({}, "4");
  assert.equal(r.code, 0, r.err);
  const l = lines(r.out);
  assert.equal(l.length, 4);
  for (const x of l) assert.match(x, /^\d+\t\d+\t\t$/, `stdout 混进了非卡片行: ${JSON.stringify(x)}`);
  assert.doesNotMatch(r.calls, /swipe/);
  assert.match(r.calls, new RegExp(`open-user-profile https://www\\.douyin\\.com/user/${SU} T1-bench`));
});

test("首屏不够 MAXV → 上滑一次让作品 tab 吸顶再重读，用滑后坐标", () => {
  const r = run({}, "10");
  assert.equal(r.code, 0, r.err);
  const l = lines(r.out);
  assert.equal(l.length, 10);
  assert.equal(l[0].split("\t")[1], "740", "滑动后还在用首屏旧坐标");
  assert.match(r.calls, /swipe 600 1520 600 350 1500/);
});

test("上滑后重读为空 → exit 1（旧坐标已失效，不能退回首屏坐标）", () => {
  const r = run({ second: "" }, "10");
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
});

test("对标账号作品数 0 → exit 0 空输出（empty_ok）", () => {
  const r = run({ works: 0 });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
  assert.doesNotMatch(r.calls, /profile-video-cards/);
});

test("网格报 empty_results → exit 0 空输出", () => {
  const r = run({ first: "cards=0\\nempty_results=true" });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, "");
});

test("主页打不开 → exit 1，原因进 stderr", () => {
  const r = run({ openRc: 2 });
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
  assert.match(r.err, /打开对标主页失败.*did not land/);
});

test("MAXV 非法 → exit 1", () => {
  assert.equal(run({}, "abc").code, 1);
});
