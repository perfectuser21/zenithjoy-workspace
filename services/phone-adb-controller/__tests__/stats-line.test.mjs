// stats-line.test.mjs —— 落池/分拣脚本的机器可读统计行（PUSH_VIDEOS_STATS / PUSH_COMMENTS_STATS / SORT_STATS）。
// 人读的原有输出不改，另打一行 `TAG {json}`，batch2.sh 用 parseStats 取最后一行喂账本工件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const { statsLine, parseStats } = require("../stats-line.js");

test("statsLine: 'TAG <紧凑 JSON>'，单行", () => {
  const s = statsLine("PUSH_COMMENTS_STATS", { created: 3, dup: 1, input: 4 });
  assert.equal(s, 'PUSH_COMMENTS_STATS {"created":3,"dup":1,"input":4}');
  assert.ok(!s.includes("\n"));
});

test("parseStats: 往返一致（含中文 key / 嵌套对象）", () => {
  const obj = { pending: 5, grades: { A: 1, B: 2, C: 0, 不相关: 2 } };
  assert.deepEqual(parseStats(statsLine("SORT_STATS", obj), "SORT_STATS"), obj);
});

test("parseStats: 多行里取最后一行，容忍前后噪音行", () => {
  const text = [
    "line-route: jinuo base=x",
    'SORT_STATS {"pending":1}',
    "待分拣 9 条",
    'SORT_STATS {"pending":9,"judged":8}',
    "⚠️ 有 1 条判定通过但没搬进线索表",
    "",
  ].join("\n");
  assert.deepEqual(parseStats(text, "SORT_STATS"), { pending: 9, judged: 8 });
});

test("parseStats: 最后一行 JSON 坏了 → 跳过它，取更早的合法行", () => {
  const text = 'SORT_STATS {"pending":2}\nSORT_STATS {"pending":';
  assert.deepEqual(parseStats(text, "SORT_STATS"), { pending: 2 });
});

test("parseStats: 没有该 tag / 空文本 / 非字符串 → null", () => {
  assert.equal(parseStats("落池 1 | 去重 0 | 输入 1", "PUSH_COMMENTS_STATS"), null);
  assert.equal(parseStats("", "SORT_STATS"), null);
  assert.equal(parseStats(undefined, "SORT_STATS"), null);
  assert.equal(parseStats(null, "SORT_STATS"), null);
});

test("parseStats: tag 必须整词匹配（后接空格），不同 tag 互不串", () => {
  const text = 'PUSH_COMMENTS_STATS {"created":1}\nPUSH_VIDEOS_STATS {"created":9}\nPUSH_VIDEOS_STATSX {"created":7}';
  assert.deepEqual(parseStats(text, "PUSH_VIDEOS_STATS"), { created: 9 });
  assert.deepEqual(parseStats(text, "PUSH_COMMENTS_STATS"), { created: 1 });
});

test("parseStats: JSON 不是对象（数字/数组/null）→ 不算合法统计行", () => {
  assert.equal(parseStats("SORT_STATS 5", "SORT_STATS"), null);
  assert.equal(parseStats("SORT_STATS [1,2]", "SORT_STATS"), null);
  assert.equal(parseStats("SORT_STATS null", "SORT_STATS"), null);
});

test("parseStats: 容忍 CRLF 行尾", () => {
  assert.deepEqual(parseStats('x\r\nSORT_STATS {"pending":3}\r\n', "SORT_STATS"), { pending: 3 });
});

test("部署清单：stats-line.js 必须在 deploy.sh 的 MMV_JS_FILES（三个落池/分拣脚本 require 它，漏发=生产 MODULE_NOT_FOUND）", () => {
  const deploy = readFileSync(join(HERE, "..", "deploy.sh"), "utf8");
  const block = /MMV_JS_FILES=\(([\s\S]*?)\n\)/.exec(deploy);
  assert.ok(block, "deploy.sh 找不到 MMV_JS_FILES 数组");
  assert.ok(block[1].split(/\s+/).includes("stats-line.js"), "MMV_JS_FILES 缺 stats-line.js");
});

test("三个脚本都 require ./stats-line.js 并输出各自的统计 tag", () => {
  for (const [f, tag] of [["push-raw-comments.js", "PUSH_COMMENTS_STATS"], ["push-videos.js", "PUSH_VIDEOS_STATS"], ["sort-comments.js", "SORT_STATS"]]) {
    const src = readFileSync(join(HERE, "..", f), "utf8");
    assert.match(src, /require\("\.\/stats-line\.js"\)/, `${f} 没 require stats-line.js`);
    assert.ok(src.includes(`"${tag}"`), `${f} 没输出 ${tag}`);
  }
});
