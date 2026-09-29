// douyin-phone-adb account-current 昵称误读回归测试（0929 新建）。
//
// 事故（0929 17:20，小蓝 profile jinoshengyuan-work）：account-current 读出 nickname=11，
// 实际主页昵称「躺赢AI学姐」（18:06 重读正确）。
// 现场证据（xian-m4 acct-audit-0929-jinoshengyuan-work-profile.xml）查明的根因：
//   ① 昵称主路 resource-id=tqn 已随抖音版本混淆名轮换失效（真机现为 ttw / tj1 / tp6…），
//      主路永远取空，全靠兜底；
//   ② 兜底取「抖音号：」节点的**紧邻前一个** TextView 兄弟——有未读消息时，昵称和抖音号
//      之间多出一个未读角标 TextView（text="11"，content-desc="切换账号，用户名有11条未读消息"），
//      兜底正好取到它。18:06 消息已读、角标消失，于是又读对了。
// 契约：昵称只认「与抖音号节点左对齐、紧挨在其上方」的 TextView；拒绝纯数字/计数类文本；
//      取不到或疑似误读就有界重抓；仍不确定输出 nickname=unknown，不输出错值；douyin_id 照旧。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SCRIPT = new URL("../douyin-phone-adb", import.meta.url).pathname;
const PROFILE = "legacy";
const HAS_XMLLINT = existsXmllint();

function existsXmllint() {
  return spawnSync("/usr/bin/xmllint", ["--version"]).error === undefined;
}

test("前置：zsh 与 /usr/bin/xmllint 可用", () => {
  assert.equal(spawnSync("zsh", ["-c", "exit 0"]).error, undefined, "没有 zsh，请在 CI 里装上");
  assert.ok(HAS_XMLLINT, "没有 /usr/bin/xmllint（ubuntu 装 libxml2-utils），抖音号提取依赖它");
});

// 按真机结构合成的主页树（布局坐标取自 0929 真机，不含任何真实用户资料）。
function profileXml({ nickname, badge, nickX = 445 }) {
  const nodes = [
    `<node index="0" text="" resource-id="com.ss.android.ugc.aweme:id/urb" class="android.widget.FrameLayout" content-desc="" bounds="[0,0][1200,704]" />`,
  ];
  if (nickname !== undefined) {
    nodes.push(`<node index="1" text="${nickname}" resource-id="com.ss.android.ugc.aweme:id/ttw" class="android.widget.TextView" content-desc="${nickname}" bounds="[${nickX},351][806,448]" />`);
  }
  if (badge !== undefined) {
    nodes.push(`<node index="2" text="${badge}" resource-id="com.ss.android.ugc.aweme:id/s6e" class="android.widget.TextView" content-desc="切换账号，用户名有${badge}条未读消息" bounds="[823,368][893,434]" />`);
  }
  nodes.push(
    `<node index="3" text="抖音号：test_dy_001" resource-id="com.ss.android.ugc.aweme:id/5-n" class="android.widget.TextView" content-desc="" bounds="[445,456][819,508]" />`,
    `<node index="4" text="7" resource-id="" class="android.widget.TextView" content-desc="" bounds="[82,756][112,816]" />`,
    `<node index="5" text="获赞" resource-id="" class="android.widget.TextView" content-desc="" bounds="[52,816][142,878]" />`,
  );
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.ss.android.ugc.aweme" content-desc="" bounds="[0,0][1200,2664]">${nodes.join("")}</node></hierarchy>`;
}

// 假 adb：每次 uiautomator dump 按序取下一份夹具（用完重复最后一份），并计数。
const FAKE_ADB = `#!/bin/sh
args="$*"
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
  const dir = mkdtempSync(join(tmpdir(), "acctnick-"));
  const reg = join(dir, "r.tsv");
  writeFileSync(reg, `${PROFILE}\tSER1\tANY-MODEL\t1199\t2663\n`);
  const adb = join(dir, "fake-adb");
  writeFileSync(adb, FAKE_ADB);
  chmodSync(adb, 0o755);
  fixtures.forEach((xml, i) => writeFileSync(join(dir, `${i + 1}.xml`), xml));
  writeFileSync(join(dir, "last.xml"), fixtures[fixtures.length - 1]);
  return { dir, reg, adb, count: join(dir, "dump-count") };
}

function run(ctx) {
  return new Promise((resolve) => {
    const p = spawn("zsh", [SCRIPT, "--profile", PROFILE, "account-current", "acct-t"], {
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
const dumps = (ctx) => Number(readFileSync(ctx.count, "utf8").trim());

test("0929 原样：昵称与抖音号之间夹着未读角标 11 → 仍读出真实昵称", { skip: !HAS_XMLLINT }, async () => {
  const ctx = setup([profileXml({ nickname: "躺赢AI学姐", badge: "11" })]);
  const r = await run(ctx);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "nickname"), "躺赢AI学姐");
  assert.equal(field(r.out, "douyin_id"), "test_dy_001");
});

test("无角标的正常主页：一次读对，不重抓", { skip: !HAS_XMLLINT }, async () => {
  const ctx = setup([profileXml({ nickname: "躺赢AI学姐" })]);
  const r = await run(ctx);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "nickname"), "躺赢AI学姐");
  assert.equal(dumps(ctx), 1, "读对了就不该重抓");
});

test("昵称位只拿到计数类文本（未渲染完）→ 有界重抓，第二屏读对", { skip: !HAS_XMLLINT }, async () => {
  const ctx = setup([
    profileXml({ nickname: "11" }),
    profileXml({ nickname: "躺赢AI学姐", badge: "11" }),
  ]);
  const r = await run(ctx);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "nickname"), "躺赢AI学姐");
  assert.equal(field(r.out, "douyin_id"), "test_dy_001");
  assert.ok(dumps(ctx) >= 2, "应当重抓过");
  assert.match(field(r.out, "evidence"), /acct-t-profile\.xml$/, "evidence 仍指向 -profile.xml（account-switch 按此名取树）");
  assert.match(readFileSync(field(r.out, "evidence"), "utf8"), /躺赢AI学姐/, "evidence 必须是被采信的那一屏");
});

test("始终只有计数类文本/没有昵称节点 → nickname=unknown（不输出错值），douyin_id 照旧，重抓有上限", { skip: !HAS_XMLLINT }, async () => {
  for (const fx of [profileXml({ badge: "11" }), profileXml({ nickname: "1.2万" }), profileXml({ nickname: "99+" })]) {
    const ctx = setup([fx]);
    const r = await run(ctx);
    assert.equal(r.code, 0, `err=${r.err}`);
    assert.equal(field(r.out, "nickname"), "unknown");
    assert.equal(field(r.out, "douyin_id"), "test_dy_001");
    assert.ok(dumps(ctx) <= 4, `重抓必须有界，实际 dump ${dumps(ctx)} 次`);
  }
});

test("不与抖音号左对齐的文本不当昵称（角标/右侧按钮）", { skip: !HAS_XMLLINT }, async () => {
  const ctx = setup([profileXml({ nickname: "右侧某文字", nickX: 700 })]);
  const r = await run(ctx);
  assert.equal(r.code, 0, `err=${r.err}`);
  assert.equal(field(r.out, "nickname"), "unknown");
});
