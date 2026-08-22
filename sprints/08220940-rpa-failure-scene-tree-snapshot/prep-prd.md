# 小改动 PrepPRD：刀1 病历补全 —— 失败现场落无障碍树快照 + 设备/系统/App 版本

## 归属
line02 横切件「AI on-call 定位求助」第一刀（0822 主理人拍板，格子坐标：line02 · 横切件池 · 新建横切件）。
锚：`line02/keyword_acquisition keep-green`。本刀不建求助通道，只攒原材料——不管刀2做不做都稳赚。

## 改什么
**Android（services/agent-android）**：
- 新增 `uia/UiTreeSnapshot.kt`：失败那一刻把无障碍树序列化成紧凑文本行
  （深度缩进 + class/text/desc/viewId/clickable/bounds），三重上限：64KB 字节 / 30 层 / 800 节点，
  超限截断带标记。纯逻辑走接口抽象（JVM 单测不碰 Android 框架类，同 FailureScene 做法）
- `FailureScene` 增 `uiTree` 字段；`DouyinDmOutreachService.finishWithOutcome()` 失败时采快照进广播
- `AgentService.reportDmOutreachResult()` 上报 body 增 `ui_tree_snapshot`（仅失败）+
  `device_model`/`os_version`/`app_version`（恒带——机队版本随时间漂移，按行落库才能事后对账）
- versionName 2.1.35 → 2.1.36，versionCode 39 → 40（feedback_agent_version_bump）

**API（apps/api）**：
- migration：`dm_outreach_log` 增 `ui_tree_snapshot`/`device_model`/`os_version`/`app_version` 四列
- `/dm-outreach-result` 路由：接收并写正表（快照服务端二次截断 64KB 防恶意撑爆）
- 保留期 30 天（主理人拍板）：路由内惰性清扫——每次写入顺手把 30 天前的 `ui_tree_snapshot`
  置 NULL（低频端点，零新增基建；只清重列，其余现场字段永久保留）

## 为什么改
0821 交接单结论：四次盲修的结构性原因是失败现场不在人会看的地方。前台包名+诊断行（PR#1689）
翻过两次错判，但要让 AI 能"指认元素"、让周报能"按机型×版本聚类"，还差树快照和版本三件。

## 影响范围
- 沿用既有失败上报漏斗（buildFailureScene → 广播 → POST → 正表），不开新通道，
  `lint-rpa-failure-scene` 闸天然通过（只加字段不动既有三件套）
- 成功路径零变化（快照只为失败服务，同 FailureScene 既有原则）
- 广播 extra 64KB 远低于 Binder ~500KB 上限

## 真机验证计划（参考机=小粉）
装 2.1.36 → 人为触发一次私信失败 → staging 库 `dm_outreach_log` 查到该行
`ui_tree_snapshot` 非空且含抖音节点、`device_model/os_version/app_version` 正确。
同时确认 dumpsys 无障碍仍 Bound（树 dump 不需要新权限，验证不碰授权）。

## 验收标准
- [ ] commit-1：失败测试先行（Android 序列化/截断/接线源码断言 + API 落库/截断/保留期 + smoke）
- [ ] commit-2：实现转绿
- [ ] CI 全绿（含 lint-rpa-failure-scene / lint-feature-has-smoke / lint-tdd-commit-order）
- [ ] 真机（小粉）实证快照落库 + 无障碍授权未受影响
