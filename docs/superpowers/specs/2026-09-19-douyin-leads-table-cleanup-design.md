# 设计：抖音获客线索表字段收敛 + 自有账号/视频去重 + 成功触达真实校验

## 背景

金诺租户抖音获客线索表（base `GNuwbzY0da8GP0sv6MGcOTu9ntd`，table `tblTLFj69CflUqSr`）经过多轮迭代后字段冗余、命名混乱；采集链路缺少自有账号/视频去重；触达状态只反映"是否执行了发送动作"，不反映"是否真正送达"。本次收敛字段并补齐三处逻辑缺口。范围仅限金诺租户，悦升租户表结构独立，不动。

## 现状结构（三条写表路径 + 一条触达路径）

```
harvest-keyword.sh（真机采集，输出 LEAD/VIDEO 行）
        │
        ├─→ push-leads.js（KPI 夜直写，读 TSV → 写线索表）
        │
        └─→ 评论池表 → sort-comments.js write（异步判定 agent → 池 → 线索表）

线索表 ←── next-outreach.js（选单，读「抖音昵称/主页链接」解析昵称/抖音号/主页链接）
        │
        └─→ outreach-tick.sh（真机 ADB 路线，douyin-phone-adb private-message-send）
        └─→ services/agent douyin-dm-outreach.ts（Path 2 Chrome CDP 路线，已有 sent/limited/failed 三态）
```

**关键耦合**：`push-leads.js` 和 `sort-comments.js` 都写「抖音昵称/主页链接」合并字段；`next-outreach.js` 依赖这个合并字段解析出昵称/抖音号/主页链接（`next-outreach-lib.js` 的 `extractLead`/`classifyPending`）。删除合并字段前必须先把 `next-outreach.js` 改成直接读独立字段，否则触达选单器会读到 undefined 直接瘫。

## 范围边界（重要）

「成功触达」判定的两条链路成熟度不同：
- **Path 2（Chrome CDP，`services/agent/src/handlers/douyin-dm-outreach.ts`）**：已经有 `sent`/`limited`/`failed` 三态，`limited` 就是"点私信按钮不可点=仅互关受限"——这正是用户说的"对方未加你为好友"信号，逻辑已经对，只需要把这个状态映射写进新增的「成功触达」字段。
- **老链路（真机 ADB，`douyin-phone-adb` 二进制）**：该二进制不在 zenithjoy-workspace 仓库里（实测本机 `~/.local/bin/douyin-phone-adb` 不存在，源码在 `openclaw-migration` 之类的独立仓库/真机上），`private-message-send` 目前只吐 `send_status=sent` 或失败态，没有"对方未加好友"这一级判定。**在本仓库范围内改不了这个二进制**。本 PR 对老链路只做补丁级处理：把 `private-message-send` 的原始输出透传进「回复结果」备注，供人工核查；真正的设备侧探测需要另开一个 openclaw 仓库的任务，本次 PrepPRD 补一条"不包含"说明，向用户报告时明确讲清楚。

## 改动设计

### 1. 字段收敛（数据层）

| 文件 | 改动 |
|---|---|
| `push-leads.js` | 不再写「抖音昵称/主页链接」「命中关键词」；「评论原文」→「原始评论」；新增「评论作品视频链接」=vurl（原来拼进「来源视频」的链接部分拆出）；dedup 的 `seen` 集合改为读「客户昵称」+「抖音号」两个独立字段构建（不再解析合并字段） |
| `sort-comments.js`（write 模式）| 同上：去掉「抖音昵称/主页链接」双写、「命中关键词」；「评论原文」→「原始评论」；新增「评论作品视频链接」；dedup `seen` Map 改为读「昵称」+「抖音号」独立字段；「昵称」字段改名为「客户昵称」 |
| `next-outreach.js` + `next-outreach-lib.js` | `extractLead`/`classifyPending` 改成直接消费记录的「客户昵称」「抖音号」「主页链接」三个字段，不再解析合并字符串；`isValidDyid`/URL 校验逻辑不变，只是输入源换掉 |
| 飞书视图 | 「业务线」字段设为视图隐藏（一次性飞书 Bitable API 调用，不在代码仓库改动范围，随 PR 一起在部署脚本或 handoff 里记录操作步骤） |

**顺序要求**（先减肥后增肌反过来：这里是先把读方切到新字段，再删写方的旧字段，避免中间态选单器读空值）：
1. 先改 `next-outreach.js`/`next-outreach-lib.js` 读独立字段
2. 再改 `push-leads.js`/`sort-comments.js` 停写合并字段
3. 两次改动在同一个 PR 里，但保证 commit 顺序或至少测试覆盖"读方兼容新字段"在先

### 2. 采集侧判定（harvest-keyword.sh）

新增配置文件 `services/phone-adb-controller/config/own-accounts.json`：
```json
{ "nicknames": ["躺赢AI学姐", "人工智能小诺考评"], "ids": ["langzi63485", "44997267357"] }
```
（初始值收敛现有 `next-outreach.js` 硬编码的两个小号，用户后续可自行增补）

`harvest-keyword.sh` 改动点：
- 每条评论身份验证拿到 `ONICK`/`OID` 后，查 own-accounts 名单，命中则 `continue`（跳过此条线索，不再做后续 card-link 探测，日志打印"跳过自有账号"）。
- 若某条评论 `AUTHOR == "author"` 且其 `NICK` 命中 own-accounts 名单 → 判定整条视频为自有账号发布，`continue` 跳出该视频的评论采集循环（不只是跳过这一条评论）。
- 视频级去重：脚本启动时，先用飞书 API 拉一次「视频池」表（`tblKHYTMZceFBwHr`）已存在的 VID 集合（复用 push-leads.js 里 `seen` 构建 pattern，写成 shell 内联 curl+jq 或调用一个小的 node 一次性脚本）；对每张卡片算出 `VID` 后，命中已处理集合 → 打日志"视频已处理,跳过" → back 回到列表 → 处理下一张卡片，不进入评论采集。

### 3. 触达真实性（成功触达字段）

线索表新增字段「成功触达」（单选：是/否/待确认）。

- **Path 2**：`services/agent/src/handlers/douyin-dm-outreach.ts` 已产出 `DmStatus`；在负责回写飞书的 `apps/api/src/services/lead-writer.ts` 里补一条映射：`sent→是`，`limited/failed→否`，写入「成功触达」字段（与既有「触达状态」字段并存，不冲突）。
- **老链路**：`outreach-tick.sh` 里 `mark "$RID" sent "ok"` 分支时，「成功触达」写"待确认"（不写"是"，避免误报）；`next-outreach.js` 的 `done sent` 分支相应把「成功触达」置为"待确认"而不是直接标真。同时把 `$OUT`（`private-message-send` 原始输出）完整片段写入「回复结果」备注，供人工核实/后续接入设备侧判定用。

## 测试策略

- **单元测试**（trivial/unit，CI 覆盖）：
  - `next-outreach-lib.test.js`：`extractLead`/`classifyPending` 改造后基于字段对象输入的用例（缺主页链接/缺抖音号/正常三态）
  - 自有账号名单匹配的纯函数（抽出一个 `isOwnAccount(nick, id, config)` 辅助函数，独立单测覆盖命中/不命中/大小写等边界）
  - 视频去重集合命中判断的纯函数
  - `mapDmStatusToFeishu` 已有测试基础上，补「成功触达」映射函数的单测
- **集成/regression test**：
  - push-leads.js / sort-comments.js 写入的 fields 对象快照测试（mock fetch，断言不再包含旧字段 key，包含新字段 key）
  - next-outreach.js 选单逻辑用 mock 记录（只有独立字段，没有合并字段）跑通选单，验证不再因合并字段缺失而 crash
- **真机验证**（不进自动 CI，PR 描述里记录人工验证步骤）：
  - 找一条已知会命中 own-accounts 名单的评论/视频，跑一次 harvest-keyword.sh，确认日志打印"跳过自有账号"且未产生新线索行（proven-to-fire：故意让它命中一次，亲眼看到跳过）
  - Path 2 对一个仅互关受限的账号发起触达，确认「成功触达」写"否"

## 不包含

- 悦升租户表结构改动（用户后续单独说明）
- 「对标账号」过滤（用户明确不需要）
- 老链路（真机 ADB）"对方未加好友"的设备侧真实探测——依赖 `douyin-phone-adb` 二进制改动，不在本仓库范围，本次只做"待确认"降级 + 原始输出透传，留痕待后续在对应仓库补
- 飞书表历史行的旧字段清洗/回填
