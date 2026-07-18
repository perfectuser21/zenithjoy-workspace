# 小改动 PrepPRD：下线关键词采集孤岛流水线（Path2 智能获客）

## 改什么
删除 `/api/acquisition/keyword-search` 整条旧流水线的代码入口，只保留 `/collect/start` 新链路（带 `ContentJudgmentService` 判定）。具体：

1. **后端** `apps/api/src/routes/acquisition.ts`：删除 4 个旧路由
   - `POST /keyword-search`（line 73-119）
   - `GET /pending-keyword-tasks`（line 121-190）
   - `GET /keyword-tasks`（line 192-224，前端设置页拉状态用）
   - `POST /video-search-result`（line 511-548）
   - `POST /comment-score-result`（line 550-705）
   保留 `/collect/*` 全部新路由不动。

2. **安卓端** `services/agent-android`：
   - 删除 `AcquisitionKeywordPollLoop.kt` 及其测试 `AcquisitionKeywordPollLoopTest.kt`
   - `AgentService.kt` 删除 `keywordPollLoop` 字段 + line 381-393 启动代码

3. **前端** `apps/dashboard/src/pages/AcquisitionConfigPage.tsx`：删除嵌入的关键词输入框组件及其 `fetch('/api/acquisition/keyword-tasks')` / `fetch('/api/acquisition/keyword-search')` 调用（line 381、409 附近）

4. **Windows 桌面端 agent** `services/agent`（brainstorming 阶段核实前 PrepPRD 遗漏，2026-07-18 补充）：
   - `services/agent/src/index.ts`：删除 `startAcquisitionKeywordLoop()` 及其在 `index.ts:615` 附近的启动调用（`if (process.env.ZENITHJOY_DISABLE_ACQUISITION !== '1')` 分支）、以及 `index.ts:1169/1201/1225/1239` 处对 `/pending-keyword-tasks`/`/video-search-result`/`/comment-score-result` 的轮询与回报调用
   - 删除 `services/agent/src/handlers/keyword-search-douyin.ts`（仅被这条旧循环调用，`searchDouyinVideosByKeyword`，与新 line02 模块不共享代码路径——line02 直接 spawn `.cjs` 脚本）+ 对应测试 `services/agent/src/__tests__/acquisition-keyword-extract.test.ts`
   - line02 模块（`services/agent/modules/line02/index.ts`，脚本文件名为 `keyword-search-douyin.cjs` 但实际轮询 `pending-collect-tasks`/走新链路）不受影响，不要被文件名混淆误删

5. **数据表** `acquisition_keyword_tasks`：**不 drop**。生产库现存 26 条历史数据（已核实），直接 drop 属于危险 DB 操作，本次只停止写入，表和数据保留待后续单独决策。

## 为什么改
新链路（`/collect/start`，带判定）上线近 2 个月后旧链路从未下线，安卓端两套轮询同时跑纯耗电；上次真机排障还因为误调到旧接口浪费了排查时间。根因分析已记 Notion Issue `979760b4-c8ea-467d-a2f5-bb96f9e20d9c`。brainstorming 阶段 Research Subagent 核实代码时又发现 Windows 桌面端 agent（`services/agent/src/index.ts`）里存在第三条独立的旧轮询 `startAcquisitionKeywordLoop`，此前误判"Windows 不受影响"，已用户确认一并清理。

## 关联上下文
- Journey：客户智能获客路径（`afa6abca-53c0-4815-8594-b7fb81ca547f`）
- 相关 Issue：`979760b4-c8ea-467d-a2f5-bb96f9e20d9c`
- Windows agent 的 `line02` 模块（新链路）不受影响；`index.ts` 里独立的旧轮询 `startAcquisitionKeywordLoop` 需一并删除（见上）

## 影响范围
- 不影响新链路 `/collect/*`、line02 模块任何行为
- 不影响生产历史数据（表保留）
- 需确认删除后 `apps/api/src/routes/acquisition.test.ts`（10个 describe 块，行号 83/132/143/180/387/445/540/1283/1365/1410，与新链路测试穿插，需逐块精确删除，不能整段删）、`services/agent/src/__tests__/acquisition-keyword-extract.test.ts` 同步删除
- `buildLeadFieldsFromComment`（`acquisition.ts:42-58`）虽被要删的 `/comment-score-result` 内部调用，但本身是导出的纯函数，被独立测试 `acquisition-lead-douyin-id.test.ts` 直接 import，**不能连带删除函数定义本身**
- `expandKeywords`（仅 `/keyword-search` 用）、`gradeComment`（仅 `/comment-score-result` 用）已核实无其他调用方，可随路由安全删除；`/collect/expand` 已确认不复用 `expandKeywords`

## 验收标准
- [ ] 两段式 commit：commit-1 纯删除（后端路由+安卓轮询+Windows轮询+前端入口+对应旧测试，保留 `buildLeadFieldsFromComment` 函数定义），commit-2 若有连带修复再补
- [ ] `acquisition.test.ts` 全绿，未出现悬空引用；`acquisition-lead-douyin-id.test.ts` 不受影响
- [ ] 安卓端编译通过，`AgentService.kt` 不再引用已删除类
- [ ] Windows agent（`services/agent`）编译/测试通过，`index.ts` 不再引用 `startAcquisitionKeywordLoop`
- [ ] 前端 `AcquisitionConfigPage.tsx` 构建通过
- [ ] CI 全绿
