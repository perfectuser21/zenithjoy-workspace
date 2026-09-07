# Handoff：信号桥新增 open-search-evidence 命令（打开搜索+输入中文关键词）

- task_id: unknown（本次为交互式 /dev 路径B，未注册 Brain task）
- initiative_id: none
- journey_id: none（未查到精确匹配，GP-Anchor 已声明见下）
- verdict: PASS
- GP-Anchor: line02/keyword_acquisition#step2

## 完成

- 信号桥（`adb-controller-bridge.sh` → `phonectl.sh` → 中台 `POST /api/devices/:agentId/actions` → agent-android）新增 `open-search-evidence <keyword> <evidence_id>` 命令，打通 discovery 阶段此前卡住的"controller lacks the required open-search entrypoint"缺口
- Kotlin 端 `CommandProtocol.kt` 新增 `CmdAction.OPEN_SEARCH` + `ERR_SEARCH_ENTRY_NOT_FOUND`/`ERR_SEARCH_SUBMIT_FAILED` 两个错误码
- 新建 `OpenSearchRunner.kt`（回调注入模式，纯 JVM 可测，不直接碰 `AccessibilityNodeInfo`）
- `CommandExecutor.kt` 接入 `OPEN_SEARCH` 到 `sensitive`/`mutating` 门禁集合与分发
- `AgentService.kt` 装配真实无障碍服务回调，算法参照 `DouyinCollectService.openSearchBar/typeKeyword/triggerSearch`；**过程中 code-reviewer 发现并修复了一个真实 correctness bug**——最初实现的 `typeKeyword`/`submitSearch` 闭包零延时执行，会重现历史上修过三四次的 NO_SEARCH_INPUT 竞态（点击/输入后没等页面真正渲染就去读下一个节点），已补齐 `RandomDelay.sample(CLICK_MS/SEARCH_MS)` 延时并验证修复
- 中台 `devices.ts` 的 `ACTION_WHITELIST` 加入 `open_search`
- `phonectl.sh`/`adb-controller-bridge.sh` 打通对应转发链路
- 新增 command-trace 留痕（`<profile>.command-trace.jsonl`，分桶键用已校验且必然存在的 `$PROFILE`，不用位置不固定的 evidence_id），为将来判断"AI 编排是否稳定、可蒸馏成确定性脚本"积累数据基础
- 扩展 `device-command-bridge-smoke.sh` 新增件3 open_search 接线断言 + 单测执行，满足 CI `lint-feature-has-smoke` 门禁
- 全部实现 commit（Task 1-7）均经过独立 code-reviewer 复核（spec 合规 + 代码质量 + 测试有效性亲自重跑验证），无遗留 Critical/Important 问题
- PR #1789 已合并（squash merge）

## 没完成 / 范围外

- 真机 E2E 验证（秦军餐饮测试号搜索"装修"进入结果页）尚未执行——这是下一步的第一优先级
- HK-VPS 部署同步（`/opt/openclaw/zenithjoy-bridge/scripts/` 的 `adb-controller-bridge.sh`/`phonectl.sh` 静态拷贝）尚未推送最新代码——**本 sprint 前一次 call_state 修复就因为漏做这步导致真机验证读到旧代码**，这次务必先做部署同步再验证
- agent-android 新版本 OTA 到测试机尚未执行
- 命令级留痕（command-trace）积累的运行记录尚未被实际用于"判断是否可蒸馏成确定性脚本"这个分析——这是数据基础设施，分析本身留给后续跑够多次运行之后
- `DouyinCollectService`/`DouyinDmOutreachService`/`DeviceAccountScanService` 三份重复的节点查找工具函数未做共享抽象重构（设计阶段明确排除在本次范围外的既有技术债）

## 下一步

1. SSH 到 hk-vps，把仓库最新 `scripts/openclaw/adb-controller-bridge.sh`/`phonectl.sh` 同步部署到 `/opt/openclaw/zenithjoy-bridge/scripts/`
2. 真机验证：`open-search-evidence 装修 <evidence_id>` 在秦军餐饮测试号上实际搜索并进入结果页（人工核对截图）
3. 触发一次完整的 `social-keyword-leadgen-*` discovery 阶段真机运行，确认不再报 open-search-entrypoint 缺失，流程能推进到视频筛选/翻页环节
4. 视频筛选/翻页/评论采集等 discovery 阶段后续步骤大概率会暴露下一个信号桥命令缺口（延续本 sprint"边跑边补齐命令"的节奏），发现后走同样的 /dev 路径B 流程

## 数据源

- 设计文档：`docs/superpowers/specs/2026-09-07-open-search-entrypoint-design.md`
- 实现计划：`docs/superpowers/plans/2026-09-07-open-search-entrypoint.md`
- PrepPRD：`sprints/09061334-search-entrypoint/prep-prd.md`
- decisions 表：topic "信号桥补齐搜索入口命令(open-search-evidence)"

## 决策引用

- decisions: 信号桥补齐搜索入口命令(open-search-evidence)（category=small-change）

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1789
- branch: cp-09070153-search-entrypoint（已合并，squash）
- sprint_dir: sprints/09061334-search-entrypoint
