// line-routes.js —— 业务线 → 飞书 base/table 路由表（写库脚本的 SSOT）
//
// 0916 由来：主理人问「悦升的客资表咋不见了」。查明表一直在——悦升有独立 base
// (H3OrbAH49aLNebs7XvOcpS1enec，17 张表齐全)，但落池脚本把金诺的 base/table 写死在代码里，
// 加上 M1 crontab 的 PUSH 参数是 0，于是悦升每晚照采，数据既不进悦升 base 也不进金诺 base，
// 只躺在 M1 本地 tsv 里（当时已攒 35 条）。打开表当然是空的。
//
// 死规矩：凡写库脚本一律从这里取 base/table，禁止在各自文件里写死。新增业务线只改本文件。
//
// 用法：
//   const { routeOf } = require("./line-routes.js");
//   const r = routeOf(process.argv[3]);   // 传业务线名或 profile 名均可
//   const B = r.base, POOL = r.pool;

const ROUTES = [
  {
    key: "jinuo",
    line: "AI人工智能训练师",          // 关键词表/线索表里的「业务线」字段值
    profiles: ["jinoshengyuan-work", "legacy"],
    account: "jinoshengyuan",          // clawdbot.json channels.feishu.accounts 下的键
    base: "GNuwbzY0da8GP0sv6MGcOTu9ntd",
    lead: "tblTLFj69CflUqSr",          // 线索表
    pool: "tblmrJTyVgzTj89P",          // 原始评论池
    video: "tblKHYTMZceFBwHr",         // 视频池
    keyword: "tbleP4LgzkcwAhiZ",       // 关键词配置
    script: "tblZZWdv0YUNojqI",        // 话术库
  },
  {
    key: "yuesheng",
    line: "悦升云端",
    profiles: ["yueshengyun-work"],
    account: "main",                   // 0916 实测：main 账号对该 base 有读写权
    base: "H3OrbAH49aLNebs7XvOcpS1enec",
    lead: "tblmz52E2GDX0uwu",          // 悦升云端-抖音线索（0916 已补齐 7 个新列与金诺对齐）
    pool: "tblQzIHcmGSPUAZm",          // 悦升云端-原始评论池
    video: null,                       // 悦升 base 暂无视频池，写视频时跳过
    keyword: "tblyKCp5vc7y2S40",       // 悦升云端-关键词配置
    script: "tblvf3t8ZWkOCpe1",        // 悦升云端-话术库
  },
  {
    key: "dev",
    line: "研发",
    // 研发活不绑机器——任何一台手机闲下来都能跑它（0922 主理人定的模型：
    // 隔离点在「活」上不在「机器」上）。它跟生产活的区别只有一个：**回填去哪**。
    profiles: [],
    account: "main",
    // base 留 null：四个写入脚本都有 `if (!B) 跳过` 的分支，所以研发活天然不落库，
    // 只跑流程、留日志。等真开了测试 base 再填这里，其它地方一行都不用改。
    base: null,
    lead: null, pool: null, video: null, keyword: null, script: null,
    isDev: true,
  },
];

// 传入业务线名、key、或 profile 名都能路由。
//
// ⚠️ 认不出**必须抛错，不能兜底**（0922 改）。
// 旧实现 `return ROUTES[0]`，注释写的是"避免静默丢数据"，但实际效果是
// **静默污染别人的库**：小彩(xiaolongxia)不在任何 route 里，它一旦开跑，
// 悦升研发机采的线索会整批写进金诺的生产飞书表，而且没有任何人会发现。
// 抛错才是安全的那一侧：数据不会丢（脚本会红、人看得见），也不会写错地方。
function routeOf(hint) {
  const h = String(hint || "").trim();
  if (h) {
    for (const r of ROUTES) {
      if (r.line === h || r.key === h || r.profiles.includes(h)) return r;
    }
    // 宽松匹配：业务线字段有时带前后缀
    for (const r of ROUTES) {
      if (r.line && (h.includes(r.line) || r.line.includes(h))) return r;
    }
  }
  throw new Error(
    "未配路由: " + (h || "(空)") +
    " —— 认不出这批数据该回填给谁。别猜：以前这里兜底倒进金诺，" +
    "结果是别人的研发数据会静默写进金诺生产表。" +
    "请在 line-routes.js 的 ROUTES 里补一条，或让调用方传对业务线名/key。"
  );
}

// 兜底已经取消，不再有 fallback 这回事。保留导出只为不炸掉老调用方。
function isFallback() { return false; }

module.exports = { ROUTES, routeOf, isFallback };
