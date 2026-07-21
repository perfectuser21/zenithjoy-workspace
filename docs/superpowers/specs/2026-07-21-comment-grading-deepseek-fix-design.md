# 评论意向判定（留言分析）grade 全空修复 + 判定引擎换 DeepSeek

## 背景 / 问题

Path2 智能获客真机测试（tenant `6dbea700-1954-45ee-8fa5-7a6d54170bc6`，装修行业获客画像，07-18~07-19）抓到 22 条评论线索，`relevance_score` 有真实计算值，但 `grade`（意向分级）全部为空、`outreach_eligible` 全部为 false，派送一条未发。

排查确认两条独立根因，同一外部症状：

1. **已被 PR #1416（2026-07-19 20:07 北京时间合并）修复**：Gemini 中文回复常用全角标点（。/、），旧解析正则只认半角句号，导致真实数据整批解析失败返回 null（decision 26d518fc）。上述 22 条数据的采集时间窗口（07-18 16:00~07-19 05:06）早于修复合并时间，是历史脏数据，永久卡在 null，没有 backfill 机制。
2. **仍然存在**：`comment-grading.ts::gradeComments()` 在画像（`target_profile_desc`）为空时静默返回全 null——这是三个失败分支（TOAPIS_API_KEY 未配置 / 调用失败 / 画像为空）里唯一没有日志的一个。2026-07-20~07-21 最新一次真机测试（staging tenant `68f2ee9f-2461-4e17-bd01-6538b51461c4`）再次撞上这个分支：该租户 `acquisition_config` 表 0 行，采集照常跑完，用户看到的表现和真正的系统故障一模一样，无法自助定位。

用户追加需求：判定引擎从 Gemini（`gemini-2.5-flash-official`，经 ToAPIs）换成 DeepSeek（同样经 ToAPIs，不引入 OpenRouter），降低成本——仓库里 `wechat-draft.ts` 已有等价先例：`model: 'deepseek-v4-flash'`，`baseUrl: 'https://toapis.com/v1/chat/completions'`。

## 架构

不新增服务/组件。改动集中在三个已有文件 + 一个一次性脚本：

- `apps/api/src/services/comment-grading.ts` — 判定引擎
- `apps/api/src/routes/acquisition.ts` — `/collect/report` 调用点、`PATCH /config`
- `apps/api/src/services/acquisition-dispatch.ts` — `rescoreLead()`
- `apps/api/scripts/backfill-null-grade-leads.ts`（新增，一次性，不进 CI 常驻）

## 组件改动

### 1. comment-grading.ts：换模型，不换通道

- `GRADING_MODEL` 常量从 `'gemini-2.5-flash-official'` 改为 `'deepseek-v4-flash'`
- 其余 axios + `TOAPIS_BASE`(`https://toapis.com/v1`) + `TOAPIS_API_KEY` + `GRADING_TIMEOUT_MS`(20s) 全部不动——继续复用已验证可用的 ToAPIs 通道，不引入 `openrouter.ts`/OpenRouter 依赖
- 更新文件头注释（原文写"Gemini 调用"，需改为准确描述当前模型）
- "画像为空"分支补一条 `console.warn('[comment-grading] target_profile_desc 为空，跳过判定')`，与另外两个失败分支（TOAPIS_API_KEY 未配置 / 调用失败）保持日志对称

### 2. parseGrades 正则兼容性验证

现有正则 `^\s*(\d+)[.。、]\s*(高意向|精准|感兴趣|其他)` 是专门针对 Gemini 全角标点习惯写的。DeepSeek 的输出风格未必相同（可能用 `1)`、`1:`、加粗序号等）。这条风险与换成哪个 LLM 无关，只跟"模型变了"有关：

- 换模型后先在 staging 用真实评论数据跑一次，核对 `parseGrades` 解析成功率
- 解析失败率过高（发生在 `matched < count` 分支，会打印 warn 日志）则视情况扩展正则；解析不出来时行为保持"归 null"（保守，不会误判高意向，业务上是漏判不是误判，安全边界不变）

### 3. acquisition-dispatch.ts：rescoreLead 加锁 + 顶层 grade 回写

`rescoreLead()` 目前是"读 `acquisition_lead_comments` 全量 → 算聚合 → UPDATE `acquisition_leads`"，读写之间没有对该 lead 行加锁。不同 `collect_task` 并发调用 `/collect/report` 上报同一个 lead 的评论时，可能出现后完成的事务用旧快照覆盖先完成事务的结果。

修复：

- 开头对该 lead 行加 `SELECT ... FOR UPDATE`（复用已有事务 client），把"读评论 → 算聚合 → 写”整体纳入临界区
- 同一次 UPDATE 里把顶层 `acquisition_leads.grade` 字段也回写（当前只在新建 lead 时写一次，追加评论后从不更新，导致展示给用户的这一列长期陈旧/空白）

### 4. 一次性 backfill 脚本：不能无脑补

`acquisition_config` 只存当前值，没有历史时间戳/版本表，无法直接判断"某条历史评论被判定时画像是不是空的"。若不加保护，backfill 可能把当时确实没画像（本该是 null）的记录也补出"精准/高意向"，经 `rescoreLead` 自动把 `outreach_eligible` 置真，触发真实私信发给不该发的人。

安全边界：

- 只处理 `acquisition_lead_comments.commented_at` **晚于**该租户 `acquisition_config.updated_at`（画像首次非空的时间点）的记录
- backfill 产出的新 grade **不自动联动** `rescoreLead`/`outreach_eligible`/派发；脚本跑完打印候选名单，人工确认后再手动置 `outreach_eligible`（本次不建复核 UI，管理界面另立 sprint）

## 数据流（改动后）

```
Agent 上报评论 → POST /collect/report
  → gradeComments()（ToAPIs, deepseek-v4-flash）判定意向
  → BEGIN
    → INSERT/UPDATE acquisition_lead_comments
    → rescoreLead()（SELECT...FOR UPDATE 锁行 → 读全部评论 → 算 relevance_score/grade/outreach_eligible → UPDATE acquisition_leads）
  → COMMIT
  → buildAssignments()（按 outreach_eligible=true 建 dm_assignments 队列，逻辑不变）
```

## 错误处理

- DeepSeek/ToAPIs 调用超时（>20s）或失败 → 沿用现有保守设计：整批返回 null，不抛异常，不影响 `/collect/report` 主流程，打印 `console.error`
- 画像为空 → 同样返回全 null，现在补了 `console.warn`，可观测
- 解析不完整（`matched < count`）→ 已有 `console.warn` 打印原始响应前 500 字符，未解析出的槽位保持 null

## 不包含（本次范围外）

- 判定失败 / 采集任务失败 / backfill 派送复核的手动重试管理页面（用户已确认放到本次修复之后单独立 sprint）

## 测试策略

- **Unit（`comment-grading.test.ts`）**：
  - 画像为空 → 断言 `console.warn` 被调用一次，返回全 null（RED，当前行为无日志）
  - mock ToAPIs 响应验证 `GRADING_MODEL` 已切换为 `deepseek-v4-flash`
  - 全角/半角标点解析用例保持通过（不回归 PR #1416 的修复）
- **Unit（`acquisition-dispatch.test.ts` 或等价）**：
  - `rescoreLead` 并发调用两次（模拟两个 collect_task 同时上报同一 lead）→ 断言最终结果是"两次评论的合并聚合"而不是后完成覆盖先完成
  - 断言顶层 `acquisition_leads.grade` 字段在追加评论后被正确回写
- **Integration/真机（CI 测不到的接缝）**：
  - staging 真实触发一次采集，验证 DeepSeek 判定链路端到端跑通，评论被判出非 null 结果
  - backfill 脚本对 6dbea700 那 22 条历史数据跑一次（dry-run 先行），验证只有"画像已配置时间点之后"的记录被处理，且不自动触发派发

## 验收标准

- [ ] failing test 先 commit（画像为空分支现在没日志 → 红；并发覆盖测试 → 红）
- [ ] 修复代码变绿：模型切换 + 日志补齐 + `rescoreLead` 加锁 + 顶层 grade 回写
- [ ] backfill 脚本仅处理安全窗口内的记录，产出结果不自动联动 `outreach_eligible`
- [ ] CI 全绿
- [ ] staging 真机验证：新采集一批评论，DeepSeek 判定出非 null grade；高意向样本能正确让 `outreach_eligible` 变真
- [ ] backfill 跑一次苏彦卿那 22 条，人工确认至少几条被正确判出非"其他"档
