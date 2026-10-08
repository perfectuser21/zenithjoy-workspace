#!/usr/bin/env node
// fetch-seen-titles.js [业务线] —— 发现改造(Brain 任务 9a8784b7)「点开之前先去重」用:
// 打印视频库(zenithjoy.leadgen_videos)本业务线已有的视频标题,一行一个。
// harvest-keyword.sh 在执行机上经 ssh 到 mmv 跑(PG 凭据只在 mmv),每批拉一次缓存。
// 库里不存作者,历史只能按标题比;作者只用于本轮去重和跳过自家号。
"use strict";
const { routeOf } = require("./line-routes.js");

async function seenTitles(pool, lineKey) {
  const res = await pool.query(
    "SELECT DISTINCT title FROM zenithjoy.leadgen_videos WHERE line_key = $1 AND COALESCE(title, '') <> ''",
    [lineKey]
  );
  return res.rows.map((r) => String(r.title || "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

async function main() {
  const lineKey = routeOf(process.argv[2] || "").key;
  const pool = require("./leadgen-db-connect.js").getPool();
  try {
    for (const t of await seenTitles(pool, lineKey)) process.stdout.write(`${t}\n`);
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) main().catch((e) => { process.stderr.write(`${(e && e.message) || e}\n`); process.exit(1); });

module.exports = { seenTitles };
