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
    // 客户语义（写进线索表那三列）。0923 前这三个值写死在 sort-comments.js 里，
    // 于是悦升（企业 AI 部署）的线索表每一条都标着"考证人群"——按人群筛选时
    // 看到的是另一家客户的标签。语义跟客户走，不跟代码走。
    intent: "证书/学习/求职",
    audience: "考证人群",
    tier: "精准词",
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
    intent: "私有化部署/降本/AI办公",
    audience: "企业AI决策者",
    tier: "精准词",
  },
];

// 传入业务线名、key、或 profile 名都能路由。
//
// ⚠️ 认不出**必须抛错，不能兜底**（0922 改）。
// 旧实现 `return ROUTES[0]`，注释写的是"避免静默丢数据"，但实际效果是
// **静默污染别人的库**：小彩(xiaolongxia)不在任何 route 里，它一旦开跑，
// 悦升研发机采的线索会整批写进金诺的生产飞书表，而且没有任何人会发现。
// 抛错才是安全的那一侧：数据不会丢（脚本会红、人看得见），也不会写错地方。
// 第二参 opts.dev 只是**标签**，不影响路由到哪个客户——
// 「金诺的研发就在金诺里面，悦升的研发就在悦升里面」（主理人 0922）。
// 上一版把 dev 做成第三条路由且 base=null，等于把研发当成第三个客户，
// 而且让研发活的数据直接丢失、无处可查。客户才是路由，研发是它身上的一个属性。
function routeOf(hint, opts) {
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

// 研发标签往哪写：线索表已有的「实验批次」列（自由文本，两个客户库都有这一列，
// 0922 实测各 34 列结构一致）。不新造字段——新造就得在两个 base 上各建一次，
// 而且老数据没有这一列，筛选时又是一处特例。
function devBatchTag(isDev) { return isDev ? "研发" : ""; }

module.exports = { ROUTES, routeOf, isFallback, devBatchTag };
