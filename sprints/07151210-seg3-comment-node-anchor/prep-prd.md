# Bug PrepPRD：抓评论恒走启发式 fallback → lead 全是界面碎片（Seg3）

Brain task: `964e94d1-ae50-4c7f-9a21-670c4104a49a`
base_repo: https://github.com/perfectuser21/zenithjoy-workspace
Path 2「客户智能获客」Seg3（golden path 四段：采集 → 判定 → 抓评论 → 私信）

## 症状

抓评论产出的 lead 全是界面碎片，不是真评论人：
`插座面板` / `2.8万` / `7889条评论` / `· 05月26日` / `评论 94` / `购物` / `161` /
`视频同款及更多好物在橱窗里 详情`。偶有真的（`小叶子` / `你这个地上铺的是复合地板吗`）。

**全表 22 条 lead：sec_uid 有值 0 条、partial=false 0 条** → 私信段 `total=0`，链路闭不了环。

## 根因（真机 dump 实证，非推测）

`NodeExtractor.kt` 的 `extractByResourceId` 昵称候选集：

```kotlin
val nicknameIds = setOf("tv_username", "tv_user_name", "comment_user_name", "nick_name")
```

**真机上的 id 是 `title`** —— 一个都不在里面。于是：

1. `extractByResourceId` **恒返回空列表**
2. `extractComments` 无条件掉进 `extractByStructure` 启发式
3. 该启发式是**全树无差别相邻文本配对** —— 商品卡（`购物`/`客厅多层花架`/`已售200+`）、
   tab 栏（`评论 94`/`商品评价 43`）与真评论在同一个扁平列表里，照样配成 lead

**在真实 dump 上跑两个函数验证**：
```
extractByResourceId → []                 ← 恒空，坐实
extractByStructure  → 5 条：2 真 3 垃圾   ← 与库里现象同型
```

> `NodeExtractor.kt` 注释里白纸黑字写着「resourceId 候选值未经真机验证……上线前必须用真机
> uiautomator dump 核实实际 id」——**这一步从来没做过**。

**#1303 为什么没修好**：它只把遍历 BFS→DFS（`NodeTreeFlattener`），让**错误路径**上的相邻配对更准
（所以偶尔蹦出真评论），但它改良的是那条**根本不该走的 fallback**。真 bug 是「id 猜错 → 主路径恒空
→ 静默 fallback 成为唯一路径」。**静默 fallback 就是骗了两天的机制。**

## 真机节点树（fixture 已入库）

`services/agent-android/app/src/test/resources/fixtures/douyin-comment-panel-20260715.xml`（235 节点）

| 字段 | 节点 | 备注 |
|---|---|---|
| 昵称 | `…:id/title` (TextView) | 稳定 |
| 正文 | `…:id/content` (TextView) | 稳定 |
| 头像 | `…:id/avatar` clickable=true，desc=`<昵称>的头像` | 昵称第二来源 |
| 作者标记 | `…:id/eyo` text=`作者` | 剔除博主置顶广告评论 |

⚠️ **容器 id 不固定**：`fgd`/`k4x` 会互换嵌套（楼中楼反过来）→ **不能靠容器 id 认评论**，
必须靠 `avatar + title + content` 三元组锚定。

## sec_uid：UIA 树里不存在（实证）

全 dump 235 节点 `MS4w`（sec_uid 特征串）**零命中**；无任何 `uid|sec|user|profile` 相关 resource-id。
sec_uid 是接口层数据，抖音不渲染进无障碍节点。**「从节点树取 sec_uid」这条路是死的。**

链路承重关系：`profileUrlForSecUid()` 把 `profile_url` **完全派生自 sec_uid** → 无 sec_uid →
`partial=true, profile_url=null` → `acquisition-dispatch.ts:496` 派单 SELECT 取 `profile_url` →
全 null → 私信无可派。

## 修法

| # | 改动 | 依据 |
|---|---|---|
| 1 | **按结构锚定**：以 clickable 的 `avatar` 节点为评论 item 锚点，在其**同父兄弟**里取 `title`(昵称)+`content`(正文) | 三者都有稳定 resource-id；容器 id 不可靠 |
| 2 | **扔掉 `extractByStructure` 静默 fallback**：id 命中不到 → 报 `COMMENT_NODES_NOT_FOUND` 硬失败 | 静默 fallback 是垃圾的唯一来源，也是骗过两天的机制 |
| 3 | 同 item 内有 `eyo` text=`作者` → 跳过 | 博主置顶广告评论 = 「视频同款及更多好物在橱窗里 详情」的来源 |
| 4 | **昵称派单**（用户拍板方案 A）：让 `profile_url` 在无 sec_uid 时可回退成昵称 | `locateProfileBySearch(targetDouyinId)` 本来就是拿字符串**去搜索框搜**，不解析 URL |
| 5 | **补守卫缺口**：#1305 的 `sec_uid_coverage` 算了却不进 `passed`，smoke 只打印不卡 → 让它成为硬闸（方案 A 下改判为「profile_url 覆盖率」） | 不补则「碎片清干净但 sec_uid 全空」会放行 = 又一次表面通内里坏 |
| 6 | **bump AGENT_VERSION** | #1303 改了 agent 没 bump（2.1.13 是 #1296 定的），设备上报版本分不清哪个包，违反 `feedback_agent_version_bump` |

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|---|---|---|---|---|
| ⚠️ 私信如何定位到真人（sec_uid 取不到） | A.昵称派单（`locateProfileBySearch` 搜索框搜） B.点头像进主页→分享面板解析 sec_uid C.抓包/hook 接口层 | **A（用户 2026-07-15 拍板）** | UIA 树实证无 sec_uid（`MS4w` 零命中）；`locateProfileBySearch` 本就按字符串搜索，非解析 URL；A 成本最低且能先让链路闭环拿到真实失败率。B 需每条 lead 多 2 次跳转+分享面板（风控↑，且 Seg1 分享面板有 panel-miss 历史 #1294），且「主页分享链接里是否含 sec_uid」**未经验证**，不可当地基；C 需 root/frida，封号风险最大 | 昵称重名 → 私信发错人。缓解：`locateProfileBySearch` 已有 `AMBIGUOUS/NO_MATCH` 分支会拒发（安全但命中率打折） |
| 一个节点是否属于「一条真评论」 | A.容器 resource-id B.全树相邻文本配对（现状） C.avatar+title+content 三元组同父锚定 | **C** | 真机 dump 实证容器 id 会互换嵌套（`fgd`/`k4x`），A 不可靠；B 是现状且正是垃圾来源 | 误判→抓到界面碎片当 lead（现状），或漏掉真评论 |

## Regression Test 计划（真机 fixture 是地基）

1. **`NodeExtractorTest` 喂真机 dump fixture**：断言输出**恰好 2 条**（`小叶子` / `LENTER心疼姑舅`），
   且**不含** `已售200+` / `作者` / `购物` / `评论 94` / `客厅多层花架`
2. **id 猜错必须报错不静默**：构造一个不含 `title`/`content` 的树 → 断言抛 `COMMENT_NODES_NOT_FOUND`，
   而**不是**返回启发式结果
3. 回流 `golden-path-2-smoke.sh`：断言 lead 表无「纯数字 / 含『已售』/ 含『条评论』」的 nickname

> **手编 NodeInfo 列表的 unit test 挡不住 id 猜错这类 bug——#1303 就是这么假通过的。**
> 必须用真机 dump 当 fixture，这是唯一能挡住「以为修好了」的机械闸（对应铁律 5 精神）。

## proven-to-fire（每条守卫都要亲眼见红）

- 把 `nicknameIds` 改回不含 `title` → fixture 测试**必须报红**
- 把 `extractByStructure` fallback 加回去 → 「id 猜错必须报错」测试**必须报红**
- 把 `sec_uid_coverage` 从 `passed` 拿掉 → 质量闸测试**必须报红**

## 验收标准

- [ ] failing test 先 commit（commit-1，真机 fixture）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 三条守卫都亲眼见红过一次
- [ ] AGENT_VERSION 已 bump
- [ ] CI 全绿
- [ ] （下一刀）真机重跑 Seg3 → lead 表出现 sec_uid 或 profile_url 非空的真评论人

## 不包含

- 方案 B（点头像进主页取 sec_uid）：落地前必须先真机验「主页分享链接里到底有没有 sec_uid」，
  这一格目前是空的，不拿假设当地基
- 判定段 stage_2 没触发（Seg2 的另一个 bug，handoff 列为 bug 2，另刀）
