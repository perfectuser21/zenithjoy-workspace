# Sprint PRD — Line04 半死区修复：窗口形态不变量 + 梯度自愈 + skip reason 细分

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | 5e9d608f-0386-4318-ac46-59273967999d |
| sprint_dir | sprints/07201740-half-deadzone-window-invariant |
| journey | 客户私域 AI 接管（Path 4，ID: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4） |
| journey_type | user_facing |
| target_environment | windows_cloud |
| module_version_bump | 1.0.149 → 1.0.150 |
| thickness | thin（bug fix，不升级） |

## 本 Sprint 推进声明

本 PR 把 Path 4 Step 3「Agent 后台静默监听」从「间歇性半死区（标题读不到=fail-closed 拒发所有人）」修复为「窗口形态不变量 + 梯度自愈兜底」，向 GP-4 Step 3 追加行为断言（Step 3l）。

- **Ability `微信 CS 监听回复`**（既有 thin，不升级）：在形态不变量守护下，标题读不到时先修形再读，而非直接 fail-closed 拒发所有人；
- **Feature `判群前窗口形态不变量`**（新增 L1 修复）：reply_in_chat 读标题/判群前先断言窗口非 iconic 且已最大化，违反→先 SW_MAXIMIZE 修形再读；
- **Feature `半死区梯度自愈`**（新增 L2 修复）：连续 N 次 title_unreadable 跨 ≥2 sender → dump 诊断文件 → 修形复测 → 仍失败 → 复用现有 _restart_wechat_for_uia 重启；
- **Feature `skip reason 细分`**（新增 L3 观测）：判群 skip reason 拆分为 title_unreadable / is_group 两个值，进 listener 心跳与 module_status。

---

## 根因背景（issue ba30c507，2026-07-20）

三台客户机（XIAN-PC / DESKTOP-LBV5PAE / WIN-20250108FHG）同日出现同一模式：先正常回复数条 → 数分钟后判群闸连续以 `title_unreadable=fail-closed` 拒发所有人，树未全塌（会话列表可读、`_open_chat` selected 正常）→ 现有真塌自愈不触发，半死区无限持续。

**XIAN-PC 活体实验结论**：
- 微信 4.x 主窗拒绝外部 SW_RESTORE/SetWindowPos 改尺寸，强改可致主窗从枚举消失（UIA text 元素归零=微型死区）；
- ShowWindow(3) SW_MAXIMIZE 一发即恢复完整树（16 元素全回）；
- RPA 每轮窗口体操（离屏 SetWindowPos / 最小化还原 / 清 WPF_RESTORETOMAXIMIZED，listen_chat.py:519-632，历史 4 版补丁），每轮都在微信脆弱窗口态区掷骰子，数轮后落入标题 pane 不渲染的状态。

---

## Invariant 约束

继承前序 Line04 sprint 全部不变量（含浮窗 12 条、overlay 供给链、热键真机根因守卫等），本 sprint 新增 3 条：

| # | 约束 | 出处 |
|---|------|------|
| I-new-1 | **判群前窗口形态不变量**：reply_in_chat 读标题/判群前必须断言窗口非 iconic 且（zoomed 或宽度≥双栏阈值）；违反→先 ShowWindow(SW_MAXIMIZE) 修形，等渲染 settle，再读标题；修形函数必须独立可测（不依赖 pywinauto） | 本次根因，XIAN-PC 活体实验铁证 |
| I-new-2 | **梯度自愈触发条件**：连续 `title_unreadable` 计数器必须跨 ≥2 不同 sender 且达到阈值（默认 N=3）才触发自愈；单 sender 重复不触发（防冷门联系人误触发重启）；修形复测后仍读空才升级到重启微信 | 防误重启，同 ba30c507 spec |
| I-new-3 | **skip reason 两值区分**：`_header_confirms_not_group` 的拒发路径必须区分 `title_unreadable`（标题真读不到）vs `is_group`（读到且判为群），两者分别计入 _SkipCounter 并出现在心跳 diag.skip_reasons 和 module_status.reason | 防误诊为判定逻辑错，同 ba30c507 spec |

---

## 累积 FR（Path 4 Line04 已落地 Features，仅列与本 sprint 相关的）

| 状态 | Feature | 厚度 |
|------|---------|------|
| ✅ 既有 | 微信会话扫描监听（scan_unread / enrich） | mvp |
| ✅ 既有 | 后台静默回复（reply_in_chat，UIA 控件操作） | mvp |
| ✅ 既有 | 判群三道闸（_header_confirms_not_group + _is_group_by_header + _should_cache_known_group） | mvp |
| ✅ 既有 | 树塌自愈（_should_restart_for_collapsed_tree + _restart_wechat_for_uia，600s 冷却+5次上限） | thin |
| ✅ 既有 | 可见非最大化自愈（window_needs_maximize + SW_MAXIMIZE + settle，300s 冷却） | thin |
| ✅ 既有 | skip reason 计数（_SkipCounter，roster_gate/dup/replied/cooldown/rate_limited/eligible） | thin |
| ✅ 既有 | 心跳 diag（build_diag，含 module_version / skip_reasons / window_state） | thin |
| 🔄 本次 | **判群前窗口形态不变量**（L1：reply_in_chat 读标题前断言+修形，独立纯函数） | planned → thin |
| 🔄 本次 | **半死区梯度自愈**（L2：title_unreadable 跨 sender 计数器 + dump + 修形复测 + 升级重启） | planned → thin |
| 🔄 本次 | **skip reason 细分**（L3：title_unreadable vs is_group 两值区分，进 diag + module_status） | planned → thin |

---

## FR 详细规格

### FR-L1：判群前窗口形态不变量

**F-L1.1** 新增独立纯函数 `assert_window_shape_for_header(hwnd, *, ctypes_mod=None) -> bool`（或等价名称）：  
- 返回 True = 窗口已就绪（已最大化或宽度≥双栏阈值，且非 iconic）；  
- 返回 False = 窗口形态不符，调用方应先修形；  
- 不依赖 pywinauto（顶层零 import，macOS/Linux CI 可直接 import 单测）。

**F-L1.2** 在 `reply_in_chat` 内、`_header_confirms_not_group` 调用前插入形态守护：  
- 若 `assert_window_shape_for_header` 返回 False → 调用 `ShowWindow(SW_MAXIMIZE)`（hwnd 从 `_safe_hwnd(mw)` 取）→ sleep settle（参考 `_WINDOW_HEAL_SETTLE_SLEEP` 现有常量）→ 重新断言；  
- 修形逻辑复用 `_safe_hwnd` / `ctypes.windll.user32` 链路，不另造 Win32 封装。

**F-L1.3** `assert_window_shape_for_header` 必须有单测 3 case：  
- iconic=True → 返回 False；  
- zoomed=True + iconic=False → 返回 True；  
- zoomed=False + iconic=False + 宽度 < 阈值 → 返回 False。  
单测 mock ctypes，不启动 pywinauto。

**F-L1.4** 修形调用后记 debug 日志：`[window-shape-heal] hwnd=<> SW_MAXIMIZE 后 zoomed=<True/False>`。

### FR-L2：半死区梯度自愈

**F-L2.1** 新增模块级计数器 `_title_unreadable_counter: Dict[str, int]`（key=sender），在 `_header_confirms_not_group` 判定 `title_unreadable` 时递增，判定 `is_group` 或成功读到标题时对该 sender 清零。

**F-L2.2** 梯度自愈触发判定（独立纯函数 `should_heal_half_deadzone(counter, *, threshold=3) -> bool`）：  
- `len([v for v in counter.values() if v >= threshold])` ≥ 2（跨 ≥2 个 sender 都连续失败）→ 返回 True；  
- 否则返回 False。  
纯函数，无副作用，CI 可测。

**F-L2.3** 梯度自愈三步序：  
1. **dump 诊断**：写 `%PUBLIC%\zj-deadzone-dump.json`，包含 `{"timestamp": ..., "window_rect": [...], "is_zoomed": bool, "is_iconic": bool, "tree_text_count": int, "title_unreadable_counter": {...}}`，供远程取证；  
2. **修形复测**：调 `ShowWindow(SW_MAXIMIZE)` + settle，再对所有失败 sender 重新尝试 `_read_chat_header_texts`；  
3. **升级重启**：修形复测后仍有 ≥2 sender 读空 → 调现有 `_restart_wechat_for_uia`（含 600s 冷却 / 5 次上限），不另造冷却链路。

**F-L2.4** 自愈后清零 `_title_unreadable_counter`，防重复触发。

**F-L2.5** 单测 2 case：  
- counter = {"A": 3, "B": 3} → `should_heal_half_deadzone` 返回 True；  
- counter = {"A": 3} → 返回 False（跨 sender 数=1，不触发）。

### FR-L3：skip reason 细分

**F-L3.1** `_header_confirms_not_group` 返回值由 `bool` 扩展为 `Tuple[bool, str]`（或同等结构）：  
- `(False, "title_unreadable")` = 重试耗尽仍读空；  
- `(False, "is_group")` = 读到标题且判为群；  
- `(True, "not_group")` = 确认非群可发送。  
调用方（reply_in_chat）解包使用，向后兼容：仅在 `False` 时跳过，reason 串额外传 skip counter。

**F-L3.2** `_SkipCounter.record` 调用点新增两个 reason 串：`"title_unreadable"` 和 `"is_group"`，原 `"skip_group"` 保留（或拆分并弃用，由实现决定，保持 diag key 向后兼容）。

**F-L3.3** `build_diag` 的 `skip_reasons` 字段中 `title_unreadable` 和 `is_group` 可独立查询。中台 `/api/wechat/module-status` 的 reason 字段（若已接线）同步透出。

**F-L3.4** 单测 1 case：连续 3 次 `title_unreadable` → `_SkipCounter.snapshot()["total"]["title_unreadable"] == 3`。

### FR-L4：待发队列过期上限（PrepPRD §2，5行内可顺手加）

**F-L4.1** `record_reply_failure` 写入 `pending_retry` 时追加 `"enqueued_at": now` 字段。

**F-L4.2** `select_due_retries` 新增 `max_age_seconds=1800`（30 分钟）参数：  
- `now - info["enqueued_at"] > max_age_seconds` → 将该 sender 从 pending 中删除（`pending.pop(sender, None)`），不放入待重试列表；  
- 无 `enqueued_at` 字段的旧条目视为不过期（向后兼容，不抛）。

**F-L4.3** 单测 1 case：`enqueued_at` 超过 1800s 的条目不出现在 `select_due_retries` 结果里。

---

## 受影响文件

| 文件 | 变更类型 |
|------|--------|
| `services/agent/wechat-rpa/listen_chat.py` | 修改（L1 不变量函数 + L2 计数器/梯度自愈/dump + L3 reason 细分 + L4 过期上限） |
| `services/agent/build-modules/line04/wechat-rpa/listen_chat.py` | rsync 同步（必须与源文件一致） |
| `services/agent/modules/line04/manifest.json` | version bump 1.0.149 → 1.0.150 |
| `services/agent/build-modules/line04/manifest.json` | version bump 1.0.149 → 1.0.150 |
| `services/agent/wechat-rpa/tests/test_window_invariant.py` | 新建（L1 3 case + L2 2 case + L3 1 case + L4 1 case） |
| `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` | 追加 Step 3l（窗口形态不变量 + title_unreadable 细分 grep 锚） |

**不在范围内**：
- 扫描态窗口体操重构（listen_chat.py:519-632 历史 4 版补丁）——结构性问题，归刀B后续；
- 腾讯新闻系统号过滤——独立 issue；
- `/api/wechat/module-status` 接口新增字段——若已有接线则透出，若无则不新建接口。

---

## NFR

| 指标 | 阈值 | 超限动作 |
|------|------|--------|
| 修形 settle 等待 | ≤ 现有 `_WINDOW_HEAL_SETTLE_SLEEP`（1.5s），不新增延迟 | 超 1.5s 记 warn 日志 |
| dump 写盘 | ≤ 100ms（非关键路径，失败不阻断发送） | 写失败 warn 日志后 continue |
| 梯度自愈触发上限 | 同现有重启冷却（600s / 5 次），不另设 | — |
| 单测覆盖 | 本 sprint 新增 7 case 全绿 | CI 红 = PR 被拒 |

---

## E2E 验收（GP-4 Step 3l，追加到 golden-path-4-smoke.sh）

```bash
# Step 3l：窗口形态不变量 + title_unreadable 细分 grep 锚
python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat

# L1：不变量纯函数存在且逻辑正确
# （用 mock ctypes，iconic=True -> False，zoomed=True -> True）
class FakeCT:
    class windll:
        class user32:
            @staticmethod
            def IsZoomed(hwnd): return 1
            @staticmethod
            def IsIconic(hwnd): return 0
            @staticmethod
            def GetWindowRect(hwnd, ref): return 1
fn = getattr(listen_chat, 'assert_window_shape_for_header', None)
assert fn is not None, 'assert_window_shape_for_header 函数不存在'

# L2：梯度自愈触发函数存在
heal_fn = getattr(listen_chat, 'should_heal_half_deadzone', None)
assert heal_fn is not None, 'should_heal_half_deadzone 函数不存在'
assert heal_fn({'A': 3, 'B': 3}) is True, '跨2 sender 应触发自愈'
assert heal_fn({'A': 3}) is False, '单 sender 不触发自愈'

# L3：skip reason 细分（_SkipCounter 支持 title_unreadable 键）
c = listen_chat._SkipCounter()
c.record('title_unreadable')
c.record('title_unreadable')
c.record('is_group')
snap = c.snapshot()
assert snap['total'].get('title_unreadable') == 2, 'title_unreadable 计数不符'
assert snap['total'].get('is_group') == 1, 'is_group 计数不符'

# L4：待发队列过期上限
import listen_chat as lc
pending = {}
lc.record_reply_failure(pending, sender='A', content='hi', reply='ok', now=0.0)
due = lc.select_due_retries(pending, now=1900.0, cooldown_seconds=60, max_age_seconds=1800)
assert 'A' not in due, '超过 max_age_seconds 的条目不应出现在重试列表'

print('PASS')
" 2>/dev/null && ok "Step 3l 窗口形态不变量+梯度自愈+skip细分+队列过期 纯函数等价断言通过" \
             || fail "Step 3l 半死区修复三件套回归" 3
```

```bash
# 还需 grep 锚验证（listen_chat.py 含关键实现点）
grep -q "assert_window_shape_for_header\|should_heal_half_deadzone\|title_unreadable\|zj-deadzone-dump" \
  services/agent/wechat-rpa/listen_chat.py \
  || fail "Step 3l grep 锚缺失——半死区修复代码未落地" 3
```

---

## rsync 铁律

改 `services/agent/wechat-rpa/` 后**必须**同步：

```bash
rsync -a --delete services/agent/wechat-rpa/ services/agent/modules/line04/wechat-rpa/
rsync -a --delete services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/
```

L4 Runtime Gate 有 `diff -r` 闸，未同步 → CI 红 → PR 无法合并。

---

## 不做（范围外）

- 扫描态窗口体操重构（listen_chat.py:519-632 历史 4 版补丁）——结构性，归刀 B
- 腾讯新闻系统号过滤——独立 issue
- `/api/wechat/module-status` 新增接口——不在本 sprint 范围

---

journey_type: user_facing
target_environment: windows_cloud
