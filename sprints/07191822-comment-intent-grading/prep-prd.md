# PrepPRD：Path 2 客户智能获客 — 评论区留言 AI 意向分档判定（补齐 Seg3→Seg4 缺失环节）

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：新增"第二个 AI 判定"——对评论区留言做意向分档（高意向/精准/感兴趣/其他），驱动 Seg4 私信派单真实触发；顺带把 Seg2 音频判定的转写文案落库，供分档判定使用完整"视频文案"
- [ ] 另立 Sprint（本次不做）：CI 两道机制性闸门（decision 5c570680）
- [ ] 待讨论：无

## 症状 / 背景

2026-07-19 真机端到端验证音频判定修复（PR #1404/#1407/#1408）时，用户要求把 Seg1→Seg4 全链路走真实客户路径验证到底。验证发现：Seg1(采集)/Seg2(视频判定)/Seg3(抓评论建Lead) 全部真实工作，但 Seg4(私信派单) 从未真实触发过一次发送。

排查根因：`acquisition_leads`/`acquisition_lead_comments.grade` 字段决定 `outreach_eligible`（`rescoreLead()` 里 `computeRelevanceScore()` 用 `grade` 算分，只有"精准"/"高意向"两档才 `outreach_eligible=true`），但 `grade` 从来没有被任何地方真正赋值过——服务端 `/collect/report` 路由只是把客户端传来的 `c.grade` 原样存（`c.grade ?? null`），而安卓端 `CollectReporter`/`CommentEntry.toCollectReportMap()` 上报评论时**从未携带 grade 字段**（数据结构里压根没这个字段）。也没有任何服务端 AI 调用去产生这个值。

用户确认这不是"没设计"，而是"设计里有这一步（打分公式已经写好等着吃 grade），但产生 grade 的 AI 判定环节从未实现"——相当于房子盖了一半，判定"大脑"没接上。

## 用户确认的正确 Golden Path（本次要补的环节标 ⭐）

1. Seg1：Agent 无障碍抓取对标视频 → 存 `acquisition_collect_videos`
2. Seg2：第一个 AI（Gemini，读音频转写+标题）判定视频是否匹配目标客户画像 → matched 才继续
3. Seg3：抓该视频评论区留言 → 存 `acquisition_leads` / `acquisition_lead_comments`
4. **⭐ 本次新增：第二个 AI（同样 Gemini）读"视频标题+转写文案+这条留言"，判定留言者的购买意向档位（高意向/精准/感兴趣/其他）**
5. Seg4：档位达到"精准"或"高意向"的才真正私信送达

## 已与用户拍板的设计决策

1. **调用粒度**：一个视频的评论**批量打包成 1 次 Gemini 调用**（不逐条调），在 `/collect/report` 处理 `commenters` 数组时统一判定
2. **判定依据**：不只用标题，**顺带把 Seg2 那次 Gemini 判定时内部转写出来的文案也落库**（新增 `acquisition_collect_videos.transcript` 列），让 Seg4 判定时能拿到"标题+完整转写文案+留言"，而不只是"标题+留言"
3. **档位复用现有公式**：沿用 `acquisition-dispatch.ts` 里已经写好的"高意向/精准/感兴趣/其他"四档（`gradeWeight()`），把 grade 写进已存在的 `acquisition_lead_comments.grade` 列（不新建列）
4. **失败兜底**：AI 判定超时/失败 → grade 留空（null），不阻塞 `/collect/report` 主流程，不重试

## 关联上下文
- 相关 PR：#1404/#1407/#1408（今天的音频判定修复三部曲，本次是其真机验证发现的第4个缺口，也是最大的一个）
- 相关历史决策：judgment 8dbe91ee 类似的"字段有但没接线"模式；今天新增 decision（本次即将写入）
- Brain issues/decisions 查询：无匹配的既有记录（新发现）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 评论意向分档 | (a)服务端启发式规则 (b)Gemini单次多模态/文本调用 (c)让Android端调用 | (b) 服务端批量文本调用 Gemini | 与 Seg2 判定同一套通道，架构一致；批量降低成本；服务端调用避免 API Key 下发到客户端 | 误判"高意向"→ 真实私信打扰无关用户（比 Seg2 误判"matched"后果更重，Seg2 错了只是多截了一段视频/评论，这里错了是真发消息给陌生人）；误判"其他"→ 漏掉真实客户。两种误判都不可逆但方向不同：本次采纳保守策略——解析失败/无法判断时一律归入"其他"（不触发私信），宁可漏，不可误扰 |
| Gemini 判定失败兜底 | (a)重试 (b)标pending等下次 (c)留空不阻塞 | (c) grade 留空，不阻塞 `/collect/report` 主流程 | 与 Seg2 `markPending` 思路一致：判定失败不能拖垮采集主链路 | 本条 lead 这次判定失败会被归入默认最低档（不触发私信），下次同一 lead 又有新评论时会重新走 `rescoreLead` 有机会再评一次 |

## 前置工作核对

- [x] TOAPIS_API_KEY / Gemini 调用通道：已就绪（Seg2 判定复用同一个 `TOAPIS_BASE`/`TOAPIS_API_KEY`，今天真机验证已实测调用成功）
- [x] 测试账号/租户：本次改动是服务端纯逻辑+一次 Gemini 调用，走既有 vitest mock 模式（`vi.mock('axios')`），不需要额外账号
- [x] 数据库迁移能力：已验证过（今天 apps/api/db/migrations/run-migration.ts 流程正常）

## 涉及的 Ability / Feature
- Path2「评论区挖客闭环」（Seg3→Seg4 之间补一环，属于已有 Ability 内部加厚，不是新 Ability）

## 不包含
- 不改 Android 端代码（`grade` 字段服务端从不依赖客户端传值，Android 侧无需改动）
- 不做 per-comment 独立 Gemini 调用（按拍板走批量）
- 不建新的 grade 相关列（复用 `acquisition_lead_comments.grade`）
- 不做 CI 机制性闸门（另立 decision 5c570680）

## 验收标准（Final E2E）
- [ ] 新集成测试：`/collect/report` 上报一批含明显高意向文案的评论（如"预算10万求推荐"）→ 断言对应 `acquisition_lead_comments.grade` 被写成"精准"或"高意向"（mock Gemini 返回），且 `acquisition_leads.outreach_eligible` 变 true
- [ ] Seg2 单测：audio 判定 matched 时，`acquisition_collect_videos.transcript` 列被写入非空转写文本
- [ ] apps/api 全量单测 + 集成测试无回归
- [ ] CI 全绿
- [ ] （尽力而为，不阻塞 CI）真机重新触发一轮采集，观察这次 grade 是否真的不再恒为 null；如果真凑出一条"精准/高意向"，顺带验证 Seg4 是否真实发出私信
