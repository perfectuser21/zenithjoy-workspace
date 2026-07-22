# Bug PrepPRD：留言分析（判定）在画像为空时静默不判，且历史数据/派送链存在连带风险

## 症状
苏彦卿（真机测试，装修行业获客画像，staging tenant `6dbea700-1954-45ee-8fa5-7a6d54170bc6`）填了基础信息后，评论抓到了（22 条 leads），relevance_score 有真实计算值，但没有留言分析（grade 全空）、也没有一条派送出去（outreach_eligible 全为 false）。

## 根因（两条独立链路，同一个外部症状）

**1）已修复但有历史脏数据**：Gemini 中文回复常用全角标点（。/、），旧解析正则只认半角句号，导致真实数据整批解析失败返回 null（decision 26d518fc，PR #1416，2026-07-19 20:07 Beijing 合并修复）。苏彦卿那批 22 条、以及更早的历史数据（prod tenant 455a8ca9 等）都发生在这次修复之前，永远补不回来，没有 backfill 机制。

**2）仍然存在**：`comment-grading.ts::gradeComments()` 在画像（`target_profile_desc`）为空时静默返回全 null——这是三个失败分支（TOAPIS_API_KEY 未配置 / Gemini 调用失败 / 画像为空）里唯一没有日志的一个。2026-07-20~07-21 最新一次真机测试（staging tenant 68f2ee9f）就撞上了这个分支：租户 acquisition_config 表 0 行，采集照常跑完，用户看到的表现和真正的系统故障一模一样，没法自助分辨是自己忘填画像还是系统坏了。

## 用户追加需求
判定引擎从 Gemini(gemini-2.5-flash-official，经 ToAPIs) 换成 DeepSeek(经 OpenRouter，deepseek/deepseek-chat)，降低成本。仓库已有现成封装 `apps/api/src/llm/openrouter.ts`（被 wechat-draft.ts 等复用），直接复用。

## 修法（含错误路径审查后的加固）

1. **判定引擎换 DeepSeek**：复用 `apps/api/src/llm/openrouter.ts` 的 `callOpenRouter`，替换 comment-grading.ts 里手搓的 axios 调用。
   - `callOpenRouter` 目前用裸 `fetch` 没有超时控制，而判定调用是在数据库事务内部执行的（`BEGIN` 之后、INSERT 之前，acquisition.ts ~897-951 行）。不加超时会占着连接不放，拖垮 `/collect/report` 并发。**必须显式包超时**（Promise.race / AbortSignal），并把判定调用挪到 `BEGIN` 之前执行，缩短占用事务的时间。
   - DeepSeek 输出格式（`1)`、`1:`、加粗序号等）跟现有正则（专门为 Gemini 全角标点写的）不一定匹配，换引擎后先拿真实数据跑一遍核对解析成功率，成功率不够再扩正则。

2. **给"画像为空"分支补日志**：加一条 `console.warn('[comment-grading] target_profile_desc 为空，跳过判定')`，跟另外两个失败分支保持一致。

3. **历史数据 backfill——加保护，不能无脑补**：`acquisition_config` 只存当前值、没有历史时间戳，没法准确判断"当时画像是不是空的"。直接 backfill 有误发私信风险：把当时本来就没画像的记录也补出"精准/高意向"，会经 `rescoreLead` 自动把 `outreach_eligible` 置真、真实触发私信。**新产出的 backfill 结果不联动自动派发**，backfill 后手动跟用户过一遍名单确认，再手动改 `outreach_eligible`（本次不建复核 UI，另立 sprint）。

4. **`acquisition_leads.grade` 顶层字段回写 + 并发加锁**：目前追加新评论时从不更新这个展示字段。修的时候顺带解决 `rescoreLead` 没有行锁的并发问题——两个视频同时上报同一个 lead 的评论时，先完成的事务可能用旧快照覆盖后完成的结果。加 `SELECT ... FOR UPDATE` 锁住"读评论→算聚合→写"临界区，回写顶层 grade 一并纳入这个锁保护。

## 不包含（另立 sprint，本次不做）
- 判定失败 / 采集任务失败 / backfill 派送复核的手动重试 UI（用户已确认放到 bug 修复之后单独做）

## Regression Test 计划
- `comment-grading.test.ts`：补"画像为空 → 有 warn 日志"用例（RED）；把 Gemini mock 换成/新增 OpenRouter(DeepSeek) mock 验证解析逻辑
- 真机接缝，CI mock 测不出真实解析率：staging 上真实触发一次采集，亲眼看 DeepSeek 返回的评论被正确判出非 null 结果

## 验收标准
- [ ] failing test 先 commit（画像为空分支现在没日志 → 红）
- [ ] 修复代码变绿：DeepSeek 接入(带超时+挪到BEGIN前) + 日志补齐 + grade 顶层字段回写(带行锁)
- [ ] backfill 脚本产出结果不自动联动 outreach_eligible/派发
- [ ] backfill 跑一次苏彦卿那 22 条，亲眼验证至少几条被正确判出非"其他"档，且 outreach_eligible 没被自动置真
- [ ] CI 全绿
- [ ] staging 真机验证：新采集一批评论，DeepSeek 判定出非 null grade，高意向样本能正确让 outreach_eligible 变真
