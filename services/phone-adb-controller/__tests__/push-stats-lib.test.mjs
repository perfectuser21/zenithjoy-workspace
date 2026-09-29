// push-stats-lib.test.mjs —— push-videos.js/push-raw-comments.js"全军覆没才判失败"回归测试
// （0929 DoD 审计发现：单条推送失败之前只 console.log 记日志继续，哪怕全部失败也照样 exit 0）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushAllFailed } from "../push-stats-lib.js";

test("pushAllFailed: 有新数据要推,但一条都没成功 → 判失败", () => {
  assert.equal(pushAllFailed(0, 0, 20), true);
  assert.equal(pushAllFailed(0, 5, 20), true); // 20条里5条重复,15条尝试推送,全败
});

test("pushAllFailed: 部分成功(哪怕只成功1条) → 不判失败(避免batch2.sh链式调用误伤后续步骤)", () => {
  assert.equal(pushAllFailed(1, 0, 20), false);
  assert.equal(pushAllFailed(18, 0, 20), false);
});

test("pushAllFailed: 全部都是重复(没有新数据要推) → 不判失败(不是失败,是正常增量为0)", () => {
  assert.equal(pushAllFailed(0, 20, 20), false);
});

test("pushAllFailed: 空输入 → 不判失败", () => {
  assert.equal(pushAllFailed(0, 0, 0), false);
});

test("pushAllFailed: 全部成功 → 不判失败", () => {
  assert.equal(pushAllFailed(20, 0, 20), false);
});
