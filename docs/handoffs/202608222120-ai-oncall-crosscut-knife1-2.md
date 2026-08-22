# Handoff：AI on-call 定位求助横切件 —— 刀1/2a/2b（病历→端点→安卓闭环）

**日期**：2026-08-22　**格子坐标**：line02 · 横切件池 · 新建横切件（0822 主理人拍板）
**verdict**：PASS（刀1 已真机闭环；刀2a 已真调实证；刀2b 本 PR）

## 靶子（主理人原话口径）
机型×安卓版本×抖音版本碎片化导致的 RPA 不准确/不稳定。每步都有 AI 保底；
权限/封号类不归 AI（就绪度上报兜底）。UI-TARS 按保底后端引入，优先托管 API 不自架。

## 三刀战果
| 刀 | PR | 内容 |
|---|---|---|
| 刀1 病历 | #1700 | 失败现场落无障碍树快照(64KB/30层/800节点)+设备版本三件套进 dm_outreach_log；30天保留期；真机实证（荣耀X30 2.1.36，failed 行 5148 字符快照含抖音 resource-id）|
| 刀2a 端点 | #1702 | POST locator-assist：树→deepseek 指认候选；缓存键=步骤×目标×机型×系统×抖音版本（碎片化格子只花一次钱）；UI-TARS vision 插座未通电显式降级；fail-open |
| 刀2b 接线 | 本PR | 两个 NO_SEARCH_INPUT 判死点判死前先问保底→view_id 候选→本步预期状态即验证闸→verified 回执；agent 2.1.37 |

## 关键设计事实
- 求助协议步骤无关（每步通用），16 个定位调用点是未来铺满的钩子
- MVP 只用带 view_id 的候选；bounds-only 手势路径留待后续（坐标误触风险不背）
- verified 三态回执（无id候选/id找不到/预期未达成 全=false）是刀3 周报判"答案稳不稳"的唯一依据
- 树失明场景（Lynx/WebView）→ UI-TARS 通电时机；树比截图省一个数量级 token 故主干走树

## 没完成 / 下一步
- 刀2b 真机验证：荣耀X30 装 2.1.37 观察自然出诊（rpa_locator_assist 表）
- 刀3 周报固化；其余 14 个调用点逐步挂保底
- 并行高优：Seg3 抖音号回填覆盖率（26/35 线索无号=交付最大瓶颈）；dm_assignments 唯一约束与重投语义冲突 P1

## 数据源
`zenithjoy.rpa_locator_assist` / `dm_outreach_log` 新四列 / `apps/api/src/services/locator-assist.ts` /
`services/agent-android/.../uia/{UiTreeSnapshot,LocatorAssistClient}.kt` /
决策 d8da2a85(刀1)、c8c7ba30(刀2a)；task df89fc2a、b09c819b、3a484196
