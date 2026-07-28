# Bug PrepPRD：Staff Hub「Path 健康」页查询智能客服(Path4)时用的是已废弃孤儿 journey_id

## 症状
Staff Hub 已上线的 GP2「Path 健康」页面（`/api/staff/path-health`）查询 Path4（智能客服）时，
返回的数据是过时/几乎空的，不反映真实现状。

## 根因假设
`apps/api/src/routes/staff.ts` 的 `PATH_DEFS.path4.journeyId` 硬编码为
`bfeed805-deed-46c3-8624-87f0028101d4`（journeyName='客户私域 AI 接管'）。
这条 journey 记录已经从 Brain `journeys` 表消失（孤儿外键，只有历史 journey_features 还挂着它的 id）。

2026-07-28 主理人用 golden-path skill 做了 product/tech/risk 三镜头对抗审查，逐条拍板后，
把内容整合迁移到新建的统一「智能客服」journey（id=`e675da0f-1117-4301-a801-cd4753beb8c8`，
journey_type=user_facing，maturity=skeleton，含 GP-A~F 六条 golden path，48 条真实 journey_features）。
`staff.ts` 的硬编码 id 没有跟着改，导致页面查的还是旧的空壳数据源。

## 关联上下文
- 相关 Journey：智能客服（`e675da0f-1117-4301-a801-cd4753beb8c8`）
- 相关历史决策：本次会话内新写入的 judgment 类 decision（GP-B 私聊自动回复判定标准）
- 无相关 Issue（本次直接从主理人对话发现）

## 修法
`apps/api/src/routes/staff.ts`：
- 第 84 行 `journeyId: 'bfeed805-deed-46c3-8624-87f0028101d4'` → `journeyId: 'e675da0f-1117-4301-a801-cd4753beb8c8'`
- 第 85 行 `journeyName: '客户私域 AI 接管'` → `journeyName: '智能客服'`

## Regression Test 计划
`apps/api/src/routes/__tests__/staff.test.ts` 新增一条 `[BEHAVIOR]` 测试：
mock axios 只对新 journey_id（`e675da0f...`）返回真实 feature 数据，其它任何 journey_id
（包括旧孤儿 id）一律返回空数组。断言 `path4` 返回的 features 长度为 1 且内容匹配——
如果代码又被改回/改错成旧 id，这条测试会因为查到空数组而报红。

守卫种类：逻辑接缝（纯数据指针配置），CI test 即可，不需要环境类自检。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 已为本 bug 配 proven-to-fire 守卫（新测试改前会红、改后会绿，已亲眼验证）
- [ ] CI 全绿
