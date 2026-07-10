# 小改动 PrepPRD：Stage1 视频清单回报端点 + 服务端终态结算（多视频协议闭环 PR1-2）

任务：Brain dev task `4fad361c-5cf9-4ea6-90c3-0023059c04ff`（Initiative aca0f2d0「多视频协议闭环」，Scope1 fb84980a，Project c2a7bbc3）

## 改什么
apps/api/src/routes/acquisition.ts + apps/api/src/services/acquisition-collect.ts，一个 PR：

1. **新端点 POST /api/acquisition/collect/report-videos**（Stage1 清单回报）：
   - 幂等键 (task_id, video_id)，重复回报返回同结果不重复计数
   - 校验 x-agent-id 与任务绑定 agent 一致（403）+ 带 tenant 条件查任务（现有 report 两者都缺，acquisition.ts:869/887 零鉴权）
   - 空清单必须带 reason：search_result:'empty'→partial；error_code→failed/保留重试；无 reason→400
   - 事务 + SELECT FOR UPDATE 防并发脏读（现状 :887/:1015/:1021 裸读改写有竞态）
2. **服务端终态结算 settleCollectTask()**：纯函数进 collect.ts（可单测），统一 done/partial/failed/cancelled 判定；report、新端点、sweep-timeouts 三处共用；dispatch 链（:1064）只在真进终态那一次点火
3. **联动改现有 report**（不改则两套状态机打架）：
   - 删 acquisition.ts:1001-1019「评论回报数倒推 stage_1_done」错位逻辑（MAX_VIDEOS_PER_KEYWORD=3 阈值）
   - 加终态守卫（现在终态任务回报照样写库+计数，:1002-1033 无守卫）
   - 修 ON CONFLICT (video_id) 全局唯一键 → (task_id, video_id)（:1040，同一抖音视频被两个任务命中会互相覆盖，需 migration）
   - 补 cancelling→cancelled 落章（现存 bug：全 repo 无任何路径写 cancelled，取消停在 cancelling 被 resolveTerminalStatus collect.ts:132-144 覆盖成 done）
   - pending-collect-tasks :379-389 Stage2 下发改为只发未完成视频
   - sweep-timeouts :1088-1103 把 stage_1_done 超时也纳入收尸
4. **契约文档**落 sprints/07091806-android-collect-protocol-v2/（补 prep-prd 缺口#1）

## 为什么改
两阶段采集协议断层：API 期望每关键词收满 3 视频才进 stage_1_done，但 Stage1 回报端点未定义，安卓端抓 1 个就停 → acquisition_collect_tasks 永远卡 running。同时修 cancelled 永不落章的现存 bug。

## 影响范围
- 现有 report 端点行为变化（终态守卫 + 唯一键 migration + 删倒推逻辑），两套状态机合一
- 生产 dispatch 链逻辑不改，只改触发点归属（真进终态那一次点火）

## 不包含（范围外）
- 安卓端多视频循环（下一个 PR）

## 验收标准
- [ ] settleCollectTask 单测四分支（done/partial/failed/cancelled）
- [ ] 幂等重报不重计数 + 终态后回报被拒
- [ ] 契约文档落 sprints/07091806-android-collect-protocol-v2/
- [ ] CI 全绿
