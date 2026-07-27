# Bug PrepPRD：气泡 gate 的 _reset_session_list_to_top 恢复只试一次，加重试消除 CI×生产监听桌面互斥残留 flaky

## 症状
`services/agent/tools/selfcheck_bubbles.py`（真机气泡可读性 CI gate）在 rog self-hosted runner 上报
`session list 里找不到 文件传输助手`，两次独立 rerun 完全确定性复现，main 分支近5次跑该 workflow 全绿。

## 根因假设（已用 rog 真机截图+UIA 读取证实）
- rog 既是 CI self-hosted runner 又是生产机：气泡 gate 和 line04-wechat-cs 生产监听共用同一个微信窗口实例。
- 已有 `desktop-lease-broker`（sprint 0703）做优先级互斥：CI acquire priority=10 高优先级租约，监听
  主循环 `_should_yield_desktop` 查到后整轮让位（设计上刻意不碰 UIA，注释写明让位期间"绝不碰心跳/
  扫描/发送/UIA 标志"，清理交给让位结束后监听自己的 scan 自愈接管）。
- 真机诊断证实：CI 跑 gate 那一刻，窗口正停在某个真实客户已打开的聊天面板上（不是会话列表）。
  `find_item_with_recovery` 里唯一一次 `reset_fn`（`listen_chat._reset_session_list_to_top`）调用
  失败（"切通讯录未生效，升级梯用尽，放弃本轮回顶"），gate 直接判失败退出，不会再重试。

## 修法（已与用户对齐，明确拒绝的方案见下）
只加固 CI gate 自己的恢复重试，**不改监听侧让位行为**：
- `find_item_with_recovery` 目前 `reset_fn` 只调一次失败就放弃；改成重试 N 次（如 3 次，每次间隔
  给窗口/焦点状态喘息时间），因为 `_reset_session_list_to_top` 自身的点击升级梯（PostMessage→
  验证→click_input）是瞬时的，网络/前台焦点/窗口动画等瞬态原因导致的单次失败，大概率换一轮全新
  尝试就能成功。

**明确拒绝的方案**："监听让位前主动 navigate_away 清场" —— 会破坏现有"整轮让位绝不碰 UIA"不变量
（注释里的设计意图是让 CI 独占操作窗口，监听让位期间碰 UI 反而可能引入新的竞态），弃用。

## 关联上下文
- issue `b237a4b6-3534-4ebb-9e99-3afb6025f920`（根因排查全过程）
- 相关 Journey：智能客服 · 绑定/安装（共享前置）
- 相关历史决策：desktop-lease-broker（sprint 0703）

## Regression Test 计划
`find_item_with_recovery` 已是纯函数、`reset_fn` 已注入（原为可测设计）。新增测试：
- `reset_fn` 前两次调用失败、第三次成功 → 断言最终能找到 target（当前实现只调一次会失败）
- 保持原有"只调一次即成功"的测试不受影响
- 保持原有"重试耗尽仍失败"的测试更新为耗尽 N 次而非 1 次

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] CI 全绿（不依赖 rog 真机复现，纯逻辑单测覆盖）
- [ ] 不改动 listen_chat.py 核心监听让位逻辑
