# Handoff：Line04 ✕关闭快速自愈通道——跳过90s宽限与600s冷却（两轮真机端到端，首版被证伪）

- task_id: unknown（交互式 /dev 承接，`.dev-mode` task_id=local，跳过 Brain tasks 表回写）
- verdict: PASS
- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1393（已合并，merge commit e8be5dea090e7c25574b20de095c6c3a1d929958）

## 背景（#1391 之后用户的第二轮实测反馈）

"我把微信一关…再发消息，你什么都听不到了…也不见重启"。日志实锤：18:34:43 ✕关闭（#1391 的 fallback 已生效 found_window=True）→ 但走的是通用塌缩自愈：90s 宽限 + 600s 冷却（18:24 刚重启过被卡）+ 可读守卫，2 分 40 秒后才恢复，期间客户消息无人回。当天该监听进程已重启微信 10 次，冷却撞车是常态。

## 修法（PR #1393，模块 1.0.141）

`_should_fast_heal_hidden_collapsed` 纯函数：塌缩发生在**托盘唤回时间戳**（`_LAST_TRAY_RESTORE_AT`，`_ensure_tray_visible` tray 分支唤回时记录）±120s 关联窗口内 → 判定 ✕关闭撕树（确定性）→ 15s 短防抖后立即重启。独立 120s 冷却（不与树塌 600s 共享），绕过可读守卫，保留全局重启上限。

## ⭐ 首版设计错误（被自己的真机端到端证伪，未提交，教训必读）

首版用"此刻 `IsWindowVisible=False`"当 ✕关闭特征。真机端到端验证：快速通道 **0 触发**——监听自己的 tray 分支 1-3 秒内就把隐藏窗口 SW_SHOWNA 唤回成可见（挪屏外+常驻隐身），塌缩检测跑起来时窗口早已"可见"，该条件在真实流水线里永远 False。**mock 单测全绿完全发现不了这种流水线交互**。正确信号 = 托盘唤回动作本身（事件时间戳），不是瞬时状态快照。这是"必须自己真机端到端验证"纪律今天第二次直接拦下错误设计（第一次是 navigate_away sleep 假设）。

## 真机端到端验证（二版，合并前）

✕关闭 19:02:24（hidden=true 干净复现）→ "✕关闭快速自愈"日志 19:03:41 → 欢迎屏自愈 19:03:58 → 完全恢复（login=True sessions=12）19:04:43。**总时长 2 分 19 秒、稳定可预期**（不再被 600s 冷却饿死）。验证边界：本轮验证的是扫描能力恢复；恢复后回复链路由当天 18:36 恢复→18:37:26 真实 DELIVERED 佐证，未在本轮重复注入真消息。

## 没做 / 遗留

- **恢复时长还有 ~60s 可压**：塌缩检测挂在心跳块（~60s 周期），15s 防抖被心跳粒度吞掉。把快速自愈判定挪进主扫描循环（1-3s 周期）可把总时长压到 ~80s，但改动面大，待用户对 2 分 19 秒的反馈再决定。
- **零重启召唤**仍是终极方向（托盘图标真实点击），见 #1391 交接单。
- ✕关闭→恢复期间到达的客户消息依赖微信自身的未读角标在重启后保留（微信机制保证），恢复后首轮扫描应能捞到——未专项验证过"关闭期间到达的消息恢复后被回复"，值得用户实测一次（✕关→另一号发消息→等 2.5 分钟看是否自动回复）。
- 旧遗留：本地 macOS 全量 pytest 噪音、xian-rog 多方共享互斥锁。

## 数据源

- PR：https://github.com/perfectuser21/zenithjoy-workspace/pull/1393（merge e8be5dea）
- 涉及：`services/agent/wechat-rpa/listen_chat.py` + 镜像、`tests/test_xclose_fast_heal.py` + 镜像、9 处版本号（1.0.140→1.0.141）
- 前置 handoff：`202607181807-line04-xclose-hidden-window-fallback.md`（#1391，同日第 6 个修复）

## 决策引用

- decision 0ed4632b：✕关闭后恢复慢且会被冷却饿死——隐藏态塌缩快速自愈通道（本次修法依据，含首版证伪教训）
- decision d3e7299b（#1391）及同日前五个修复的决策链

## 产物

- PR: https://github.com/perfectuser21/zenithjoy-workspace/pull/1393
- merge commit: e8be5dea090e7c25574b20de095c6c3a1d929958
