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
];

// 传入业务线名或 profile 名都能路由；认不出时回落金诺（保持历史行为，避免静默丢数据）
function routeOf(hint) {
  const h = String(hint || "").trim();
  if (h) {
    for (const r of ROUTES) {
      if (r.line === h || r.key === h || r.profiles.includes(h)) return r;
    }
    // 宽松匹配：业务线字段有时带前后缀
    for (const r of ROUTES) {
      if (h.includes(r.line) || r.line.includes(h)) return r;
    }
  }
  return ROUTES[0];
}

function isFallback(hint) {
  return routeOf(hint) === ROUTES[0] && !ROUTES[0].profiles.includes(String(hint || "").trim())
    && String(hint || "").trim() !== ROUTES[0].line && String(hint || "").trim() !== ROUTES[0].key;
}

module.exports = { ROUTES, routeOf, isFallback };
