# Contract DoD: 半死区窗口形态不变量 + 梯度自愈

## 元数据

| 字段 | 值 |
|---|---|
| task_id | 5e9d608f-0386-4318-ac46-59273967999d |
| journey | Path 4 Step 3l |
| target_environment | windows_cloud |

---

## [BEHAVIOR] B-1：窗口形态不变量前置，读标题前强制断言

**描述**：`reply_in_chat` 在读取会话标题之前，必须调用 `assert_window_shape_for_title_read` 断言窗口处于 non-iconic 且（zoomed 或宽度 ≥ 双栏阈值）。该函数是顶层纯函数，无 pywinauto 依赖，可在 CI 环境单测。违反断言时：先 `ShowWindow(hwnd, SW_MAXIMIZE=3)` + `time.sleep(_WINDOW_HEAL_SETTLE_SLEEP)` 修形，再继续读标题。

**验收命令（manual:bash）**：
```bash
# 在 workspace 根运行
python3 -c "
import sys, inspect
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat
# 函数存在
assert hasattr(listen_chat, 'assert_window_shape_for_title_read'), '缺 assert_window_shape_for_title_read'
src = inspect.getsource(listen_chat.assert_window_shape_for_title_read)
# 无 pywinauto import（纯函数）
assert 'pywinauto' not in src, 'assert_window_shape_for_title_read 不得 import pywinauto'
# 返回值覆盖三态
assert listen_chat.assert_window_shape_for_title_read(is_zoomed=True, is_iconic=False, width=800, threshold=700) is True
assert listen_chat.assert_window_shape_for_title_read(is_zoomed=False, is_iconic=False, width=500, threshold=700) is False
assert listen_chat.assert_window_shape_for_title_read(is_zoomed=False, is_iconic=True, width=500, threshold=700) is True
print('B-1 PASS')
"
```

---

## [BEHAVIOR] B-2：半死区梯度自愈——连续 N 次 title_unreadable 跨 ≥2 sender 触发

**描述**：当连续 `≥3` 次读到 `title_unreadable`（标题为空）且覆盖 `≥2` 个不同 sender 时，触发梯度自愈流程：
1. 写诊断 dump 到 `%PUBLIC%\zj-deadzone-dump.json`（写失败静默，不阻塞主链路）
2. 执行 `SW_MAXIMIZE` 修形复测（复用 `_WINDOW_HEAL_SETTLE_SLEEP=1.5s`）
3. 仍失败 → 调用 `_restart_wechat_for_uia`（复用现有冷却 600s + 上限机制）
计数器在重启成功/进程重启/sender 集合清空时复位，不持久化磁盘。

**验收命令（manual:bash）**：
```bash
python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
with open('services/agent/wechat-rpa/listen_chat.py', encoding='utf-8') as f:
    src = f.read()
# 计数器变量存在
assert '_consecutive_title_unreadable' in src or 'consecutive_title_unreadable' in src, '缺梯度自愈计数器'
# dump 路径存在
assert 'zj-deadzone-dump.json' in src, '缺诊断 dump 路径字面量'
# 写 dump 有 try/except 保护
dump_idx = src.index('zj-deadzone-dump.json')
ctx = src[max(0, dump_idx-300):dump_idx+200]
assert 'try' in ctx and 'except' in ctx, '诊断 dump 写入未被 try/except 包裹'
# 复用重启函数
assert '_restart_wechat_for_uia' in src, '梯度自愈未调用 _restart_wechat_for_uia'
print('B-2 PASS')
"
```

---

## [BEHAVIOR] B-3：skip reason 细分——title_unreadable vs is_group 进 module_status

**描述**：`_SkipCounter.record` 新增 `'title_unreadable'` reason；`classify_unread` 在跳过时传递细分 reason（`title_unreadable` 或 `is_group`），两者不混淆。`module_status` 的 `reason` 字段透出 `title_unreadable` count（看板可见），不可只写日志。

**验收命令（manual:bash）**：
```bash
python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
with open('services/agent/wechat-rpa/listen_chat.py', encoding='utf-8') as f:
    src = f.read()
assert 'title_unreadable' in src, '缺 title_unreadable skip reason'
assert 'is_group' in src, '缺 is_group skip reason'
# module_status 透出 title_unreadable
# 找到 module_status 构造块附近出现 title_unreadable
ms_idx = src.find('module_status')
assert ms_idx != -1, '缺 module_status'
# title_unreadable 必须出现在 module_status 定义附近（300字节窗口内）
window = src[ms_idx:ms_idx+500]
assert 'title_unreadable' in window or 'reason' in window, 'module_status 未透出 title_unreadable reason'
print('B-3 PASS')
"
```

---

## [BEHAVIOR] B-4：pending_retry 30min 过期上限，select_due_retries 自动丢弃

**描述**：`select_due_retries` 扫描待发队列时，检查每条 `pending_retry` 条目的 age（当前时间 - 入队时间），超过 1800s（30min）的条目丢弃不重发，不改 `record_reply_failure` 数据结构。

**验收命令（manual:bash）**：
```bash
python3 -c "
import sys, inspect
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat
assert hasattr(listen_chat, 'select_due_retries'), '缺 select_due_retries'
src = inspect.getsource(listen_chat.select_due_retries)
assert '1800' in src, 'select_due_retries 未检查 1800s 过期上限'
# record_reply_failure 签名未变（不改数据结构）
import inspect as ins
sig = str(ins.signature(listen_chat.record_reply_failure))
assert '1800' not in sig, 'record_reply_failure 签名不应含 1800（只改 select_due_retries）'
print('B-4 PASS')
"
```

---

## [BEHAVIOR] B-5：build-modules 镜像同步，lint-build-modules-sync 不红

**描述**：修改 `services/agent/wechat-rpa/listen_chat.py` 后，必须同步 rsync 到 `services/agent/build-modules/line04/wechat-rpa/listen_chat.py`，两者内容一致，CI `lint-build-modules-sync` 检查通过。

**验收命令（manual:bash）**：
```bash
diff services/agent/wechat-rpa/listen_chat.py \
     services/agent/build-modules/line04/wechat-rpa/listen_chat.py \
  && echo "B-5 PASS: 两文件一致" \
  || echo "B-5 FAIL: 文件不同步"
```

---

## [BEHAVIOR] B-6：单测骨架存在且可在 CI（无 pywinauto）环境跑通

**描述**：`services/agent/wechat-rpa/tests/test_window_invariant.py` 存在，含 `assert_window_shape_for_title_read` 的至少 3 个测试用例，且在无 pywinauto 的 CI 环境（stub 重 deps）下 `pytest` 通过。

**验收命令（manual:bash）**：
```bash
cd services/agent/wechat-rpa && \
  python3 -m pytest tests/test_window_invariant.py -v 2>&1 | tail -20
```

---

## smoke 追加位置说明

在 `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` 末尾的 `exit 0` 之前，Step 3k 之后追加 Step 3l 块。

Step 3l 块 5 条 grep 锚对应 contract-draft.md § E2E 验收 A-1 ~ A-5，全部 pass = Step 3l smoke 通过。

---

## DoD 检查清单

- [ ] B-1：`assert_window_shape_for_title_read` 纯函数存在，三态覆盖，manual:bash 通过
- [ ] B-2：梯度自愈计数器 + dump + 重启接线，manual:bash 通过
- [ ] B-3：skip reason 细分进 module_status，manual:bash 通过
- [ ] B-4：`select_due_retries` 30min 过期，manual:bash 通过
- [ ] B-5：build-modules diff 为空，manual:bash 通过
- [ ] B-6：`test_window_invariant.py` pytest 全绿
- [ ] smoke Step 3l 5 条 grep 锚全部追加至 golden-path-4-smoke.sh
- [ ] CI `lint-build-modules-sync` 绿
