# 设计：下线智能获客关键词采集孤岛流水线

## 背景
详见 `sprints/07181054-orphan-keyword-search-cleanup/prep-prd.md`（最终范围，含 brainstorming 阶段核实后补充的 Windows 端）与 Notion Issue `979760b4-c8ea-467d-a2f5-bb96f9e20d9c`（根因分析）。

Path2 智能获客的"关键词采集"存在三条并行的旧实现，均指向已被 `/api/acquisition/collect/*`（新链路，带 `ContentJudgmentService` 判定）取代的旧接口组：

| 端 | 旧实现 | 状态 |
|---|---|---|
| 后端路由 | `POST /keyword-search`、`GET /pending-keyword-tasks`、`GET /keyword-tasks`、`POST /video-search-result`、`POST /comment-score-result` | 待删 |
| Android | `AcquisitionKeywordPollLoop.kt` + `AgentService.kt` 里的启动代码 | 待删 |
| Windows 桌面 agent | `services/agent/src/index.ts` 的 `startAcquisitionKeywordLoop()` + `handlers/keyword-search-douyin.ts` | 待删 |
| 前端 | `AcquisitionConfigPage.tsx` 嵌入的关键词输入框 | 待删 |

`acquisition_keyword_tasks` 表（生产 26 条历史数据）本次不 drop，只是停止被写入——drop 表是危险 DB 操作，超出本次范围。

## 方案
不存在架构选择余地：这是纯删除任务，唯一的"方案"是删除范围的边界划定，已由 Research Subagent 逐项核实代码后确认（见 PrepPRD "影响范围"节）：

- **不能删**：`buildLeadFieldsFromComment`（`acquisition.ts:42-58`），是导出的纯函数，被独立测试 `acquisition-lead-douyin-id.test.ts` 直接 import，虽然被要删的 `/comment-score-result` 调用，函数定义本身必须保留。
- **可以安全删**：`expandKeywords`、`gradeComment`——已核实无其他调用方。
- **不能被文件名误导**：`services/agent/modules/line02/index.ts` 里 spawn 的脚本虽叫 `keyword-search-douyin.cjs`，但走的是新链路（`pending-collect-tasks`），不是待删对象；真正待删的是 `services/agent/src/handlers/keyword-search-douyin.ts`（TS handler，只服务 `index.ts` 里的旧轮询）。

## 测试策略
- **回归测试**：本次是删除已被新实现取代的死代码，无需新增功能测试。验收 = 删除后现有测试套件（后端 `acquisition.test.ts`、Android、Windows agent、前端）全绿，且不出现悬空引用/编译错误。
- **落地方式**：两段式 commit——commit-1 纯删除（后端5路由 + Android轮询 + Windows轮询 + 前端入口 + 对应旧测试用例），commit-2 仅在删除过程中暴露出需要连带修复的问题时才追加。
- `acquisition.test.ts` 里旧路由测试分散在 10 个 describe 块（行号 83/132/143/180/387/445/540/1283/1365/1410），与新链路测试穿插，需逐块精确删除，不能整段删。

## 不做的事
- 不 drop `acquisition_keyword_tasks` 表
- 不改动 `/collect/*` 新链路任何行为
- 不改动 `services/agent/modules/line02`（新链路 Node 模块）
