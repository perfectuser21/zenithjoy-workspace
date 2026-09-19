# 抖音获客线索表字段收敛 + 自有账号/视频去重 + 成功触达真实校验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收敛金诺租户抖音获客线索表的写表字段（删合并列/命中关键词，独立客户昵称/抖音号/主页链接/评论作品视频链接列），采集侧加自有账号+同视频去重过滤，触达侧新增能反映真实送达情况的「成功触达」字段。

**Architecture:** 抽取两个纯函数库（`own-accounts-lib.js` 自有账号判定、`lead-fields-lib.js` 线索表字段构造+去重集合提取）供 `push-leads.js`/`sort-comments.js`/`update-profile-links.js`/`next-outreach.js` 复用，替换掉这几个脚本里原本各自内联、且都依赖同一个即将被删除的「抖音昵称/主页链接」合并字段的重复逻辑。`harvest-keyword.sh` 新增两个小 CLI 调用点（`check-own-account.js`/`fetch-seen-videos.js`）做真机侧过滤。Path 2（Chrome CDP）触达链路已有的三态判定直接复用，只加一个状态映射；老链路（真机 ADB）因探测二进制不在本仓库，「成功触达」降级写"待确认"。

**Tech Stack:** Node.js（CommonJS，飞书 Bitable REST API 裸 fetch）、zsh shell 脚本、TypeScript + Vitest（apps/api）、`node --test`（services/phone-adb-controller）。

---

## 前置说明（先读）

**耦合关系**：`push-leads.js`、`sort-comments.js`（write 模式）都往「抖音昵称/主页链接」合并字段写数据；`next-outreach.js`/`next-outreach-lib.js` 依赖这个合并字段解析昵称/抖音号/主页链接；`update-profile-links.js` 也读写这个字段来回填主页直链。**必须先把读方（next-outreach、update-profile-links）切到独立字段，再让写方（push-leads、sort-comments）停止写合并字段**，否则中间状态会让选单器/回填脚本读到 undefined。本计划的任务顺序已经按这个约束排好。

**范围边界**：只动金诺租户（`services/phone-adb-controller/` 下脚本，base `GNuwbzY0da8GP0sv6MGcOTu9ntd`）。老链路（真机 ADB `douyin-phone-adb` 二进制）的"对方未加好友"设备侧探测不在本仓库范围内，本计划只做降级处理（写"待确认" + 透传原始输出），不冒充已验证完成设备侧探测。

**生产 Feishu 表结构变更不在本计划任务范围内**：新增/删除/改名字段是对生产 Bitable 表的直接结构变更（删列会丢失该列历史数据），本计划的代码任务完成后，需要单独一步在生产表执行以下变更（由主理人确认后执行，非本计划自动化范围）：
- 改名：「昵称」→「客户昵称」，「评论原文」→「原始评论」
- 删除：「抖音昵称/主页链接」「命中关键词」
- 新增：「评论作品视频链接」（文本/URL 类型）、「成功触达」（单选：是/否/待确认）
- 视图隐藏：「业务线」

---

### Task 1: 自有账号名单判定库

**Files:**
- Create: `services/phone-adb-controller/config/own-accounts.json`
- Create: `services/phone-adb-controller/own-accounts-lib.js`
- Create: `services/phone-adb-controller/check-own-account.js`
- Test: `services/phone-adb-controller/__tests__/own-accounts-lib.test.mjs`

- [ ] **Step 1: 写配置文件**

```json
{
  "nicknames": ["躺赢AI学姐", "人工智能小诺考评"],
  "ids": ["langzi63485", "44997267357"]
}
```
路径：`services/phone-adb-controller/config/own-accounts.json`（收敛现有 `next-outreach.js` 里硬编码的两个小号，后续用户可自行增补）

- [ ] **Step 2: 写失败的测试**

创建 `services/phone-adb-controller/__tests__/own-accounts-lib.test.mjs`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnAccount } from "../own-accounts-lib.js";

const CONFIG = { nicknames: new Set(["躺赢AI学姐"]), ids: new Set(["langzi63485"]) };

test("isOwnAccount: 昵称命中", () => {
  assert.equal(isOwnAccount("躺赢AI学姐", "someid", CONFIG), true);
});
test("isOwnAccount: 抖音号命中", () => {
  assert.equal(isOwnAccount("随便昵称", "langzi63485", CONFIG), true);
});
test("isOwnAccount: 都不命中", () => {
  assert.equal(isOwnAccount("路人甲", "999999", CONFIG), false);
});
test("isOwnAccount: 空值不误判为命中", () => {
  assert.equal(isOwnAccount("", "", CONFIG), false);
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/own-accounts-lib.test.mjs`
Expected: FAIL，报 `Cannot find module '../own-accounts-lib.js'`

- [ ] **Step 4: 实现 own-accounts-lib.js**

```js
// own-accounts-lib.js —— 自有账号名单判定(纯函数,CJS)
"use strict";

function loadOwnAccounts(configPath) {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    nicknames: new Set(raw.nicknames || []),
    ids: new Set(raw.ids || []),
  };
}

function isOwnAccount(nick, id, config) {
  const n = String(nick || "").trim();
  const i = String(id || "").trim();
  if (n && config.nicknames.has(n)) return true;
  if (i && config.ids.has(i)) return true;
  return false;
}

module.exports = { loadOwnAccounts, isOwnAccount };
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/own-accounts-lib.test.mjs`
Expected: 4 项全 PASS

- [ ] **Step 6: 写 CLI 包装器**

```js
#!/usr/bin/env node
// check-own-account.js <nick> <id> —— 供 harvest-keyword.sh 调用
// stdout: own / not_own；退出码 0=own(命中,应跳过) 1=not_own
const path = require("path");
const { loadOwnAccounts, isOwnAccount } = require("./own-accounts-lib.js");
const [, , nick, id] = process.argv;
const configPath = path.join(__dirname, "config", "own-accounts.json");
const config = loadOwnAccounts(configPath);
if (isOwnAccount(nick, id, config)) {
  console.log("own");
  process.exit(0);
} else {
  console.log("not_own");
  process.exit(1);
}
```
路径：`services/phone-adb-controller/check-own-account.js`

- [ ] **Step 7: 手动跑一次验证 CLI**

Run: `node services/phone-adb-controller/check-own-account.js "躺赢AI学姐" "x"; echo "exit=$?"`
Expected: 打印 `own`，`exit=0`

Run: `node services/phone-adb-controller/check-own-account.js "路人甲" "999"; echo "exit=$?"`
Expected: 打印 `not_own`，`exit=1`

- [ ] **Step 8: Commit**

```bash
git add services/phone-adb-controller/config/own-accounts.json \
        services/phone-adb-controller/own-accounts-lib.js \
        services/phone-adb-controller/check-own-account.js \
        services/phone-adb-controller/__tests__/own-accounts-lib.test.mjs
git commit -m "feat(leadgen): 新增自有账号名单判定库"
```

---

### Task 2: 线索表字段构造 + 去重提取纯函数库

**Files:**
- Create: `services/phone-adb-controller/lead-fields-lib.js`
- Test: `services/phone-adb-controller/__tests__/lead-fields-lib.test.mjs`

- [ ] **Step 1: 写失败的测试**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLeadCoreFields, extractSeenEntries, findByDyid } from "../lead-fields-lib.js";

test("buildLeadCoreFields: 含新字段,不含旧字段", () => {
  const f = buildLeadCoreFields({ nick: "沉", dyid: "LHJ20001024", purl: "https://www.douyin.com/user/x", comment: "怎么报名", video: "初级会计视频", vurl: "https://v.douyin.com/AbCd/" });
  assert.equal(f["客户昵称"], "沉");
  assert.equal(f["抖音号"], "LHJ20001024");
  assert.equal(f["主页链接"], "https://www.douyin.com/user/x");
  assert.equal(f["原始评论"], "怎么报名");
  assert.equal(f["评论作品视频链接"], "https://v.douyin.com/AbCd/");
  assert.equal("抖音昵称/主页链接" in f, false);
  assert.equal("命中关键词" in f, false);
  assert.equal("评论原文" in f, false);
  assert.equal("昵称" in f, false);
});

test("buildLeadCoreFields: 非法链接(不以http开头)留空", () => {
  const f = buildLeadCoreFields({ nick: "沉", dyid: "x", purl: "display:砚秋", comment: "c", video: "v", vurl: "" });
  assert.equal(f["主页链接"], "");
  assert.equal(f["评论作品视频链接"], "");
});

test("extractSeenEntries: 从独立字段读取,不解析合并列", () => {
  const records = [
    { record_id: "r1", fields: { "客户昵称": "沉", "抖音号": "LHJ20001024", "重复命中次数": 2 } },
    { record_id: "r2", fields: { "客户昵称": "板烧鸡腿堡", "抖音号": "" } },
  ];
  const entries = extractSeenEntries(records);
  assert.deepEqual(entries[0], { nick: "沉", dyid: "LHJ20001024", record_id: "r1", dup: 2 });
  assert.deepEqual(entries[1], { nick: "板烧鸡腿堡", dyid: "", record_id: "r2", dup: 0 });
});

test("findByDyid: 精确匹配抖音号", () => {
  const rows = [{ id: "r1", dyid: "abc" }, { id: "r2", dyid: "xyz" }];
  assert.equal(findByDyid(rows, "xyz").id, "r2");
  assert.equal(findByDyid(rows, "no-such"), null);
});
```
路径：`services/phone-adb-controller/__tests__/lead-fields-lib.test.mjs`

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/lead-fields-lib.test.mjs`
Expected: FAIL，`Cannot find module '../lead-fields-lib.js'`

- [ ] **Step 3: 实现 lead-fields-lib.js**

```js
// lead-fields-lib.js —— 线索表(LEADS)字段构造 + 去重集合提取(纯函数,CJS)
// 0919 字段收敛: 不再写「抖音昵称/主页链接」合并列、不再写「命中关键词」；
// 「评论原文」→「原始评论」；新增独立「评论作品视频链接」。
"use strict";

function buildLeadCoreFields({ nick, dyid, purl, comment, video, vurl }) {
  return {
    "客户昵称": nick || "",
    "抖音号": dyid || "",
    "主页链接": (purl && purl.startsWith("http")) ? purl : "",
    "原始评论": comment || "",
    "来源视频": (video || "").slice(0, 80),
    "评论作品视频链接": (vurl && vurl.startsWith("http")) ? vurl : "",
  };
}

function defaultTxt(v) {
  return Array.isArray(v) ? v.map((x) => x.text || x).join("") : String(v || "");
}

// 从线索表已有记录里提取去重用的 {nick, dyid, record_id, dup} 列表(读独立字段,不再解析合并列)
function extractSeenEntries(records, txt) {
  const t = txt || defaultTxt;
  return (records || []).map((it) => ({
    nick: t(it.fields["客户昵称"]),
    dyid: t(it.fields["抖音号"]),
    record_id: it.record_id,
    dup: Number(it.fields["重复命中次数"]) || 0,
  }));
}

function findByDyid(rows, dyid) {
  return rows.find((r) => r.dyid === dyid) || null;
}

module.exports = { buildLeadCoreFields, extractSeenEntries, findByDyid };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/lead-fields-lib.test.mjs`
Expected: 4 项全 PASS

- [ ] **Step 5: Commit**

```bash
git add services/phone-adb-controller/lead-fields-lib.js \
        services/phone-adb-controller/__tests__/lead-fields-lib.test.mjs
git commit -m "feat(leadgen): 新增线索表字段构造+去重提取纯函数库"
```

---

### Task 3: next-outreach-lib.js 切到独立字段读取（先切读方）

**Files:**
- Modify: `services/phone-adb-controller/next-outreach-lib.js`
- Modify: `services/phone-adb-controller/next-outreach.js:56-59,79-80`
- Modify: `services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs`

- [ ] **Step 1: 改写测试为字段对象输入（先写新断言，此时会失败）**

把 `services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs` 整体替换为：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import lib from "../next-outreach-lib.js";

const F_OK = { "客户昵称": "沉", "抖音号": "LHJ20001024", "主页链接": "https://www.douyin.com/user/MS4wLjABAAAAtest-_x" };
const F_SHORT = { "客户昵称": "板烧鸡腿堡", "抖音号": "P0ten", "主页链接": "https://v.douyin.com/AbCd123/" };
const F_NOLINK = { "客户昵称": "砚秋", "抖音号": "", "主页链接": "" };
const F_PENDING = { "客户昵称": "你脸红了诶~", "抖音号": "31225819860", "主页链接": "https://www.douyin.com/user/MS4wq" };

test("extractLead: 直接读独立字段", () => {
  const r = lib.extractLead(F_OK);
  assert.equal(r.nick, "沉");
  assert.equal(r.dyid, "LHJ20001024");
  assert.equal(r.profileUrl, "https://www.douyin.com/user/MS4wLjABAAAAtest-_x");
});
test("extractLead: 短链字段", () => {
  assert.equal(lib.extractLead(F_SHORT).profileUrl, "https://v.douyin.com/AbCd123/");
});
test("classifyPending: 带链+合法dyid=ok", () => {
  assert.equal(lib.classifyPending(F_OK), "ok");
  assert.equal(lib.classifyPending(F_PENDING), "ok");
});
test("classifyPending: 无链=no_link", () => {
  assert.equal(lib.classifyPending(F_NOLINK), "no_link");
});
test("classifyPending: 有链但dyid非法=no_link", () => {
  assert.equal(lib.classifyPending({ "客户昵称": "某人", "抖音号": "id待核验", "主页链接": "https://v.douyin.com/x1/" }), "no_link");
  assert.equal(lib.classifyPending({ "客户昵称": "某人", "抖音号": "中文号", "主页链接": "https://v.douyin.com/x1/" }), "no_link");
});
test("requeueTransientFields: 首轮回队待触达+标记", () => {
  const f = lib.requeueTransientFields("", "AdbIME cannot be enabled", "0915 12:00(UTC+8)");
  assert.equal(f["状态"], "待触达");
  assert.ok(f["回复结果"].startsWith("[瞬时败]"));
});
test("requeueTransientFields: 二轮转受阻,保留原文", () => {
  const f = lib.requeueTransientFields("[瞬时败][1轮 0915 12:00(UTC+8)]x", "again", "0915 13:00(UTC+8)");
  assert.equal(f["状态"], "触达受阻");
  assert.equal(f["发送状态"], "发送失败");
  assert.ok(f["回复结果"].includes("[瞬时败]"));
  assert.ok(f["回复结果"].includes("2轮转受阻"));
  assert.ok(f["回复结果"].length <= 200);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs`
Expected: FAIL（`extractLead`/`classifyPending` 仍是字符串解析版，传对象进去会解构出 undefined）

- [ ] **Step 3: 重写 next-outreach-lib.js（先减后增：删字符串解析版，换字段读取版）**

```js
// next-outreach-lib.js —— 选单器纯函数(CJS)。与 next-outreach.js 同目录同批部署:
// 网关副本 /opt/openclaw/state/ 漏发本文件 = 首个 tick MODULE_NOT_FOUND 全线选单挂。
// 0919 字段收敛: 「抖音昵称/主页链接」合并列已删,选单器直接读线索表独立字段
// 客户昵称/抖音号/主页链接,不再拼串解析。
"use strict";

const DYID_RE = /^[A-Za-z0-9._]{4,}$/;
const TRANSIENT_MARK = "[瞬时败]";

function extractLead(fields) {
  const f = fields || {};
  return {
    nick: String(f["客户昵称"] || ""),
    dyid: String(f["抖音号"] || ""),
    profileUrl: String(f["主页链接"] || ""),
  };
}

function isValidDyid(dyid) {
  return !!dyid && dyid !== "id待核验" && DYID_RE.test(dyid);
}

// 出单资格(决策 c5828297): 主页链接=必备件;dyid 供主页强校验闸,同为必备。
function classifyPending(fields) {
  const { dyid, profileUrl } = extractLead(fields);
  if (!profileUrl.startsWith("https://")) return "no_link";
  if (!isValidDyid(dyid)) return "no_link";
  return "ok";
}

// 瞬时失败两轮状态机(决策 c5828297): 执行内10次用尽=1轮回队;再来一轮仍败=受阻。
function requeueTransientFields(prevReply, note, now) {
  const prev = String(prevReply || "");
  const clip = (s) => s.slice(0, 200);
  if (prev.includes(TRANSIENT_MARK)) {
    return {
      "状态": "触达受阻",
      "发送状态": "发送失败",
      "回复结果": clip(prev + " | [瞬时败2轮转受阻 " + now + "]" + note),
    };
  }
  return {
    "状态": "待触达",
    "回复结果": clip(TRANSIENT_MARK + "[1轮 " + now + "]" + note),
  };
}

module.exports = { extractLead, isValidDyid, classifyPending, requeueTransientFields, TRANSIENT_MARK };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs`
Expected: 7 项全 PASS

- [ ] **Step 5: 改 next-outreach.js 调用点**

在 `services/phone-adb-controller/next-outreach.js` 里，把：

```js
  for (const r of leads) {
    if (txt(r.fields["状态"]) !== "待触达") continue;
    const raw = txt(r.fields["抖音昵称/主页链接"]);
    (lib.classifyPending(raw) === "ok" ? pending : noLink).push(r);
  }
```

改成：

```js
  for (const r of leads) {
    if (txt(r.fields["状态"]) !== "待触达") continue;
    (lib.classifyPending(r.fields) === "ok" ? pending : noLink).push(r);
  }
```

把：

```js
  const lead = lib.extractLead(txt(pick.fields["抖音昵称/主页链接"]));
```

改成：

```js
  const lead = lib.extractLead(pick.fields);
```

- [ ] **Step 6: 跑相关测试确认没有回归**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 全部 PASS（own-accounts-lib / lead-fields-lib / next-outreach-lib 三个测试文件）

- [ ] **Step 7: Commit**

```bash
git add services/phone-adb-controller/next-outreach-lib.js \
        services/phone-adb-controller/next-outreach.js \
        services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs
git commit -m "refactor(leadgen): 选单器改读独立字段,不再解析抖音昵称/主页链接合并列"
```

---

### Task 4: push-leads.js 迁移到新字段（停写合并列/命中关键词）

**Files:**
- Modify: `services/phone-adb-controller/push-leads.js`

- [ ] **Step 1: 整体重写**

把整个 `services/phone-adb-controller/push-leads.js` 替换为：

```js
// push-leads.js <tsv路径> <搜索账号标识> —— KPI夜写表器
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const { buildLeadCoreFields, extractSeenEntries } = require("./lead-fields-lib.js");
const [,, TSV, SRCACC] = process.argv;
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", TBL = "tblTLFj69CflUqSr";
  let seen = new Set(), pt = "";
  do {
    const r = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records?page_size=100"+(pt?"&page_token="+pt:""), { headers: H })).json();
    for (const e of extractSeenEntries(r.data.items)) {
      if (e.nick) seen.add(e.nick);
      if (e.dyid) seen.add(e.dyid);
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16) + "(UTC+8)";
  const lines = fs.readFileSync(TSV,"utf8").trim().split("\n").filter(l=>l.startsWith("LEAD\t"));
  let created = 0;
  for (const ln of lines) {
    const f = ln.split("\t");
    // 第9列(命中关键词)在线索表字段收敛后不再写入线索表,仅原样跳过位置
    const [, nick, id, atype, comment, cdate, region, video, , pip, purl, vurl] = f; // 0914 六刀融合: 第11列purl=主页直链,第12列vurl=原爆款作品地址
    if (atype === "organization") { console.log("跳过同行:", nick); continue; }
    if ((id && seen.has(id)) || seen.has(nick)) { console.log("去重:", nick); continue; }
    const body = { fields: {
      "抖音获客-线索表": nick + " / " + (id || "id待核验"),
      ...buildLeadCoreFields({ nick, dyid: id, purl, comment, video, vurl }),
      "业务线": "AI人工智能训练师", "关键词层级": "精准词",
      "AI判断理由": "评论显示相关意向(" + comment.slice(0,30) + ")," + (region.includes("陕西")?"IP陕西,":"") + "KPI夜采集线索。",
      "状态": "待触达", "发送状态": "未发送",
      "搜索账号": SRCACC,
      "搜索意图": "证书/学习/求职", "目标人群": "考证人群",
      "采集时间": now,
      "合规核验状态": "KPI夜直采(0914)｜真机评论区采集,身份经主页复验(主页IP:"+(pip||"未读")+";评论"+cdate+" IP:"+region+")｜仅内部写入,未触达。"
    }};
    const res = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records", { method: "POST", headers: H, body: JSON.stringify(body) })).json();
    if (res.code === 0) { created++; seen.add(nick); if(id) seen.add(id); console.log("OK", nick); }
    else console.log("FAIL", nick, JSON.stringify(res).slice(0,120));
  }
  const cnt = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records?page_size=1", { headers: H })).json();
  console.log("写入", created, "| 总行数:", cnt.data.total);
})();
```

- [ ] **Step 2: 语法检查**

Run: `node --check services/phone-adb-controller/push-leads.js`
Expected: 无输出（语法通过）

- [ ] **Step 3: Commit**

```bash
git add services/phone-adb-controller/push-leads.js
git commit -m "refactor(leadgen): push-leads.js 停写合并列/命中关键词,改用字段构造库"
```

---

### Task 5: push-raw-comments.js 补采评论作品视频链接

**Files:**
- Modify: `services/phone-adb-controller/push-raw-comments.js:38-49`

- [ ] **Step 1: 补 vurl 解构 + 新字段写入**

把：

```js
    const [, nick, id, atype, comment, cdate, region, video, kw, pip, purl] = f;
    const rid = `${nick}|${id||"noid"}|${(comment||"").slice(0,20)}`;
    if (seen.has(rid)) { dup++; continue; }
    const body = { fields: {
      "原始评论ID": rid, "运行批次": BATCH || "manual",
      "采集时间": asTime("采集时间", now), "命中关键词": kw || "",
      "来源视频": (video||"").slice(0,100),
      "评论原文": comment || "", "评论者昵称": nick || "",
      // 0915 主理人逐列验收拍板: 独立字段成列;「用户主页标识」拼串保留双写(存量兼容,勿再新增读取方)
      "用户主页标识": [id||"", purl||"", atype||""].filter(Boolean).join(" | "),
      "抖音号": id || "", "主页链接": purl || "", "账号类型": atype || "",
      "留言时间": cdate || "", "主页IP": (pip||"").trim(),
      "地区": region || "", "处理状态": "待分拣",
    }};
```

改成：

```js
    const [, nick, id, atype, comment, cdate, region, video, kw, pip, purl, vurl] = f;
    const rid = `${nick}|${id||"noid"}|${(comment||"").slice(0,20)}`;
    if (seen.has(rid)) { dup++; continue; }
    const body = { fields: {
      "原始评论ID": rid, "运行批次": BATCH || "manual",
      "采集时间": asTime("采集时间", now), "命中关键词": kw || "",
      "来源视频": (video||"").slice(0,100),
      "评论作品视频链接": (vurl && vurl.startsWith("http")) ? vurl : "",
      "评论原文": comment || "", "评论者昵称": nick || "",
      // 0915 主理人逐列验收拍板: 独立字段成列;「用户主页标识」拼串保留双写(存量兼容,勿再新增读取方)
      "用户主页标识": [id||"", purl||"", atype||""].filter(Boolean).join(" | "),
      "抖音号": id || "", "主页链接": purl || "", "账号类型": atype || "",
      "留言时间": cdate || "", "主页IP": (pip||"").trim(),
      "地区": region || "", "处理状态": "待分拣",
    }};
```

> 注：评论池表（`原始评论池`）本身的「命中关键词」字段不受本次线索表字段收敛影响，`update-keyword-stats.js` 靠它统计关键词效果，保留不动。

- [ ] **Step 2: 语法检查**

Run: `node --check services/phone-adb-controller/push-raw-comments.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add services/phone-adb-controller/push-raw-comments.js
git commit -m "fix(leadgen): push-raw-comments.js 补采评论作品视频链接(原12列漏读第12列)"
```

---

### Task 6: sort-comments.js write 模式迁移到新字段

**Files:**
- Modify: `services/phone-adb-controller/sort-comments.js:1-11,85-135`

- [ ] **Step 1: 引入字段构造库**

在文件顶部 `const { routeOf } = require("./line-routes.js");` 之后加一行：

```js
const { buildLeadCoreFields, extractSeenEntries } = require("./lead-fields-lib.js");
```

- [ ] **Step 2: 替换 seen Map 构建逻辑**

把：

```js
    const seen = new Map(); let lp = "";
    do {
      const r = await feishu(`/tables/${LEADS}/records?page_size=100${lp ? "&page_token=" + lp : ""}`, "GET", null, tok);
      for (const it of r.data.items || []) {
        const dup = it.fields["重复命中次数"] || 0;
        txt(it.fields["抖音昵称/主页链接"]).split("/").forEach(s => { const t = s.trim(); if (t) seen.set(t, { id: it.record_id, dup }); });
      }
      lp = r.data.has_more ? r.data.page_token : "";
    } while (lp);
```

改成：

```js
    const seen = new Map(); let lp = "";
    do {
      const r = await feishu(`/tables/${LEADS}/records?page_size=100${lp ? "&page_token=" + lp : ""}`, "GET", null, tok);
      for (const e of extractSeenEntries(r.data.items || [], txt)) {
        const val = { id: e.record_id, dup: e.dup };
        if (e.nick) seen.set(e.nick, val);
        if (e.dyid) seen.set(e.dyid, val);
      }
      lp = r.data.has_more ? r.data.page_token : "";
    } while (lp);
```

- [ ] **Step 3: 替换线索表写入字段**

把：

```js
      const key = nick + " / " + (dyid || "id待核验");
      const res = await feishu(`/tables/${LEADS}/records`, "POST", { fields: {
        // 0915 主理人逐列验收拍板: 首列=纯昵称;独立字段成列;混合列保留双写(next-outreach 选单器在读)
        "抖音获客-线索表": nick,
        "昵称": nick, "抖音号": dyid || "", "主页链接": (purl && purl.startsWith("http")) ? purl : "",
        "IP属地": txt(f["地区"]), "留言时间": txt(f["留言时间"]),
        "抖音昵称/主页链接": key + (purl && purl.startsWith("http") ? " / " + purl : ""),
        "业务线": "AI人工智能训练师", "命中关键词": txt(f["命中关键词"]), "关键词层级": "精准词",
        "评论原文": txt(f["评论原文"]),
        "AI判断理由": `[${it.grade}级] ` + (it.reason || ""),
        "状态": "待触达", "发送状态": "未发送",
        "来源视频": txt(f["来源视频"]).slice(0, 80), "搜索账号": "池转入(异步判定)",
        "搜索意图": "证书/学习/求职", "目标人群": "考证人群", "采集时间": now,
        "合规核验状态": "异步判定agent分级入表(" + now + ")｜评论区采集｜仅内部写入,未触达。",
      }}, tok);
```

改成：

```js
      const res = await feishu(`/tables/${LEADS}/records`, "POST", { fields: {
        "抖音获客-线索表": nick,
        ...buildLeadCoreFields({ nick, dyid, purl, comment: txt(f["评论原文"]), video: txt(f["来源视频"]), vurl: txt(f["评论作品视频链接"]) }),
        "IP属地": txt(f["地区"]), "留言时间": txt(f["留言时间"]),
        "业务线": "AI人工智能训练师", "关键词层级": "精准词",
        "AI判断理由": `[${it.grade}级] ` + (it.reason || ""),
        "状态": "待触达", "发送状态": "未发送",
        "搜索账号": "池转入(异步判定)",
        "搜索意图": "证书/学习/求职", "目标人群": "考证人群", "采集时间": now,
        "合规核验状态": "异步判定agent分级入表(" + now + ")｜评论区采集｜仅内部写入,未触达。",
      }}, tok);
```

- [ ] **Step 4: 语法检查**

Run: `node --check services/phone-adb-controller/sort-comments.js`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add services/phone-adb-controller/sort-comments.js
git commit -m "refactor(leadgen): sort-comments.js write模式停写合并列,改用字段构造库+转发视频链接"
```

---

### Task 7: update-profile-links.js 迁移到独立字段

**Files:**
- Modify: `services/phone-adb-controller/update-profile-links.js`

- [ ] **Step 1: 整体重写**

```js
// update-profile-links.js <refill_tsv> —— 按抖音号把主页直链回写进「主页链接」字段
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const { findByDyid } = require("./lead-fields-lib.js");
const TSV = process.argv[2];
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : String(v || ""); }
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", TBL = "tblTLFj69CflUqSr";
  // 1. 全表: dyid -> {record_id, purl}
  const rows = []; let pt = "";
  do {
    const r = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records?page_size=100"+(pt?"&page_token="+pt:""), { headers: H })).json();
    for (const it of r.data.items) {
      rows.push({ id: it.record_id, dyid: txt(it.fields["抖音号"]), purl: txt(it.fields["主页链接"]) });
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  // 2. refill TSV
  const lines = fs.readFileSync(TSV,"utf8").trim().split("\n").filter(l=>l.startsWith("REFILL\t"));
  let updated = 0, already = 0, miss = 0;
  for (const ln of lines) {
    const [, dyid, purl] = ln.split("\t");
    if (!dyid || !purl || !purl.startsWith("http")) continue;
    const hit = findByDyid(rows, dyid);
    if (!hit) { console.log("MISS", dyid); miss++; continue; }
    if (hit.purl.includes("douyin.com/user/")) { already++; continue; }
    const res = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records/"+hit.id, { method: "PUT", headers: H, body: JSON.stringify({ fields: { "主页链接": purl } }) })).json();
    if (res.code === 0) { updated++; hit.purl = purl; console.log("OK", dyid); }
    else console.log("FAIL", dyid, JSON.stringify(res).slice(0,100));
  }
  console.log("回写", updated, "| 已有链接", already, "| 未匹配", miss, "| 输入", lines.length);
})();
```

- [ ] **Step 2: 语法检查**

Run: `node --check services/phone-adb-controller/update-profile-links.js`
Expected: 无输出

- [ ] **Step 3: Commit**

```bash
git add services/phone-adb-controller/update-profile-links.js
git commit -m "refactor(leadgen): update-profile-links.js 改按抖音号独立字段精确匹配回填"
```

---

### Task 8: harvest-keyword.sh 自有账号过滤

**Files:**
- Modify: `services/phone-adb-controller/harvest-keyword.sh`

- [ ] **Step 1: 定位插入点，加自有账号判定**

在 `services/phone-adb-controller/harvest-keyword.sh` 里找到这一段（身份验证成功后）：

```
    if [[ -z "$ONICK" ]]; then log "  行$j 身份验证3次仍失败,弃: $NICK"; continue; fi
    # 0914 主理人验收:每人顺取名片主页直链(identity已回评论区,重进主页跑card-link,其自带恢复)
```

在 `if [[ -z "$ONICK" ]]; then ...; fi` 之后、`# 0914 主理人验收` 之前插入：

```
    # 0919 自有账号过滤: 命中自有名单的评论不当线索;若命中的是视频作者本人,整条视频其余评论不再采集
    if node "$(dirname "$0")/check-own-account.js" "$ONICK" "${OID:-}" >/dev/null 2>&1; then
      if [[ "$AUTHOR" == "author" ]]; then
        log "  视频作者是自有账号($ONICK),本视频其余评论不再采集"
        break
      fi
      log "  跳过自有账号: $ONICK"
      continue
    fi
```

- [ ] **Step 2: 语法检查**

Run: `zsh -n services/phone-adb-controller/harvest-keyword.sh`
Expected: 无输出（语法通过）

- [ ] **Step 3: Commit**

```bash
git add services/phone-adb-controller/harvest-keyword.sh
git commit -m "feat(leadgen): harvest-keyword.sh 加自有账号过滤(含视频作者判定)"
```

---

### Task 9: 同视频去重

**Files:**
- Create: `services/phone-adb-controller/fetch-seen-videos.js`
- Modify: `services/phone-adb-controller/harvest-keyword.sh`

- [ ] **Step 1: 写 fetch-seen-videos.js**

```js
#!/usr/bin/env node
// fetch-seen-videos.js [业务线] —— 拉取「视频池」表已存在的视频ID,逐行打印到 stdout
// 供 harvest-keyword.sh 采集前查重用。不传业务线时按 line-routes.js 默认路由(金诺)。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const { routeOf } = require("./line-routes.js");
const LINE = process.argv[2] || "";
const ROUTE = routeOf(LINE);
if (!ROUTE.video) process.exit(0); // 该业务线无视频池,视为无历史记录
const acc = cfg.channels.feishu.accounts[ROUTE.account];
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  let pt = "";
  do {
    const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${ROUTE.base}/tables/${ROUTE.video}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
    for (const it of r.data.items || []) {
      const v = it.fields["视频ID"];
      const s = Array.isArray(v) ? v.map(x => x.text || x).join("") : String(v || "");
      if (s) console.log(s);
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
})();
```

> 说明：这是网络 I/O 脚本，和同目录 `push-videos.js`/`fetch-seen-videos.js` 之外的其它 push-*.js 一样不写单元测试（纯逻辑已经在 lib 文件里测过），行为通过 Task 后的真机验证覆盖。

- [ ] **Step 2: harvest-keyword.sh 接入：拉取已处理视频列表**

在文件靠前位置，找到：

```
P="$1"; KW="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-same_city}"
KWTXT="$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$KW")"
log(){ print -u2 -- "[$(date +%H:%M:%S)] $*"; }
# RAM盘只有2G,采收截图很快塞爆(0914实证:爆盘让mkdir全军覆没误报锁被占)
find /Volumes/EvidenceRAM/openclaw-phone/evidence -type f \( -name "*.png" -o -name "*.mkv" -o -name "*.wav" \) -mmin +30 -delete 2>/dev/null

$C --profile "$P" lock-acquire "$TAG" >/dev/null 2>&1 || { log "锁被占,退出"; exit 3; }
trap '$C --profile "$P" lock-release "$TAG" >/dev/null 2>&1' EXIT
```

改成：

```
P="$1"; KW="$2"; MAXV="${3:-4}"; TAG="$4"; LOC="${5:-same_city}"; LINE="${6:-}"
KWTXT="$(python3 -c "import urllib.parse,sys;print(urllib.parse.unquote(sys.argv[1]))" "$KW")"
log(){ print -u2 -- "[$(date +%H:%M:%S)] $*"; }
# RAM盘只有2G,采收截图很快塞爆(0914实证:爆盘让mkdir全军覆没误报锁被占)
find /Volumes/EvidenceRAM/openclaw-phone/evidence -type f \( -name "*.png" -o -name "*.mkv" -o -name "*.wav" \) -mmin +30 -delete 2>/dev/null

# 0919 同视频去重: 采集前拉一次「视频池」已存在的视频ID,采集中命中就跳过该视频
SEENVIDS="$(mktemp -t seen-videos)"
node "$(dirname "$0")/fetch-seen-videos.js" "$LINE" > "$SEENVIDS" 2>/dev/null

$C --profile "$P" lock-acquire "$TAG" >/dev/null 2>&1 || { log "锁被占,退出"; rm -f "$SEENVIDS"; exit 3; }
trap '$C --profile "$P" lock-release "$TAG" >/dev/null 2>&1; rm -f "$SEENVIDS"' EXIT
```

- [ ] **Step 3: harvest-keyword.sh 接入：命中即跳过该视频**

找到：

```
  VID="$(print -- "$VLINK" | sed -n "s/^video_id=//p")"
  [[ -n "$VURL" ]] && log "  作品链接: $VURL"
  if ! $C --profile "$P" open-comments "$TAG-v$i-oc" >/dev/null 2>&1; then
```

改成：

```
  VID="$(print -- "$VLINK" | sed -n "s/^video_id=//p")"
  [[ -n "$VURL" ]] && log "  作品链接: $VURL"
  if [[ -n "$VID" ]] && grep -qxF "$VID" "$SEENVIDS" 2>/dev/null; then
    log "  视频已处理过,跳过: $VID"
    $C --profile "$P" back >/dev/null 2>&1; sleep 2
    continue
  fi
  if ! $C --profile "$P" open-comments "$TAG-v$i-oc" >/dev/null 2>&1; then
```

- [ ] **Step 4: 语法检查**

Run: `node --check services/phone-adb-controller/fetch-seen-videos.js && zsh -n services/phone-adb-controller/harvest-keyword.sh`
Expected: 无输出

- [ ] **Step 5: Commit**

```bash
git add services/phone-adb-controller/fetch-seen-videos.js \
        services/phone-adb-controller/harvest-keyword.sh
git commit -m "feat(leadgen): 加同视频去重(采集前查视频池,命中即跳过)"
```

---

### Task 10: 成功触达 — 老链路降级处理

**Files:**
- Modify: `services/phone-adb-controller/next-outreach.js`（done 模式 sent 分支）
- Modify: `services/phone-adb-controller/outreach-tick.sh`

- [ ] **Step 1: next-outreach.js sent 分支加「成功触达」+ 透传备注**

找到：

```js
    if (result === "sent") {
      fields = { "状态": "已触达", "发送状态": "已发送", "触达时间": now };
    } else if (result === "requeue") {
```

改成：

```js
    if (result === "sent") {
      // 0919: 真机ADB二进制目前无法探测"对方未加好友",降级写"待确认"而非冒充"是"；
      // 原始设备输出(note)透传进回复结果供人工核实(判定点 e035dad8 范畴)。
      fields = { "状态": "已触达", "发送状态": "已发送", "触达时间": now, "成功触达": "待确认", "回复结果": ("[老链路待人工核验]" + note).slice(0, 200) };
    } else if (result === "requeue") {
```

- [ ] **Step 2: outreach-tick.sh 透传真实设备输出**

找到：

```
  if print -- "$OUT" | grep -q "send_status=sent"; then
    mark "$RID" sent "ok"
    log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"
    exit 0
  fi
```

改成：

```
  if print -- "$OUT" | grep -q "send_status=sent"; then
    RAWTAIL=$(print -- "$OUT" | tail -3 | tr '\n' ' ' | cut -c1-180)
    mark "$RID" sent "$RAWTAIL"
    log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"
    exit 0
  fi
```

- [ ] **Step 3: 语法检查**

Run: `node --check services/phone-adb-controller/next-outreach.js && zsh -n services/phone-adb-controller/outreach-tick.sh`
Expected: 无输出

- [ ] **Step 4: Commit**

```bash
git add services/phone-adb-controller/next-outreach.js \
        services/phone-adb-controller/outreach-tick.sh
git commit -m "feat(leadgen): 老链路成功触达降级写待确认+透传设备原始输出"
```

---

### Task 11: 成功触达 — Path 2（Chrome CDP）真实映射

**Files:**
- Modify: `apps/api/src/services/lead-writer.ts`
- Modify: `apps/api/tests/p2-sprint-b1-ws4/lead-writer.test.ts`

- [ ] **Step 1: 写失败的测试**

在 `apps/api/tests/p2-sprint-b1-ws4/lead-writer.test.ts` 的 `describe('Path 2 抖音私信主动触达 — writeDmOutreachStatus [BEHAVIOR]', ...)` 块内，紧跟在现有 `it('sent → 触达状态=已私信 ...')` 用例之后插入三个新用例：

```ts
  it('sent → 成功触达=是', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_dm' });
    await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'sent',
    });
    const fields = (writeRecord as any).mock.calls[0][2];
    expect(fields['成功触达']).toBe('是');
  });

  it('limited → 成功触达=否（禁止假是）', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_dm' });
    await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'limited',
    });
    const fields = (writeRecord as any).mock.calls[0][2];
    expect(fields['成功触达']).toBe('否');
  });

  it('failed → 成功触达=否', async () => {
    (writeRecord as any).mockResolvedValue({ record_id: 'rec_dm' });
    await writeDmOutreachStatus({
      tenant_id: tenantId,
      table_id_leads: tableIdLeads,
      profile_url: dmProfile,
      account_label: '装修小号1',
      dm_status: 'failed',
      error_code: 'SESSION_EXPIRED',
    });
    const fields = (writeRecord as any).mock.calls[0][2];
    expect(fields['成功触达']).toBe('否');
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run tests/p2-sprint-b1-ws4/lead-writer.test.ts`
Expected: 新增 3 项 FAIL（`fields['成功触达']` 是 `undefined`）

- [ ] **Step 3: 实现映射**

在 `apps/api/src/services/lead-writer.ts` 里，把：

```ts
export type DmStatus = 'sent' | 'limited' | 'failed';

const DM_STATUS_TO_FEISHU: Record<DmStatus, string> = {
  sent: '已私信',
  limited: '未送达-仅互关',
  failed: '失败',
};
```

改成：

```ts
export type DmStatus = 'sent' | 'limited' | 'failed';

const DM_STATUS_TO_FEISHU: Record<DmStatus, string> = {
  sent: '已私信',
  limited: '未送达-仅互关',
  failed: '失败',
};

// 0919: 「成功触达」是真实送达的强判定字段，limited/failed 一律写"否"（禁止假"是"）。
const DM_STATUS_TO_SUCCESS: Record<DmStatus, '是' | '否'> = {
  sent: '是',
  limited: '否',
  failed: '否',
};
```

再把 `writeDmOutreachStatus` 里的 `fields` 对象：

```ts
  const fields: Record<string, unknown> = {
    触达状态: DM_STATUS_TO_FEISHU[dm_status] ?? '失败',
    '触达主页 URL': profile_url,
    触达时间: now,
    触达小号: account_label,
    失败原因: dm_status === 'failed' ? error_code || '' : '',
  };
```

改成：

```ts
  const fields: Record<string, unknown> = {
    触达状态: DM_STATUS_TO_FEISHU[dm_status] ?? '失败',
    成功触达: DM_STATUS_TO_SUCCESS[dm_status] ?? '否',
    '触达主页 URL': profile_url,
    触达时间: now,
    触达小号: account_label,
    失败原因: dm_status === 'failed' ? error_code || '' : '',
  };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx vitest run tests/p2-sprint-b1-ws4/lead-writer.test.ts`
Expected: 全部 PASS（含原有 4 项 + 新增 3 项）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/lead-writer.ts \
        apps/api/tests/p2-sprint-b1-ws4/lead-writer.test.ts
git commit -m "feat(leadgen): Path2 触达状态映射到成功触达字段(limited/failed禁止假是)"
```

---

### Task 12: 全量回归 + 收尾

**Files:** 无新改动，仅验证

- [ ] **Step 1: 跑 phone-adb-controller 全部单测**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 全部 PASS（own-accounts-lib / lead-fields-lib / next-outreach-lib 三个文件）

- [ ] **Step 2: 跑 apps/api 全部单测**

Run: `cd apps/api && npx vitest run`
Expected: 全部 PASS，无因本次改动引入的失败

- [ ] **Step 3: 跑 CI 里同款 openclaw glob 命令，确认与 CI 行为一致**

Run: `node --test scripts/openclaw/**/*.test.js services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 全部 PASS

- [ ] **Step 4: 逐文件 grep 确认旧字段名在 LEADS 表写入路径里已清零**

Run: `grep -n '"抖音昵称/主页链接"\|"命中关键词"' services/phone-adb-controller/push-leads.js services/phone-adb-controller/sort-comments.js services/phone-adb-controller/next-outreach.js services/phone-adb-controller/next-outreach-lib.js services/phone-adb-controller/update-profile-links.js`
Expected: 无输出（0 命中）

- [ ] **Step 5: 最终提交（若前面步骤有遗留未提交的验证性改动）**

```bash
git status --short
```
Expected: working tree clean（所有改动已在前面任务逐一提交）
