# Contract DoD — Line04 半死区修复

## 元数据

| 字段 | 值 |
|------|-----|
| task_id | 5e9d608f-0386-4318-ac46-59273967999d |
| sprint_dir | sprints/07201740-half-deadzone-window-invariant |
| contract_version | v1（首轮） |

---

## [BEHAVIOR] 条目

### [BEHAVIOR-L1-1] 窗口非 iconic 且已最大化时，assert_window_shape_for_header 返回 True

**断言**：调用 `assert_window_shape_for_header(hwnd, ctypes_mod=<mock zoomed=True, iconic=False>)` 返回 `True`。

**验证方式**：pytest，`test_window_invariant.py::test_l1_zoomed_not_iconic_returns_true`

```python
def test_l1_zoomed_not_iconic_returns_true():
    result = listen_chat.assert_window_shape_for_header(hwnd=1, ctypes_mod=_make_ct(zoomed=1, iconic=0, w=1920))
    assert result is True
```

---

### [BEHAVIOR-L1-2] 窗口处于 iconic（最小化/托盘）时，assert_window_shape_for_header 返回 False（形态违规）

**断言**：iconic=True 时函数返回 `False`，调用方应先修形再读标题。

**验证方式**：pytest，`test_window_invariant.py::test_l1_iconic_returns_false`

```python
def test_l1_iconic_returns_false():
    result = listen_chat.assert_window_shape_for_header(hwnd=1, ctypes_mod=_make_ct(zoomed=0, iconic=1, w=1920))
    assert result is False
```

---

### [BEHAVIOR-L1-3] 窗口非最大化且宽度低于双栏阈值时，assert_window_shape_for_header 返回 False

**断言**：zoomed=False + iconic=False + 宽度 < 双栏阈值 → 返回 `False`。

**验证方式**：pytest，`test_window_invariant.py::test_l1_narrow_non_zoomed_returns_false`

```python
def test_l1_narrow_non_zoomed_returns_false():
    result = listen_chat.assert_window_shape_for_header(hwnd=1, ctypes_mod=_make_ct(zoomed=0, iconic=0, w=400))
    assert result is False
```

---

### [BEHAVIOR-L2-1] 跨 ≥2 个 sender 均连续失败达阈值时，should_heal_half_deadzone 触发自愈

**断言**：`should_heal_half_deadzone({"A": 3, "B": 3})` 返回 `True`。

**验证方式**：pytest，`test_window_invariant.py::test_l2_cross_sender_triggers_heal`

```python
def test_l2_cross_sender_triggers_heal():
    assert listen_chat.should_heal_half_deadzone({"A": 3, "B": 3}) is True
```

---

### [BEHAVIOR-L2-2] 仅单个 sender 连续失败时，should_heal_half_deadzone 不触发（防冷门联系人误触发重启）

**断言**：`should_heal_half_deadzone({"A": 3})` 返回 `False`。

**验证方式**：pytest，`test_window_invariant.py::test_l2_single_sender_no_heal`

```python
def test_l2_single_sender_no_heal():
    assert listen_chat.should_heal_half_deadzone({"A": 3}) is False
```

---

### [BEHAVIOR-L3-1] _SkipCounter 独立计数 title_unreadable 和 is_group 两个 reason

**断言**：record 3 次 `title_unreadable` 后，`snapshot()["total"]["title_unreadable"] == 3`；record 1 次 `is_group` 后 `snapshot()["total"]["is_group"] == 1`。

**验证方式**：pytest，`test_window_invariant.py::test_l3_skip_counter_two_reasons`

```python
def test_l3_skip_counter_two_reasons():
    c = listen_chat._SkipCounter()
    for _ in range(3):
        c.record("title_unreadable")
    c.record("is_group")
    snap = c.snapshot()
    assert snap["total"]["title_unreadable"] == 3
    assert snap["total"]["is_group"] == 1
```

---

### [BEHAVIOR-L4-1] 超过 max_age_seconds 的待发队列条目不被选中重试（防积压旧消息干扰）

**断言**：enqueued_at=0.0、now=1900.0、max_age_seconds=1800 → sender 不出现在 `select_due_retries` 结果中。

**验证方式**：pytest，`test_window_invariant.py::test_l4_expired_entry_excluded`

```python
def test_l4_expired_entry_excluded():
    pending = {}
    listen_chat.record_reply_failure(pending, sender="A", content="hi", reply="ok", now=0.0)
    due = listen_chat.select_due_retries(pending, now=1900.0, cooldown_seconds=60, max_age_seconds=1800)
    assert "A" not in due
```

---

## [BEHAVIOR] 总数：7 条

| ID | 层级 | 函数 | 触发条件 | 期望结果 |
|----|------|------|----------|---------|
| BEHAVIOR-L1-1 | L1 | assert_window_shape_for_header | zoomed=True, iconic=False | True |
| BEHAVIOR-L1-2 | L1 | assert_window_shape_for_header | iconic=True | False |
| BEHAVIOR-L1-3 | L1 | assert_window_shape_for_header | zoomed=False, iconic=False, w<阈值 | False |
| BEHAVIOR-L2-1 | L2 | should_heal_half_deadzone | {"A":3,"B":3} | True |
| BEHAVIOR-L2-2 | L2 | should_heal_half_deadzone | {"A":3} | False |
| BEHAVIOR-L3-1 | L3 | _SkipCounter.record | 3×title_unreadable + 1×is_group | 各自独立计数 |
| BEHAVIOR-L4-1 | L4 | select_due_retries | enqueued_at 超过 max_age_seconds | 不返回该 sender |

---

## manual:bash 验证命令

```bash
# 手动运行 sprint 新增单测（要求全绿）
cd /workspace && python3 -m pytest services/agent/wechat-rpa/tests/test_window_invariant.py -v 2>&1 | tail -20
```

```bash
# 手动运行 E2E Step 3l 等价断言（本地不含 Windows ctypes，仅验证纯函数部分）
cd /workspace && python3 -c "
import sys
sys.path.insert(0, 'services/agent/wechat-rpa')
import listen_chat
heal_fn = getattr(listen_chat, 'should_heal_half_deadzone', None)
assert heal_fn is not None, 'should_heal_half_deadzone 不存在'
assert heal_fn({'A': 3, 'B': 3}) is True
assert heal_fn({'A': 3}) is False
c = listen_chat._SkipCounter()
c.record('title_unreadable'); c.record('title_unreadable'); c.record('is_group')
snap = c.snapshot()
assert snap['total'].get('title_unreadable') == 2
assert snap['total'].get('is_group') == 1
pending = {}
listen_chat.record_reply_failure(pending, sender='A', content='hi', reply='ok', now=0.0)
due = listen_chat.select_due_retries(pending, now=1900.0, cooldown_seconds=60, max_age_seconds=1800)
assert 'A' not in due
print('PASS: manual:bash 等价断言全通过')
"
```

```bash
# 手动验证 grep 锚（关键符号已落地）
grep -c "assert_window_shape_for_header\|should_heal_half_deadzone\|title_unreadable\|zj-deadzone-dump\|enqueued_at" \
  /workspace/services/agent/wechat-rpa/listen_chat.py
```

```bash
# 手动验证 rsync 同步
diff -r /workspace/services/agent/wechat-rpa/ \
        /workspace/services/agent/build-modules/line04/wechat-rpa/ \
  --exclude="*.pyc" --exclude="__pycache__" && echo "rsync 一致" || echo "FAIL: 未同步"
```

```bash
# 手动验证 version bump
python3 -c "
import json
m1 = json.load(open('/workspace/services/agent/modules/line04/manifest.json'))['version']
m2 = json.load(open('/workspace/services/agent/build-modules/line04/manifest.json'))['version']
print(f'modules: {m1}  build-modules: {m2}')
assert m1 == '1.0.150', f'modules version 错误: {m1}'
assert m2 == '1.0.150', f'build-modules version 错误: {m2}'
print('PASS: version bump 正确')
"
```

---

## DoD 完成条件核对表

- [ ] `assert_window_shape_for_header` 纯函数存在，无 pywinauto 依赖
- [ ] `should_heal_half_deadzone` 纯函数存在，跨 sender 计数器逻辑正确
- [ ] `_SkipCounter` 支持 `title_unreadable` 和 `is_group` 两个独立 reason key
- [ ] `record_reply_failure` 写入 `enqueued_at` 字段
- [ ] `select_due_retries` 接受 `max_age_seconds` 参数并过期清除
- [ ] `_title_unreadable_counter` 模块级 dict 存在，跨 sender 计数
- [ ] `build_diag` 的 `skip_reasons` 含 `title_unreadable` 和 `is_group` 可独立查询
- [ ] dump 写盘路径 `%PUBLIC%\zj-deadzone-dump.json` 存在，失败不阻断发送
- [ ] `services/agent/wechat-rpa/tests/test_window_invariant.py` 7 case 全绿
- [ ] `golden-path-4-smoke.sh` Step 3l 段追加完毕
- [ ] manifest.json × 2 版本号均为 `1.0.150`
- [ ] rsync 同步后 diff 为空
