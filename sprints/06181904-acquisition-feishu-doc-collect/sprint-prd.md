# Sprint PRD — 客户智能获客：飞书企业信息文档 + 扩词提取 + 中台采集闭环（Path2 Step4）

## OKR 对齐

- **对应 KR**：Line 02 客户智能获客路径（afa6abca）— 推进 Golden Path Step 4「画像+扩词+采集闭环」
- **当前进度**：Step1-3（注册/Agent/绑飞书建表）✅ · Step5（绑抖音小号）✅ · Step4 未起
- **本次推进预期**：Step4 从 🔴 推到 ✅（飞书企业信息文档 → 扩词 → 派单采集 → 去重落库 → 写飞书 → 获客页可见）

## 背景

主理人需要不开抖音就能拿到一批潜在客户的抖音号。本 sprint 让主理人在飞书写一篇「企业信息」文档，中台点一下"采集"，系统据文档扩词、派客户机 Agent 真搜真抓评论区抖音号，去重落库并同步飞书、获客页可见。租户隔离为已命中铁律。

## Golden Path（核心场景）

主理人在飞书写好企业信息 → 中台获客页点"采集" → 一段时间后获客页多出一批抖音号（可点进主页），同步进飞书 Leads。

具体：

0. 绑飞书时系统自动建「企业信息」飞书文档(docx)，存 `doc_token`；主理人在飞书自由编辑（行业/受众/卖点/钩子/关键词种子，叙述式）。
1. 主理人在中台获客页点"采集"：
   - 前置校验：未绑飞书 / 无企业信息文档 → 拦截，提示先去绑+填文档。
   - 读文档全文 → 提取纯文本；全图片/表格/字数不足阈值 → 当"空"拦截，提示文档需有文字。
   - DeepSeek 据文档扩出 **3 个搜索关键词**（可手输覆盖，手输优先完全替代 AI 词）。
   - 待确认态显示词 + 来源(ai/manual)；主理人确认后派单，返回 `task_id`。
   - 失败兜底：DeepSeek 超时/限流/401 → 有限重试 → 仍失败用文档关键词种子兜底 + 页面标"降级"。
2. 派单 → 客户机 Agent 拉起本地抖音 Chrome：每个词搜 **7 条近期(≤7天)爆款视频**，进评论区拟人滚动（随机间隔 + 偶尔滑屏）把评论者抖音号全部抓完（连续无新增=抓完）。
   - 记进度位点（第几词/第几视频/滚动位置）→ 崩溃重启**断点续抓**不重来。
   - 中台**取消按钮** → task `cancelling` → `cancelled`，已抓的先落库不丢。
   - 视频不足7条/评论区关闭/0评论 → 记0产出+原因，跳下一条，计 `partial`。
   - 失败兜底：Agent 离线 → 留 `pending` 不丢；抖音未登录/验证码/风控 → `failed` 并区分原因，已抓先落库。
3. 增量回报 → 落中台 DB(SSOT)：按 `(tenant_id, sec_uid)` 去重，重复仅累加来源 `video_id`。
   - sec_uid 解析不出 → 用昵称兜底入库，标"残缺/待核"，按昵称弱去重，主页链接置空。
4. DB 写成功 → 写飞书 Leads 表 → 获客页刷新看到抖音号。
   - 失败兜底：飞书 token 失效 → app 凭据自动刷新重试；表被删/建表失败 → 已抓留 DB 标"待补写飞书" + 提示去绑定页一键重建；采集成功 ≠ 飞书写成功。
5. 主理人在获客页看到：任务状态（pending/running/cancelling/cancelled/done/partial/failed 共7态）+ 计数（几视频/几抖音号/去重前后）+ 失败原因；抖音号可点击跳主页 `https://www.douyin.com/user/<sec_uid>`（残缺号无链接）；整体超时(10min)兜底自动转 failed/partial，不假死在 running。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- 文档全图片/表格/字数不足 → 当空拦截。
- DeepSeek 降级 → 用关键词种子兜底，页面标注。
- Agent 离线 → task pending 不丢；抖音风控/验证码 → failed 区分原因。
- sec_uid 缺失 → 昵称兜底、标残缺、无主页链接、按昵称弱去重。
- 飞书写失败 → 不算采集失败，标"待补写飞书"。
- 整体超时 10min → 自动转终态，不假死。
- 双租户：企业信息文档/采集任务/leads/去重全 scope 到租户，互不串。

## 范围限定

**在范围内**：绑飞书自动建企业信息文档；扩词读文档全文 LLM 提取（可手输覆盖）；中台获客页采集入口；派单→Agent 真搜真抓→去重落 DB(SSOT)→写飞书 Leads→刷新；断点续抓 + 取消按钮；任务状态/计数/失败原因可见；抖音号可点跳主页。

**不在范围内**（加厚再做）：自动调度采集、5 小号矩阵、跨任务去重、飞书行级失败自动补写、发消息触达（公开回评/私信）。

## 假设

- [ASSUMPTION: 飞书 docx 建/读权限已开通（app cli_a937a808ca395bd6 已亲测 code:0）]
- [ASSUMPTION: DeepSeek 走 ~/.credentials/openrouter.env，本机实测可扩词]
- [ASSUMPTION: 真机手验在 xian-pc（抖音 Chrome CDP 19222 在跑）]
- [ASSUMPTION: 文档"空"判定阈值为纯文本字数下限，具体值 Proposer 阶段定]

## 预期受影响文件

- `apps/dashboard/`：获客页采集入口 + 状态/计数/失败原因展示 + 抖音号跳主页
- `apps/api/` 或后端服务：采集任务端点（建任务/扩词/取消/查询）、去重落库、写飞书 Leads
- 飞书集成模块：建/读企业信息 docx、写 Leads 表、token 刷新
- 客户机 Agent 协议：派单搜视频 + 抓评论 + 断点续抓 + 增量回报
- DB migration：采集任务表（7态状态机）、leads 表（tenant_id + sec_uid 去重 + 残缺标记）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（空），PrepPRD 显式值优先 -->
- 参数：3 词 · 每词 7 条爆款视频(≤7天) · 评论全抓(滚到不再加载) · 抖音号无落库上限 · 单抖音号每天 ≤3 次采集
- 拟人节流：随机间隔 + 偶尔滑屏
- 超时：整体 10min 兜底转终态
- 去重：(tenant_id, sec_uid)，缺失用昵称弱去重
- 可观测/安全：租户隔离全链 scope；飞书 token / 客户隐私不进日志；新 API 端点鉴权

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment（windows_cloud）产出，写进 contract-draft.md。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本
# 期望验收点（自然语言）：
# 1) 自动 E2E（CI，fake-agent + fake-飞书）：建/读企业信息文档 → 扩 3 词 + task_id → 派单
#    → fake-agent 回报抖音号(含一条 sec_uid 缺失走昵称兜底案例) → 去重落 DB → 写 leads → 获客页刷新可见
# 2) 断点续抓 1 条断言 + 取消 1 条断言
# 3) 双租户互不串断言（企业信息文档 / 任务 / leads 各一）
# 4) 任务状态机(7态) + 计数 + error_code + 残缺标记 可见
# 5) 真机手验(xian-pc，证据附 sprint)：真抖音 Chrome 真搜 7 视频/词 + 评论全抓截图；抖音号可点进主页
```

## journey_type: user_facing
## journey_type_reason: 核心交付在 apps/dashboard/ 获客页（采集入口+状态展示+抖音号跳主页），命中优先级链第一条
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 任何 UI 走 windows_cloud 死规则，PrepPRD 已拍板（GitHub Actions windows-latest）
## journey_id: afa6abca
## step_id: L02-S4
