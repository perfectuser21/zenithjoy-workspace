// 控制器失败分类：「暂时没出来」(TARGET_PENDING) 与「真的没有 / 对象不对」(TARGET_ABSENT) 分开。
// Brain 任务 4e06da4c；决策 1b469079（故障处置表：目标暂时没出来=可重试，真的没有=正常结束/终态）。
// 守的是「哪个抛错点归哪一类」：安全闸（身份不符、对方没开私信、解析不出目标、主页私密注销）必须保持终态，
// 否则会对错的人重试；页面没加载出来的点必须是可重试，否则线索被直接废掉。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "douyin-phone-adb"), "utf8");

// 抛错消息里的特征片段 → 期望分类
const EXPECT = [
  // 页面还没出来 → TARGET_PENDING
  ["COPY_STALE: clipboard still holds the previous target", "TARGET_PENDING"],
  ["verified share button was not found after 3 captures", "TARGET_PENDING"],
  ["copied text did not contain a verified Douyin short link", "TARGET_PENDING"],
  ["link route: profile identity was not readable after deeplink", "TARGET_PENDING"],
  ["更多 entry was not found on target profile", "TARGET_PENDING"],
  ["profile deeplink did not land on a verified user profile", "TARGET_PENDING"],
  ["CARD_LINK: post-swipe anchors missing", "TARGET_PENDING"],
  ["CARD_LINK: share panel did not open", "TARGET_PENDING"],
  ["CARD_LINK: scratch search field missing", "TARGET_PENDING"],
  ["CARD_LINK: clipboard had no douyin short link", "TARGET_PENDING"],
  // 深链接没跳过去、停在发送账号自己的主页（M4 outreach.log 0921–1008：17 次终态里 6 次读到的是本机账号）
  ["deeplink stayed on the sender's own profile", "TARGET_PENDING"],
  // 真的没有 / 对象不对 → TARGET_ABSENT（安全闸，保持终态）
  ["link route: web profile id", "TARGET_ABSENT"],
  ["link route: profile id ${observed_target_id} does not match", "TARGET_ABSENT"],
  ["发私信 was not present in the 更多 panel", "TARGET_ABSENT"],
  ["could not resolve sec_uid from", "TARGET_ABSENT"],
  ["benchmark profile unavailable (private/deregistered/banned)", "TARGET_ABSENT"],
  ["profile identity mismatch: page shows", "TARGET_ABSENT"],
];

function classesFor(fragment) {
  const lines = src.split("\n").filter((l) => l.includes(fragment) && /\bdie\b/.test(l));
  return lines.map((l) => (l.match(/\b(TARGET_PENDING|TARGET_ABSENT|NO_ROOT|WRONG_FOREGROUND)\s*$/) || [null, "NONE"])[1]);
}

for (const [fragment, want] of EXPECT) {
  test(`抛错「${fragment}」归 ${want}`, () => {
    const got = classesFor(fragment);
    assert.ok(got.length > 0, `douyin-phone-adb 里找不到抛错「${fragment}」——消息改了就同步改这张表`);
    for (const g of got) assert.equal(g, want, `「${fragment}」应报 ${want}，实际 ${g}`);
  });
}

test("身份不符的两处都先判「是不是停在了自己主页」，再判对象不对", () => {
  for (const marker of ["link route: web profile id", "link route: profile id ${observed_target_id} does not match"]) {
    const idx = src.indexOf(marker);
    assert.ok(idx > 0, `找不到「${marker}」`);
    const before = src.slice(Math.max(0, idx - 900), idx);
    assert.match(before, /deeplink stayed on the sender's own profile/, `「${marker}」之前没有先判停在自己主页`);
  }
});

test("所有 TARGET_ABSENT 抛错点都在上表里（新增的点必须先想清楚是哪一类）", () => {
  const listed = EXPECT.map(([f]) => f);
  const absentLines = src.split("\n").filter((l) => /\bdie\b/.test(l) && /TARGET_ABSENT\s*$/.test(l));
  const unlisted = absentLines.filter((l) => !listed.some((f) => l.includes(f)));
  assert.deepEqual(unlisted, [], "有未登记的 TARGET_ABSENT 抛错点");
});
