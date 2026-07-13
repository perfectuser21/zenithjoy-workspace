# Bug PrepPRD：Line02 采集 Stage1 导航整体健壮性（专门 tab 分栏采集 + 搜索前复位 + tab 时序）

## 症状
Line02 采集 Stage1 间歇失败（被误称"抖动"）。同一"装修"任务，真视频排广告前→done video_count=1；广告排前→ALL_SHARE_FAILED/失败。今天一天三种失败全见过：
- `NO_SEARCH_INPUT`（openSearchBar: searchBtn=false）——找不到搜索入口
- `SEARCH_TIMEOUT`——搜了但结果没加载/切 tab 手势没生效
- `ALL_SHARE_FAILED`——广告/直播卡抓不到分享链 + abort 太脆

## 根因（真机勘查坐实，xian-rog 荣耀 MAA-AN00 / ANGYVB4311010223，2026-07-13）
1. **不过滤广告/直播/图文卡**：`findVideoCards`（DouyinCollectService.kt:1118）纯尺寸阈值——clickable 且 bounds>400×400 就当视频卡，完全不区分卡类型。搜"装修"结果页**第一张就是广告**（"西安120m'轻奢装修全包…"+`content-desc="广告反馈"`+"免费咨询"），无脑选中它 → 点开→点分享→抓不到 v.douyin.com 短链 → 计 failure。
2. **abort 太脆**：`collectVideoCards`（:542）`consecutiveFailures >= 2` 就 break 放弃整轮。连续 2 张广告 → 整个 Stage1 挂，后面真视频/图文也不采。
3. **恶性耦合**：商业词（装修/家装=客户画像词）广告密度最高 → 越是目标客户的词越容易被广告 abort。
4. **NO_SEARCH_INPUT**：前一轮任务把抖音留在视频/广告落地页没复位，搜索按钮找不到。
5. **SEARCH_TIMEOUT**：综合 tab 直播/视频/用户混排、tab 切换手势时序。

## 用户拍板（2026-07-13）
- **路线 = 方案A 专门 tab 分栏采集**：搜索 → 切「视频」tab 采视频 → 切「图文」tab 采图文。广告/直播天然不进专门 tab（真机实测：视频 tab 3 张全真视频、图文 tab 4 张全真图文，广告只在综合 tab 插入）。卡分类判据只作二次防线。
- **范围 = 三件一起**（导航整体健壮性）：卡分类分栏 + 搜索前复位 + SEARCH_TIMEOUT tab 时序。

## 四类卡特征表（真机 uiautomator dump 实测）
| 类型 | 铁特征 | 处理 |
|---|---|---|
| 广告 AD | 子树含 `content-desc="广告反馈"`；或 text 含 广告/免费咨询/获取报价/立即咨询/立即预约 | 跳过，不计 failure |
| 直播 LIVE | 子树含 直播中/正在直播/去看看直播 等直播标（真机 dump 待补，先按关键词兜底） | 跳过，不计 failure |
| 视频 VIDEO | text 含时长标记 `^\d{1,2}:\d{2}$`（如 01:34）+ 无广告标记 | 采集，media_kind=video |
| 图文 NOTE | 无时长标记 + 无广告标记（图文卡 id 含 container/cover/desc） | 采集，media_kind=note |

> 关键简化：video/note 由**当前 tab 决定**（视频 tab 采到即 video，图文 tab 采到即 note），`classifyCard` 只需可靠**排除广告/直播**（二次防线），不需精确区分 video/note → 更鲁棒。

## 修法
文件：`services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/collect/DouyinCollectService.kt`（+ AgentService/CollectReporter media_kind 串字段）

1. **卡分类纯函数**（逻辑接缝，CI 单测）：`classifyCard(texts, descs) -> CardKind{AD,LIVE,CONTENT}`（CONTENT=视频/图文内容卡），判据按上表。抽 companion `internal` 静态函数直测（对齐 `decideStage1ResultsAction`）。
2. **专门 tab 分栏采集**：搜索提交后切「视频」tab 采视频、切「图文」tab 采图文。收集卡后 `classifyCard`：AD/LIVE 跳过、不计 failure、不点分享；CONTENT 才走 captureShareUrl，media_kind 按当前 tab 定。
3. **abort 改造**：`consecutiveFailures` 只在"CONTENT 卡取链真失败"时计数，跳过 AD/LIVE 不计；真的一张目标卡都采不到才 ALL_SHARE_FAILED。
4. **搜索前复位**（NO_SEARCH_INPUT）：`openSearchBar` 找不到搜索按钮时先 BACK/回首页复位重试再判死。
5. **SEARCH_TIMEOUT tab 时序**：分栏采集下切「视频」「图文」tab 各自独立结果等待 + 看门狗 generation。

## 分阶段真机验证（RPA 一次一假设，环境接缝守卫）
- 阶段1：视频 tab 采集 + 分类过滤 + abort 改造 → 真机验证视频采到、广告不 abort
- 阶段2：图文 tab 采集（**图文详情页分享取链是最大真机未知数**，只勘查了列表页）→ 真机验证图文能取链
- 阶段3：复位 + tab 时序

## Regression Test 计划（逻辑接缝守卫，永久留 CI）
Kotlin JUnit 纯函数单测（`services/agent-android/app/src/test/...`）：
- `classifyCard` 对四类真机样本（广告"西安120m'轻奢装修…"/视频"01:34…"/图文无时长/直播标）返回正确 CardKind
- 采集决策：AD/LIVE → skip 不计 failure；CONTENT → collect
- abort：连续 N 张广告被跳过后仍能采到后面的真内容卡（不因广告 abort）

> ⚠️ 逻辑接缝（分类/决策纯函数）→ CI test 即守卫。**真机端到端是环境接缝**→ 守卫 = 真机自验冒烟，lead 在 xian-rog 亲验翻牌。

## 验收标准
- [ ] failing test 先 commit（commit-1）：classifyCard/决策/abort 单测先红
- [ ] 修复代码让 test 变绿（commit-2）+ 采集流程改造
- [ ] Agent 版本 bump（versionCode 14→15 / versionName）
- [ ] CI 全绿（含 lint-tdd-commit-order / Android 单测）
- [ ] **真机自验**：xian-rog 编译装 APK → 派"装修"任务 → 查 `acquisition_collect_videos` 有 video + note 两类、无 ALL_SHARE_FAILED、`judgment_status` 翻 matched/rejected

## 关联上下文
- Journey：Path2 客户智能获客 Step8（评论区挖客——采集环节）
- handoff：handoff_0713_stage1_ad_filter_rootcause / handoff_0713_content_judgment_realmachine_3cuts
- 历史采集 PR：#1228 / #1230 / #1231（均 xian-rog 真机自验合并）
- decision：4c1ea1a0（bug-fix）
