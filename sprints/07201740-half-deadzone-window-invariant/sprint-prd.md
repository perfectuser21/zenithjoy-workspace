# Sprint PRD: 半死区窗口形态不变量 + 梯度自愈（listen_chat 三件套）

## 元数据

| 字段 | 值 |
|---|---|
| task_id | 5e9d608f-0386-4318-ac46-59273967999d |
| sprint_dir | sprints/07201740-half-deadzone-window-invariant |
| journey | Path 4 客户私域 AI 接管（Line04 微信客服）|
| journey_type | user_facing |
| target_environment | windows_cloud |
| maturity | thin → thin（bug fix，无 thickness 升级）|
| bump | 1.0.148 → 1.0.149（已在 manifest.json 中；本次不再 bump） |

## 本 Sprint 推进声明

本 PR 把 Path 4 Step 3 的「半死区（标题 pane 不渲染）」从无自愈纳入梯度自愈闭环，推进 Step 3 新子步：

**Step 3l：窗口形态不变量前置 + 梯度自愈纳入半死区**（本次新增）

具体：reply_in_chat 读标题/判群前强制断言窗口非 iconic 且 zoomed/宽度达双栏阈值，违反时先 SW_MAXIMIZE 修形再读；连续 N 次（默认 3）标题读空且跨 ≥2 sender → 写诊断 dump → 修形复测 → 仍失败 → 复用 `_restart_wechat_for_uia` 重启；skip reason 细分 `title_unreadable` vs `is_group`，进心跳与 module_status。

## Invariant 约束

| # | 约束 | 违反处理 |
|---|---|---|
| I-1 | 读标题/判群前窗口必须非 iconic 且（zoomed 或宽度 ≥ 双栏阈值） | SW_MAXIMIZE 修形后再读，不变量函数独立可测 |
| I-2 | 连续 N 次（≥3）标题读空且跨 ≥2 sender → 视为半死区进入梯度自愈 | 先 dump 诊断证据 → 修形复测 → 仍失败 → _restart_wechat_for_uia |
| I-3 | skip reason 必须细分 title_unreadable / is_group，进心跳 diag | 禁止笼统 skip 无细分，防误诊 |
| I-4 | 梯度自愈重启须复用现有冷却（600s）和上限机制，不得绕过 | 直接调用 _restart_wechat_for_uia |
| I-5 | 诊断 dump 写 %PUBLIC%\\zj-deadzone-dump.json，供远程取证 | 写失败静默，不影响主链路 |
| I-6 | 改 wechat-rpa 必须 rsync 到 build-modules 镜像 | CI lint-build-modules-sync 检查 |
| I-7 | 待发队列 pending_retry 条目最长存活 30min（1800s），过期丢弃不重发 | select_due_retries 扫描时判 age |

## 累积 FR

| # | Feature | 状态 |
|---|---|---|
| FR-1 | UIA 后台静默监听（scan_unread + reply_in_chat） | ✅ 已有 |
| FR-2 | 窗口最大化自愈（window_needs_maximize + cooldown，issue 99741ff9） | ✅ 已有（Step 3b/3f） |
| FR-3 | 树完全塌缩自愈（_should_restart_for_collapsed_tree + _restart_wechat_for_uia） | ✅ 已有 |
| FR-4 | 心跳 diag + skip_reasons 上报（_SkipCounter，Phase 0 观测） | ✅ 已有 |
| FR-5 | 窗口形态不变量前置（reply_in_chat 读标题前断言 non-iconic + zoomed/宽度） | 🔄 本次新增 |
| FR-6 | 半死区梯度自愈（连续 N 次 title_unreadable 跨 ≥2 sender → dump → 修形 → 重启） | 🔄 本次新增 |
| FR-7 | skip reason 细分（title_unreadable vs is_group + 进 module_status reason） | 🔄 本次新增 |
| FR-8 | 待发队列 30min 过期上限（pending_retry 条目 age > 1800s 自动丢弃） | 🔄 本次新增 |

## 代码变更地图

```
修改  services/agent/wechat-rpa/listen_chat.py
      - 新增纯函数 assert_window_shape_for_title_read(is_zoomed, is_iconic, width, threshold) → bool
      - reply_in_chat：读标题前调用不变量，违反 → SW_MAXIMIZE 修形后再读
      - 新增梯度自愈计数器（连续 title_unreadable 跨 sender），触发时写 dump + 修形 + 重启
      - _SkipCounter.record 新增 'title_unreadable' reason；classify_unread 传递细分 reason
      - build_diag / module_status 透出 title_unreadable count
      - select_due_retries：加 age 检查（> 1800s 丢弃）

修改  services/agent/build-modules/line04/wechat-rpa/listen_chat.py
      (rsync 镜像同步)

新增  services/agent/wechat-rpa/tests/test_window_invariant.py
      - 纯逻辑单测：assert_window_shape_for_title_read（非最大化 / 最大化 / iconic 三态）
      - 连续读空计数器触发阈值单测（2 sender → 不触发；3 sender → 触发）
      - skip reason 细分单测（title_unreadable vs is_group 不混淆）
      - 变异测试点：注释修形调用 → 断言 SW_MAXIMIZE 未被调用 → 测试红

修改  .github/workflows/scripts/smoke/golden-path-4-smoke.sh
      Step 3l：grep listen_chat.py 验证含窗口形态不变量 + title_unreadable 细分（grep 锚）
```

## NFR

| # | 要求 |
|---|---|
| N-1 | 不变量函数 assert_window_shape_for_title_read 必须是纯函数（顶层零 pywinauto import），CI 可单测 |
| N-2 | 梯度自愈计数器复位条件：重启成功 / 进程重启 / sender 集合清空，不持久化到磁盘 |
| N-3 | 诊断 dump 写失败静默（try/except），绝不阻塞主链路 |
| N-4 | SW_MAXIMIZE 修形必须沿用现有 _WINDOW_HEAL_SETTLE_SLEEP=1.5s，不引入新 sleep 常量 |
| N-5 | title_unreadable skip reason 必须进 module_status.reason 字段（看板可见）；不可只写日志 |
| N-6 | pending_retry 过期丢弃只改 select_due_retries，不改 record_reply_failure 数据结构 |
| N-7 | 本次不重构扫描态窗口体操序列（结构性，归刀B后续） |
| N-8 | 本次不做腾讯新闻系统号过滤（独立 issue） |

## E2E 验收（smoke 定义完成）

smoke 文件：`.github/workflows/scripts/smoke/golden-path-4-smoke.sh`（在已有 Step 3 块追加 Step 3l）

关键断言（grep 锚，真机等价断言）：
1. `listen_chat.py` 含 `assert_window_shape_for_title_read` 函数定义
2. `listen_chat.py` 含 `title_unreadable` 字符串（skip reason 细分）
3. `listen_chat.py` 含连续读空计数器引用（`_consecutive_title_unreadable` 或等价变量名）
4. `listen_chat.py` 含 `zj-deadzone-dump.json` 路径字面量（诊断 dump）
5. `tests/test_window_invariant.py` 存在且含 `assert_window_shape_for_title_read` 测试

## 不做清单

- 扫描态窗口体操序列重构（结构性，归刀B后续）
- 腾讯新闻系统号过滤（独立 issue，ba30c507 §3 已标注）
- build-modules manifest.json 版本号 bump（已是 1.0.149，不重复 bump）

---

journey_type: user_facing
target_environment: windows_cloud
