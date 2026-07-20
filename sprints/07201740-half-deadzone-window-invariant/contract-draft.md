# Contract Draft: 半死区窗口形态不变量 + 梯度自愈

## 元数据

| 字段 | 值 |
|---|---|
| task_id | 5e9d608f-0386-4318-ac46-59273967999d |
| sprint_dir | sprints/07201740-half-deadzone-window-invariant |
| journey | Path 4 客户私域 AI 接管（Line04 微信客服）Step 3l |
| target_environment | windows_cloud |
| contract_version | v1 |
| proposed_at | 2026-07-20 |

## 问题背景

reply_in_chat 读标题/判群前无窗口形态前置断言，当微信主窗口处于非 zoomed 且宽度不足双栏阈值（"半死区"）时，UIA 标题节点不渲染，导致 title 连续读空，现有代码无法区分"标题暂时读不到"与"此会话确实是群聊"，笼统 skip 造成消息漏回。连续跨多个 sender 的标题读空是半死区进入的信号，须触发梯度自愈（dump → 修形 → 重启），但目前无此机制。

## 本次交付范围

| # | Feature | 状态 |
|---|---|---|
| FR-5 | 窗口形态不变量前置（reply_in_chat 读标题前断言 non-iconic + zoomed/宽度 ≥ 双栏阈值） | 新增 |
| FR-6 | 半死区梯度自愈（连续 N≥3 次 title_unreadable 跨 ≥2 sender → dump → 修形 → 重启） | 新增 |
| FR-7 | skip reason 细分（title_unreadable vs is_group，进 module_status reason 字段） | 新增 |
| FR-8 | 待发队列 30min 过期上限（select_due_retries age > 1800s 自动丢弃） | 新增 |

不在本次范围：扫描态窗口体操序列重构（刀B）；腾讯新闻系统号过滤；版本号 bump。

## E2E 验收

### 验收层级

本 sprint 属 Windows 真机不可及段，采用 **grep 锚（代码等价断言）** 作为 CI 验收，真机段标注 TODO 留存。

### Smoke 验收（golden-path-4-smoke.sh Step 3l）

smoke 文件追加位置：`.github/workflows/scripts/smoke/golden-path-4-smoke.sh`（在 Step 3j/3k 块之后、final banner 之前追加 Step 3l 块）。

**5 条 grep 锚（每条 fail = smoke 失败）：**

| # | 锚断言 | 失败含义 |
|---|---|---|
| A-1 | `listen_chat.py` 含 `assert_window_shape_for_title_read` 函数定义 | 不变量函数未实现 |
| A-2 | `listen_chat.py` 含 `title_unreadable` 字符串 | skip reason 细分未落地 |
| A-3 | `listen_chat.py` 含连续读空计数器变量（`_consecutive_title_unreadable` 或等价名） | 梯度自愈计数器未落地 |
| A-4 | `listen_chat.py` 含 `zj-deadzone-dump.json` 路径字面量 | 诊断 dump 路径未实现 |
| A-5 | `tests/test_window_invariant.py` 存在且含 `assert_window_shape_for_title_read` | 单测骨架未创建 |

### 单测验收（pytest，windows_cloud CI 可跑）

文件：`services/agent/wechat-rpa/tests/test_window_invariant.py`

必须包含的测试场景：
1. `assert_window_shape_for_title_read` 纯逻辑三态（非最大化+非 iconic → False；zoomed → True；iconic → True）
2. 连续读空计数器：2 sender 不触发；3 sender 触发（阈值边界）
3. skip reason 细分：title_unreadable 与 is_group 不混淆（不同路径各自独立判定）
4. 变异测试点：注释修形调用 → 断言 SW_MAXIMIZE 未被调用 → 测试红（确保不变量绑定不可空转）

### NFR 验收约束

| # | 约束 | 验收手段 |
|---|---|---|
| N-1 | `assert_window_shape_for_title_read` 是顶层纯函数，零 pywinauto import | pytest 跑通即证明（CI 无 pywinauto 环境） |
| N-2 | 梯度自愈计数器复位：重启成功/进程重启/sender 集合清空，不持久化磁盘 | 单测模拟复位场景 |
| N-3 | 诊断 dump 写失败静默（try/except 包裹），不阻塞主链路 | grep 确认 try/except 包裹 |
| N-4 | SW_MAXIMIZE 修形沿用 `_WINDOW_HEAL_SETTLE_SLEEP=1.5s`，无新 sleep 常量 | grep listen_chat.py 无新 `sleep_` 常量 |
| N-5 | title_unreadable 进 module_status.reason 字段（看板可见）| grep module_status reason 引用 |
| N-6 | pending_retry 过期只改 select_due_retries，不改 record_reply_failure | grep 确认 record_reply_failure 签名未变 |

### 文件同步验收

| 文件 | 验收 |
|---|---|
| `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` | diff 与 wechat-rpa/listen_chat.py 相同（rsync 镜像） |

## 不做清单（本次显式排除）

- 扫描态窗口体操序列重构（结构性，归刀B）
- 腾讯新闻系统号过滤（独立 issue，ba30c507 §3 标注）
- build-modules manifest.json 版本号 bump（已是 1.0.149）
- 多 sender 矩阵自动化（真机段 TODO，非本次范围）
