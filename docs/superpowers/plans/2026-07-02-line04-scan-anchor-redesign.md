# Line04 锚点气泡扫描重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根治 Line04 客服漏消息——扫描判据从"角标/预览"换成"聊天面板真实气泡里最后一条 outgoing 之后的 trailing incoming"。

**Architecture:** 发现层保留角标+预览变化仅作触发信号；对触发会话打开读全部可见气泡（方向按几何推导），系统气泡剔除后按锚点切分 trailing incoming 合并成一条回；replied/last_preview 只在 DELIVERED 后事务提交。全部核心逻辑为顶层零 pywinauto 纯函数（Fake 注入 CI 可测）。

**Tech Stack:** Python 3.12 / pywinauto UIA / pytest。Spec：`docs/superpowers/specs/2026-07-02-line04-scan-anchor-redesign-design.md`（必读）。

**环境死规矩（每个任务都适用）：**
- 工作目录：`/Users/administrator/worktrees/zenithjoy/line04-scan-anchor`（分支 cp-07021502-line04-scan-anchor）。
- 改 `services/agent/wechat-rpa/**` 的每个 commit 后**同步 rsync 副本**：`rsync -a --delete --exclude='*.pyc' --exclude='__pycache__' services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/`，且 `git add services/agent/build-modules/line04/wechat-rpa`（CI `diff -r` 校验含 tests/）。
- 测试命令都在 `services/agent/wechat-rpa/` 下跑：`python3 -m pytest tests/<file> -q`。
- 新测试文件顶部必须带 `# -*- coding: utf-8 -*-`（self-hosted Windows GBK 坑）。
- TDD 铁律：NO PRODUCTION CODE WITHOUT FAILING TEST FIRST；每个任务 commit-1 = failing test（红），commit-2 = 实现（绿）。
- 日志脱敏：新代码日志不打消息明文（用 `len=N` / 前 8 字掩码）。

---

### Task 1: 系统气泡识别纯函数 `_is_system_bubble` / `strip_system_bubbles`

时间戳/撤回/拍一拍等居中系统 Text 会被几何判成 outgoing 并劫持锚点（把之前的 incoming 全切掉），必须从序列剔除。

**Files:**
- Create: `services/agent/wechat-rpa/tests/test_bubble_anchor.py`
- Modify: `services/agent/wechat-rpa/listen_chat.py`（加在 `read_chat_panel_messages`（L223）之前，`_parse_item_name` 同区块）

- [ ] **Step 1: 写 failing test**

```python
# -*- coding: utf-8 -*-
"""锚点气泡扫描纯函数守卫：系统气泡剔除 + trailing incoming 切分。

守卫契约（proven-to-fire）：把 strip_system_bubbles 改成不剔除时间戳，
test_timestamp_does_not_hijack_anchor 必红（时间戳被判 outgoing 劫持锚点，
把之前的 incoming 全切掉 → 复现漏回）。
顶层零 pywinauto，纯 Fake 注入。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


def _b(text, direction):
    return {"text": text, "direction": direction}


# ── _is_system_bubble ────────────────────────────────────────────────────────

def test_pure_time_is_system():
    for t in ["14:32", "9:05", "昨天 14:32", "前天 08:00", "星期二 09:05",
              "周三 21:00", "2026年7月1日 14:32", "7月1日 14:32"]:
        assert listen_chat._is_system_bubble(t), t


def test_recall_and_pat_are_system():
    for t in ['"客户A" 撤回了一条消息', "你撤回了一条消息", "客户A拍了拍你", "以下是新消息"]:
        assert listen_chat._is_system_bubble(t), t


def test_normal_messages_not_system():
    for t in ["在吗", "什么价格", "价格 14:32 前有效", "我 7月1日 到货可以吗", "[图片]"]:
        assert not listen_chat._is_system_bubble(t), t


def test_strip_system_bubbles_keeps_order():
    bubbles = [_b("在吗", "incoming"), _b("14:32", "outgoing"), _b("发下资料", "incoming")]
    assert listen_chat.strip_system_bubbles(bubbles) == [
        _b("在吗", "incoming"), _b("发下资料", "incoming")]
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_bubble_anchor.py -q`
Expected: FAIL（`AttributeError: module 'listen_chat' has no attribute '_is_system_bubble'`）

- [ ] **Step 3: commit-1（仅测试文件 + rsync 副本）**

```bash
git add services/agent/wechat-rpa/tests/test_bubble_anchor.py
rsync -a --delete --exclude='*.pyc' --exclude='__pycache__' services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/
git add services/agent/build-modules/line04/wechat-rpa
git commit -m "test(line04): 系统气泡剔除失败测试（锚点劫持守卫，红）"
```

- [ ] **Step 4: 最小实现**

在 `listen_chat.py` 顶部 import 区确认已有 `import re`（没有则在 `_parse_item_name` 上方函数内已有 `import re as _re` 先例——本函数用模块级 `import re`，加到文件顶部 import 块）。在 `read_chat_panel_messages` 定义之前插入：

```python
# ─── 锚点气泡扫描：系统气泡识别（纯函数，CI 可测）─────────────────────────────
# 时间戳/撤回/拍一拍/新消息分隔线在聊天面板里是居中 Text，按几何会被判 outgoing，
# 若参与锚点判定会把之前的 incoming 全切掉（锚点劫持）→ 必须从序列剔除。
import re as _sysre

_SYS_TIME_RE = _sysre.compile(
    r"^(?:昨天|前天|星期[一二三四五六日天]|周[一二三四五六日天]|"
    r"\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日)?\s*\d{1,2}:\d{2}$"
)
_SYS_PATTERNS = (
    _sysre.compile(r"^.{0,30}撤回了一条消息$"),
    _sysre.compile(r"^.{0,20}拍了拍.{0,20}$"),
    _sysre.compile(r"^以下是新消息$"),
)


def _is_system_bubble(text: str) -> bool:
    """判断气泡文本是否系统气泡（时间戳/撤回/拍一拍/分隔线）。

    有界匹配（fullmatch）防误伤正常消息（"价格 14:32 前有效" 不剔）；
    客户消息恰好整句命中（如原文只发"你撤回了一条消息"）会被误剔——代价是该条
    不进合并上下文，不丢回复触发，可接受。
    """
    t = (text or "").strip()
    if not t:
        return True
    if _SYS_TIME_RE.match(t):
        return True
    return any(p.match(t) for p in _SYS_PATTERNS)


def strip_system_bubbles(bubbles: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """剔除系统气泡，保序。bubbles: [{"text","direction"}]。"""
    return [b for b in bubbles if not _is_system_bubble(b.get("text", ""))]
```

- [ ] **Step 5: 跑测试确认绿 + commit-2**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/test_bubble_anchor.py -q` → PASS

```bash
git add services/agent/wechat-rpa/listen_chat.py
rsync -a --delete --exclude='*.pyc' --exclude='__pycache__' services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/
git add services/agent/build-modules/line04/wechat-rpa
git commit -m "feat(line04): 系统气泡识别纯函数（防锚点劫持）"
```

---

### Task 2: 锚点切分纯函数 `split_trailing_incoming`（含主 bug 复现）

**Files:**
- Modify: `services/agent/wechat-rpa/tests/test_bubble_anchor.py`（追加）
- Modify: `services/agent/wechat-rpa/listen_chat.py`（紧跟 Task 1 函数后）

- [ ] **Step 1: 追加 failing test（含主 bug 复现 fixture）**

```python
# ── split_trailing_incoming ──────────────────────────────────────────────────

def test_main_bug_five_messages_three_leaked():
    """主 bug 复现（2026-07-02 服务端证据）：连发5条、回1条后又来3条，
    角标已清、preview 只见最后一条——旧机制全漏，新机制必须取出 trailing 3 条。"""
    bubbles = [
        _b("在吗", "incoming"),
        _b("什么价格", "incoming"),
        _b("您好，价格是99元", "outgoing"),
        _b("我想买好产品", "incoming"),
        _b("发下资料", "incoming"),
        _b("你们公司信息", "incoming"),
    ]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == [
        "我想买好产品", "发下资料", "你们公司信息"]


def test_timestamp_does_not_hijack_anchor():
    """时间戳夹在客户连发中间：剔除后锚点仍是真 outgoing，trailing 完整。"""
    bubbles = listen_chat.strip_system_bubbles([
        _b("您好，价格是99元", "outgoing"),
        _b("我想买好产品", "incoming"),
        _b("14:32", "outgoing"),  # 居中时间戳被几何判 outgoing
        _b("发下资料", "incoming"),
    ])
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == [
        "我想买好产品", "发下资料"]


def test_last_outgoing_no_trailing():
    """我方/人工回复是最后一条 → trailing 空 → 不回（人工优先天然正确）。"""
    bubbles = [_b("在吗", "incoming"), _b("好的收到", "outgoing")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == []


def test_no_outgoing_no_badge_not_reply():
    """从未回过 + 无角标（陈年会话被预览扰动误触发）→ 绝不翻旧账。"""
    bubbles = [_b("半年前的消息", "incoming"), _b("没人理我", "incoming")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == []


def test_no_outgoing_with_badge_takes_min():
    """从未回过 + 角标 N=2 → 只取最后 2 条 incoming（min(N, 可见)）。"""
    bubbles = [_b("旧消息", "incoming"), _b("新1", "incoming"), _b("新2", "incoming")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=2) == ["新1", "新2"]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=9) == ["旧消息", "新1", "新2"]


def test_placeholder_bubbles_counted():
    """非文本消息占位符计入 incoming，绝不透明化（纯图片批也触发回复）。"""
    bubbles = [_b("好的", "outgoing"), _b("[图片]", "incoming"), _b("[语音]", "incoming")]
    assert listen_chat.split_trailing_incoming(bubbles, badge_n=0) == ["[图片]", "[语音]"]
```

- [ ] **Step 2: 跑红** → `python3 -m pytest tests/test_bubble_anchor.py -q` FAIL（no attribute）

- [ ] **Step 3: commit-1**（同 Task 1 Step 3 手法，消息 `test(line04): 锚点切分失败测试（含连发5条漏3条主bug复现，红）`）

- [ ] **Step 4: 实现**

```python
def split_trailing_incoming(bubbles: List[Dict[str, str]], badge_n: int = 0) -> List[str]:
    """锚点切分（纯函数）：返回"最后一条 outgoing 气泡之后"的全部 incoming 文本。

    - bubbles 有序（上→下=旧→新），须已过 strip_system_bubbles。
    - 锚点 = 最后一条 outgoing（我方/AI/人工回复都算；人工回过 → trailing 空 → 不回）。
    - 无 outgoing（从未回过）：仅当 badge_n>0 才取最后 min(badge_n, 可见) 条 incoming；
      无角标 → 返回 []（防预览扰动翻出陈年消息）。
    - 自回复风暴天然免疫：只取 incoming，机器人 outgoing 即锚点。
    """
    last_out = -1
    for i, b in enumerate(bubbles):
        if b.get("direction") == "outgoing":
            last_out = i
    tail = [b.get("text", "") for b in bubbles[last_out + 1:]
            if b.get("direction") == "incoming" and b.get("text")]
    if last_out >= 0:
        return tail
    if badge_n > 0 and tail:
        return tail[-min(badge_n, len(tail)):]
    return []
```

- [ ] **Step 5: 跑绿 + commit-2**（消息 `feat(line04): 锚点切分纯函数——最后outgoing之后的trailing incoming`）

---

### Task 3: 气泡读取 `read_chat_bubbles(mw)`

**Files:**
- Create: `services/agent/wechat-rpa/tests/test_read_chat_bubbles.py`
- Modify: `services/agent/wechat-rpa/listen_chat.py`（加在 `_last_bubble_direction`（L1579）旁）

- [ ] **Step 1: failing test（照抄 test_msg_direction.py 的 `_Rect/_EI/_Text/_MW` Fake 模板）**

```python
# -*- coding: utf-8 -*-
"""read_chat_bubbles 守卫：读当前会话全部可见气泡（上→下有序 + 方向），几何全相对推导。

窗口 Fake (0,0)-(800,600)：chat_left=200，midline=500（同 test_msg_direction.py 约定）。
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _Rect:
    def __init__(self, l, t, r, b):
        self.left, self.top, self.right, self.bottom = l, t, r, b


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _Text:
    def __init__(self, name, rect):
        self.element_info = _EI(name=name)
        self._rect = rect

    def rectangle(self):
        return self._rect


class _MW:
    def __init__(self, texts, rect=None):
        self.element_info = _EI()
        self._texts = texts
        self._rect = rect or _Rect(0, 0, 800, 600)

    def rectangle(self):
        return self._rect

    def descendants(self, control_type=None):
        return list(self._texts) if control_type == "Text" else []


_TITLE = _Text("客户A", _Rect(300, 20, 600, 50))       # 标题区 top<150 → 排除
_LIST = _Text("客户A\n[2条]\n在吗\n12:00", _Rect(10, 80, 180, 130))  # 左列 → 排除


def test_ordered_top_to_bottom_with_direction():
    """乱序 descendants → 按 r.top 排序输出；左=incoming 右=outgoing。"""
    mw = _MW([
        _TITLE, _LIST,
        _Text("发下资料", _Rect(210, 480, 380, 520)),     # 下（新）incoming
        _Text("好的稍等", _Rect(600, 300, 770, 340)),     # 上（旧）outgoing
    ])
    assert listen_chat.read_chat_bubbles(mw) == [
        {"text": "好的稍等", "direction": "outgoing"},
        {"text": "发下资料", "direction": "incoming"},
    ]


def test_midline_and_empty_name():
    """压线判 outgoing（保守）；空 name 跳过。"""
    mw = _MW([_Text("压线", _Rect(420, 300, 580, 340)), _Text("", _Rect(210, 400, 380, 440))])
    assert listen_chat.read_chat_bubbles(mw) == [{"text": "压线", "direction": "outgoing"}]


def test_ghost_offscreen_returns_empty():
    """幽灵坐标（±32000）→ []（fail-closed；正常离屏 -2600 不受影响）。"""
    mw = _MW([_Text("在吗", _Rect(-31790, 480, -31620, 520))],
             rect=_Rect(-32000, -32000, -31200, -31400))
    assert listen_chat.read_chat_bubbles(mw) == []


def test_normal_offscreen_still_reads():
    """扫描态窗口在 OFFSCREEN_X=-2600：几何相对推导必须照常工作。"""
    mw = _MW([_Text("在吗", _Rect(-2390, 480, -2220, 520))],
             rect=_Rect(-2600, 60, -1800, 660))
    assert listen_chat.read_chat_bubbles(mw) == [{"text": "在吗", "direction": "incoming"}]
```

- [ ] **Step 2: 跑红** → FAIL no attribute
- [ ] **Step 3: commit-1**（`test(line04): read_chat_bubbles 失败测试（有序+方向+几何相对推导，红）`）
- [ ] **Step 4: 实现（加在 `_last_bubble_direction` 函数之后）**

```python
def read_chat_bubbles(mw: Any) -> List[Dict[str, str]]:
    """读当前打开会话聊天面板全部可见消息气泡，上→下有序，每条 {"text","direction"}。

    - 几何全部从窗口 rectangle 推导（chat_left = 左+宽//4，midline 同
      _last_bubble_direction）——铁律禁止写死绝对坐标（read_chat_panel_messages
      的 x_min=460 之坑）。
    - direction：气泡中心 x < midline → incoming；>= → outgoing（压线判我方，保守）。
    - 幽灵坐标（|left|>20000，同 _open_chat 守卫）/ 读不到 → []（fail-closed，
      调用方走回退路径）；正常扫描离屏位 OFFSCREEN_X≈-2600 不受影响。
    - descendants 顺序不可信 → 显式按 r.top 排序。
    顶层零-pywinauto 纯函数（Fake 注入可测，同 _last_bubble_direction 约定）。
    """
    try:
        wr = mw.rectangle()
    except Exception:
        return []
    if abs(wr.left) > 20000 or abs(wr.top) > 20000:
        return []
    width = wr.right - wr.left
    if width <= 0:
        return []
    chat_left = wr.left + width // 4
    midline = (chat_left + wr.right) // 2
    rows: List[Any] = []
    try:
        texts = mw.descendants(control_type="Text")
    except Exception:
        return []
    for t in texts:
        try:
            r = t.rectangle()
            nm = (t.element_info.name or "").strip()
        except Exception:
            continue
        if not nm or r.left <= chat_left or r.top < wr.top + 150:
            continue
        center = (r.left + r.right) // 2
        rows.append((r.top, {"text": nm,
                             "direction": "outgoing" if center >= midline else "incoming"}))
    rows.sort(key=lambda x: x[0])
    return [b for _, b in rows]
```

- [ ] **Step 5: 跑绿 + commit-2**（`feat(line04): read_chat_bubbles 气泡读取（相对几何+有序+方向）`）

---

### Task 4: 重构 `scan_unread` 为锚点气泡扫描

**Files:**
- Create: `services/agent/wechat-rpa/tests/test_scan_trigger.py`
- Delete: `services/agent/wechat-rpa/tests/test_scan_unread_path2_content_change.py`（其守卫契约被 test_scan_trigger.py 等价替代——见 Step 1 case 2/5）
- Modify: `services/agent/wechat-rpa/listen_chat.py:465-535`（scan_unread 重写）

- [ ] **Step 1: failing test（Fake ListItem + monkeypatch _open_chat/read_chat_bubbles）**

```python
# -*- coding: utf-8 -*-
"""锚点气泡扫描 scan_unread 重构守卫（替代 test_scan_unread_path2_content_change.py）。

守卫契约（proven-to-fire）：
- case trigger_by_preview_change：把预览变化触发删掉（回到只认角标）→ 必红（复现
  "会话打开后角标被清、消息永久漏读"——2026-07-02 连发5条漏3条主 bug 的发现层）。
- case open_fail_keeps_trigger：触发态在失败路径被消费 → 必红（新机制的事务性）。
顶层零 pywinauto，monkeypatch 打开/读气泡。
"""
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_WECHAT = os.path.abspath(os.path.join(_HERE, ".."))
if _WECHAT not in sys.path:
    sys.path.insert(0, _WECHAT)

import listen_chat


class _EI:
    def __init__(self, name=""):
        self.name = name
        self.handle = 12345


class _Item:
    def __init__(self, name):
        self.element_info = _EI(name=name)


class _MW:
    def __init__(self, items):
        self.element_info = _EI()
        self._items = items

    def rectangle(self):
        class _R:  # 可见态正常几何
            left, top, right, bottom = 0, 0, 800, 600
        return _R()

    def descendants(self, control_type=None):
        if control_type == "ListItem":
            return list(self._items)
        return []


@pytest.fixture(autouse=True)
def _no_window_ops(monkeypatch):
    """扫描的窗口显隐/群判定/sleep 全部中和（纯逻辑测试）。"""
    monkeypatch.setattr(listen_chat, "_ensure_tray_visible", lambda mw: "")
    monkeypatch.setattr(listen_chat, "_restore_window_state", lambda mw, s: None)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["客户"])
    monkeypatch.setattr(listen_chat.time, "sleep", lambda s: None)
    listen_chat._KNOWN_GROUPS.clear()
    listen_chat._ANCHOR_STALL.clear()


def _mk(name):
    return _Item(name)


def test_badge_session_reads_bubbles_and_merges(monkeypatch):
    """角标会话：开窗读气泡，取锚点后 trailing 合并（不再只信预览单条）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "什么价格", "direction": "incoming"},
        {"text": "您好99元", "direction": "outgoing"},
        {"text": "发下资料", "direction": "incoming"},
        {"text": "你们公司信息", "direction": "incoming"},
    ])
    mw = _MW([_mk("默忆\n[1条] \n你们公司信息\n14:43\n")])
    out = listen_chat.scan_unread(mw, {})
    assert len(out) == 1
    assert out[0]["sender"] == "默忆"
    assert out[0]["content"] == "发下资料\n\n你们公司信息"
    assert out[0]["_preview_name"].startswith("默忆")


def test_trigger_by_preview_change(monkeypatch):
    """无角标但 item name 变了（会话开着被自动已读）→ 触发开窗读气泡 → 取出漏读消息。
    这是主 bug 的发现层守卫：删掉预览变化触发必红。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "您好99元", "direction": "outgoing"},
        {"text": "我想买好产品", "direction": "incoming"},
    ])
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n我想买好产品\n14:43\n")])
    out = listen_chat.scan_unread(mw, last_preview)
    assert [m["content"] for m in out] == ["我想买好产品"]
    # 触发未消费（等 DELIVERED 才提交）：last_preview 保持旧值
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_first_seen_records_only(monkeypatch):
    """首见只记录不触发（防陈年消息/重启风暴）。"""
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": pytest.fail("不该开窗"))
    last_preview = {}
    mw = _MW([_mk("默忆\n在吗\n14:40\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_no_new_trailing_commits_preview(monkeypatch):
    """开窗后发现无新 incoming（最后一条是我方）→ 提交 last_preview（白开只此一次）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "在吗", "direction": "incoming"},
        {"text": "您好99元", "direction": "outgoing"},
    ])
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n您好99元\n14:44\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert last_preview["默忆"] == "默忆\n您好99元\n14:44\n"


def test_open_fail_keeps_trigger(monkeypatch):
    """开窗失败：预览触发态保留（不更新 last_preview）→ 下轮重试，绝不静默消费。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": False)
    last_preview = {"默忆": "默忆\n在吗\n14:40\n"}
    mw = _MW([_mk("默忆\n发下资料\n14:43\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert last_preview["默忆"] == "默忆\n在吗\n14:40\n"


def test_open_fail_with_badge_falls_back_to_preview(monkeypatch):
    """开窗失败但有角标：回退旧单条路径（保底不漏，兼容 CI 假环境）。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": False)
    mw = _MW([_mk("默忆\n[2条] \n发下资料\n14:43\n")])
    out = listen_chat.scan_unread(mw, {})
    assert [m["content"] for m in out] == ["发下资料"]


def test_bubble_empty_with_badge_falls_back(monkeypatch):
    """开窗成功但气泡读空（轮询后仍空）：有角标 → 回退预览单条 + bubble_read_empty 计数。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [])
    recorded = []
    mw = _MW([_mk("默忆\n[1条] \n在吗\n14:40\n")])
    out = listen_chat.scan_unread(mw, {}, record_skip=recorded.append)
    assert [m["content"] for m in out] == ["在吗"]
    assert "bubble_read_empty" in recorded


def test_group_cached_and_skipped(monkeypatch):
    """开窗判出群（标题带人数）→ 记 _KNOWN_GROUPS 不回；下轮发现层直接跳过不开窗。"""
    monkeypatch.setattr(listen_chat, "_open_chat", lambda mw, it, s, expect_content="": True)
    monkeypatch.setattr(listen_chat, "_read_chat_header_texts", lambda mw: ["某客户群(3)"])
    last_preview = {"某客户群": "某客户群\n在吗\n14:40\n"}
    mw = _MW([_mk("某客户群\n[2条] \n在吗\n14:43\n")])
    assert listen_chat.scan_unread(mw, last_preview) == []
    assert "某客户群" in listen_chat._KNOWN_GROUPS
    monkeypatch.setattr(listen_chat, "_open_chat",
                        lambda mw, it, s, expect_content="": pytest.fail("群不该再开窗"))
    assert listen_chat.scan_unread(mw, last_preview) == []


def test_open_budget_caps_per_round(monkeypatch):
    """每轮开窗预算 cap=3：4 个预览触发只开 3 个，第 4 个触发态保留下轮再处理。"""
    opened = []

    def _fake_open(mw, it, s, expect_content=""):
        opened.append(s)
        return True

    monkeypatch.setattr(listen_chat, "_open_chat", _fake_open)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", lambda mw: [
        {"text": "旧", "direction": "outgoing"}, {"text": "新", "direction": "incoming"}])
    last_preview = {f"客户{i}": f"客户{i}\n旧\n14:0{i}\n" for i in range(4)}
    mw = _MW([_mk(f"客户{i}\n新\n14:1{i}\n") for i in range(4)])
    out = listen_chat.scan_unread(mw, last_preview)
    assert len(opened) == 3 and len(out) == 3
    leftover = set(last_preview) - {m["sender"] for m in out}
    assert len(leftover) == 1  # 第4个未消费，保留触发态


def test_two_contacts_isolated(monkeypatch):
    """铁律：≥2 联系人互不串——各自锚点各自 trailing。"""
    calls = {}

    def _fake_open(mw, it, s, expect_content=""):
        calls["current"] = s
        return True

    def _fake_bubbles(mw):
        if calls["current"] == "客户A":
            return [{"text": "回A", "direction": "outgoing"},
                    {"text": "A的新消息", "direction": "incoming"}]
        return [{"text": "回B", "direction": "outgoing"},
                {"text": "B的新消息", "direction": "incoming"}]

    monkeypatch.setattr(listen_chat, "_open_chat", _fake_open)
    monkeypatch.setattr(listen_chat, "read_chat_bubbles", _fake_bubbles)
    mw = _MW([_mk("客户A\n[1条] \nA的新消息\n14:40\n"),
              _mk("客户B\n[1条] \nB的新消息\n14:41\n")])
    out = {m["sender"]: m["content"] for m in listen_chat.scan_unread(mw, {})}
    assert out == {"客户A": "A的新消息", "客户B": "B的新消息"}
```

- [ ] **Step 2: 跑红**（`_KNOWN_GROUPS` 不存在 / `_preview_name` 缺失等）→ commit-1（消息 `test(line04): 锚点气泡扫描 scan_unread 失败测试（触发/事务/预算/群缓存，红）`）

- [ ] **Step 3: 实现——重写 `scan_unread`（listen_chat.py:465-535 整体替换）**

模块级状态（放在 `scan_unread` 之前）：

```python
# ─── 锚点气泡扫描：模块级状态 ─────────────────────────────────────────────────
_KNOWN_GROUPS: set = set()        # _is_group_by_header 判过的群 sender：发现层直接跳过
_ANCHOR_STALL: Dict[str, int] = {}  # sender → 连续 emit 未走到 DELIVERED 的轮数（熔断告警）
SCAN_OPEN_BUDGET = 3              # 每轮最多开窗读气泡的会话数（#984 延迟教训机制化）
_BUBBLE_READ_POLLS = 3            # 气泡读空重试轮数（同 _confirm_delivery 轮询模式）
_BUBBLE_READ_POLL_SLEEP = 0.6
ANCHOR_STALL_LIMIT = 3            # 连续 N 轮停滞 → 心跳告警（只告警不降级——绝不静默丢消息）
```

`scan_unread` 新实现（docstring 必须写明双层机制与事务语义）：

```python
def scan_unread(mw: Any, last_preview: Optional[Dict[str, str]] = None,
                record_skip: Optional[Any] = None) -> List[Dict[str, Any]]:
    """锚点气泡扫描（2026-07-02 重构，根治漏消息——替代旧 角标path-1/预览path-2 机制）。

    发现层（便宜，不开会话）：触发 = 有 [N条] 角标 OR item name != last_preview[sender]。
      - last_preview 只是触发信号（比较整个 item name，防长消息截断假阴性），永不 pop；
        首见只记录不触发（防陈年消息/重启风暴）。
    读取层（仅触发会话，角标优先，每轮 ≤SCAN_OPEN_BUDGET 个）：_open_chat → 判群（记
      _KNOWN_GROUPS 缓存）→ read_chat_bubbles → strip_system_bubbles →
      split_trailing_incoming（锚点=最后一条 outgoing）→ 合并成一条。
    事务语义：触发信号在打开会话那刻就被微信消费（角标清零）→ last_preview 只在
      ①确认无新 trailing（本函数内提交）或 ②DELIVERED（主循环 _commit_reply_success）
      后更新；开窗失败/读空/后续草稿失败 → 触发态保留，下轮重读气泡重试，绝不静默丢。
    回退保底：开窗失败或气泡读空 且有角标 → 回退旧单条路径（用预览 content），宁可
      上下文不全也不漏回；无角标的触发读不出 → 保留触发态下轮再试（fail-closed）。
    """
    orig_state = _ensure_tray_visible(mw)
    global _LAST_VISIBLE_TREE_SIZE
    try:
        _LAST_VISIBLE_TREE_SIZE = len(mw.descendants())
    except Exception:
        pass
    # ⚠️ 绝不在这里切 tab 回顶（回归 2026-06-29，见 git 74654efd 注释——#955 教训）。
    candidates: List[Dict[str, Any]] = []
    seen: set = set()
    for it in mw.descendants(control_type="ListItem"):
        try:
            name = it.element_info.name or ""
        except Exception:
            continue
        info = _parse_item_name(name, require_unread=False)
        if not info or info["sender"] in seen:
            continue
        sender = info["sender"]
        if sender in _KNOWN_GROUPS:
            continue
        badge_n = parse_unread_count(name)
        if badge_n > 0:
            seen.add(sender)
            candidates.append({"sender": sender, "content": info["content"],
                               "name": name, "badge": badge_n, "_item": it})
            continue
        if last_preview is None:
            continue
        prev = last_preview.get(sender)
        if prev is None:
            last_preview[sender] = name  # 首见只记录不触发
        elif prev != name:
            seen.add(sender)
            candidates.append({"sender": sender, "content": info["content"],
                               "name": name, "badge": 0, "_item": it})
    candidates.sort(key=lambda c: -c["badge"])  # 角标优先
    out: List[Dict[str, Any]] = []
    opened = 0
    for c in candidates:
        if opened >= SCAN_OPEN_BUDGET:
            break  # 触发态保留（角标还在/last_preview 未更新），下轮继续
        opened += 1
        msgs, empty_read = _read_trailing_for(mw, c, record_skip=record_skip)
        if msgs:
            out.append({"sender": c["sender"], "content": aggregate_messages(msgs),
                        "_item": c["_item"], "_preview_name": c["name"]})
            _ANCHOR_STALL[c["sender"]] = _ANCHOR_STALL.get(c["sender"], 0) + 1
            if _ANCHOR_STALL[c["sender"]] >= ANCHOR_STALL_LIMIT:
                if record_skip is not None:
                    record_skip("anchor_stall")
                _log(f"anchor_stall sender={c['sender']} rounds={_ANCHOR_STALL[c['sender']]}"
                     f"（连续 emit 未 DELIVERED——只告警不降级，继续重试）")
        elif c["badge"] > 0 and c["content"] and (not c.get("_opened") or empty_read):
            # 回退保底：开窗失败或气泡读空、但角标在 → 旧单条路径，宁可上下文不全也不漏回。
            # 注意：开窗成功且读到气泡但 trailing 空（陈旧角标，其实已回过）不走这里——
            # 走下面的提交分支，防重复回。
            out.append({"sender": c["sender"], "content": c["content"],
                        "_item": c["_item"], "_preview_name": c["name"]})
        elif c.get("_opened") and not empty_read:
            # 开窗成功、气泡读到了、但无新 trailing（最后一条是我方/陈旧角标）→ 提交触发消费
            if last_preview is not None:
                last_preview[c["sender"]] = c["name"]
        # 其余（开窗失败/读空 且无角标）：触发态保留，下轮重试
    _restore_window_state(mw, orig_state)
    return out
```

辅助函数 `_read_trailing_for`（放在 scan_unread 之前）：

```python
def _read_trailing_for(mw: Any, cand: Dict[str, Any],
                       record_skip: Optional[Any] = None) -> Any:
    """打开 cand 会话读 trailing incoming。返回 (msgs, bubble_read_empty)。

    - 开窗失败 → ([], False)，触发态由调用方保留。
    - 打开后判群（唯一可靠信号=标题"(人数)"）→ 记 _KNOWN_GROUPS，([], False) 不回。
    - 气泡读空轮询 _BUBBLE_READ_POLLS 次；仍空 → ([], True) + record_skip 计数
      （心跳 diag 可见：列表可读但气泡区空 = 树病信号）。
    """
    try:
        if not _open_chat(mw, cand["_item"], cand["sender"]):
            return [], False
    except Exception:
        return [], False
    cand["_opened"] = True
    try:
        if _is_group_by_header(_read_chat_header_texts(mw)) is not None:
            _KNOWN_GROUPS.add(cand["sender"])
            return [], False
    except Exception:
        pass  # 判不出群 → 按私聊继续（reply_in_chat 发送前还有判群闸）
    bubbles: List[Dict[str, str]] = []
    for _ in range(_BUBBLE_READ_POLLS):
        bubbles = read_chat_bubbles(mw)
        if bubbles:
            break
        time.sleep(_BUBBLE_READ_POLL_SLEEP)
    if not bubbles:
        if record_skip is not None:
            record_skip("bubble_read_empty")
        return [], True
    return split_trailing_incoming(strip_system_bubbles(bubbles), cand["badge"]), False
```

同时：
1. 删除旧 path-2 相关代码（原 465-535 的 path-2 分支已被整体替换覆盖）。
2. `grep -n "read_chat_panel_messages" services/agent/wechat-rpa/*.py`——旧 N>1 路径已删，若只剩定义无调用点 → 删除函数（保留 `aggregate_messages`/`parse_unread_count`）；若 tests 有直接测它的用例一并删。
3. 删除 `tests/test_scan_unread_path2_content_change.py`（守卫契约由 test_scan_trigger.py 的 trigger_by_preview_change / open_fail_keeps_trigger 等价接替，删除理由写进 commit message）。
4. 跑 `python3 -m pytest tests/test_scan_unread.py tests/test_scan_unread_n_msgs.py -q`：g1-g12 走"开窗失败(假 mw)+角标回退"路径应保持绿；若个别 case 因新语义失败，按新语义修 fixture（不许削弱断言）。

- [ ] **Step 4: 全量跑 wechat-rpa 测试**

Run: `cd services/agent/wechat-rpa && python3 -m pytest tests/ -q`
Expected: 全绿（Windows-only 用例自带 skip）

- [ ] **Step 5: commit-2**（`feat(line04): scan_unread 重构为锚点气泡扫描——根治会话打开后漏消息`，正文注明删除 path-2 与 test_scan_unread_path2_content_change.py 的替代关系；rsync 副本同 commit）

---

### Task 5: 主循环接线——事务提交 + 删 pop 护栏

**Files:**
- Modify: `services/agent/wechat-rpa/listen_chat.py`（主循环 L2894 / L3111 / L3357 附近）
- Modify: `services/agent/wechat-rpa/tests/test_bubble_anchor.py`（追加 _commit_reply_success 用例）

- [ ] **Step 1: failing test（追加到 test_bubble_anchor.py）**

```python
# ── _commit_reply_success（DELIVERED 后的事务提交）──────────────────────────

def test_commit_reply_success_syncs_preview_and_clears_stall():
    lp, stall = {"默忆": "默忆\n在吗\n14:40\n"}, {"默忆": 2}
    listen_chat._commit_reply_success(lp, stall, "默忆", "默忆\n您好99元\n14:45\n")
    assert lp["默忆"] == "默忆\n您好99元\n14:45\n"
    assert "默忆" not in stall


def test_commit_reply_success_readback_fail_keeps_old_value():
    """读回失败 → 保留旧值（下轮多开一次窗自会收敛），绝不 pop（pop 是旧 bug 根源）。"""
    lp = {"默忆": "默忆\n在吗\n14:40\n"}
    listen_chat._commit_reply_success(lp, {}, "默忆", "")
    assert lp["默忆"] == "默忆\n在吗\n14:40\n"
```

- [ ] **Step 2: 跑红 → commit-1**（`test(line04): DELIVERED 事务提交失败测试（红）`）

- [ ] **Step 3: 实现**

listen_chat.py 加纯函数（放 `_read_session_preview` 之后）：

```python
def _commit_reply_success(last_preview: Dict[str, str], anchor_stall: Dict[str, int],
                          sender: str, readback_name: str) -> None:
    """DELIVERED 后的事务提交（纯函数）：last_preview 同步为读回的 item name
    （含我方回复=消费触发信号，消灭"每次回复后 100% 白开"）；读回失败保留旧值
    （下轮触发→开窗→trailing 为空→自然收敛，绝不 pop——pop 正是 2026-07-02
    前"下条真消息被首见分支吞掉"的旧 bug 根源）；清零 anchor_stall。"""
    if readback_name:
        last_preview[sender] = readback_name
    anchor_stall.pop(sender, None)
```

主循环三处改动：
1. **L2894**（初始化）：`last_content: dict[str, str] = {}` → `last_preview: dict[str, str] = {}`（连同注释更新为触发信号语义）。
2. **L3111**：`unread = scan_unread(mw, last_content)` → `unread = scan_unread(mw, last_preview, record_skip=_skip_counter.record)`。
3. **L3357**：删除 `last_content.pop(m["sender"], None)  # 删除防自回复风暴（存 reply 反而触发 Path2 截断误判）`，替换为：

```python
                    _commit_reply_success(
                        last_preview, _ANCHOR_STALL, m["sender"],
                        _read_session_preview(mw, m["sender"]))
```

4. `grep -n "last_content" services/agent/wechat-rpa/listen_chat.py`——确认无残留引用（除注释更新）。

- [ ] **Step 4: 全量跑测试**（`python3 -m pytest tests/ -q`；`tests/test_reply_loop_purity.py` 若引用 last_content/pop 按新语义更新，不许削弱断言）
- [ ] **Step 5: commit-2**（`feat(line04): 主循环事务提交——DELIVERED 后同步 last_preview，删 pop 护栏`；rsync 副本）

---

### Task 6: 版本 bump 1.0.90→1.0.91（9 面）+ CI 点名新测试

**Files:**
- Modify: `services/agent/modules/line04/manifest.json`（version → 1.0.91）
- Modify: `services/agent/build-modules/line04/manifest.json`（version → 1.0.91）
- Modify: `apps/api/src/services/walking-skeleton.service.ts:74`（required_version → '1.0.91'）
- Modify: `apps/api/src/services/walking-skeleton.service.test.ts:160-162`（'1.0.91'）
- Modify: `apps/api/tests/routes/heartbeat-modules.test.ts:78`（'1.0.91'）
- Modify: `.github/workflows/scripts/smoke/offscreen-version-gate-smoke.sh:16` / `preflight-delivery-selfcheck-smoke.sh:13` / `wechat-cs-visible-delivery-smoke.sh:20`（EXPECTED="1.0.91"）、`heartbeat-module-health-smoke.sh:70`（"1.0.91"）
- Modify: `.github/workflows/ci-l4-runtime.yml:134` pytest 点名列表追加 `tests/test_bubble_anchor.py tests/test_read_chat_bubbles.py tests/test_scan_trigger.py`，并**删去**已删除的 `tests/test_scan_unread_path2_content_change.py`

- [ ] **Step 1: 逐面替换**（`grep -rn "1\.0\.90" --include="*.json" --include="*.ts" --include="*.sh" apps/api services/agent .github` 确认恰好 9 处，全部改 1.0.91）
- [ ] **Step 2: 改 ci-l4-runtime.yml 点名列表**（memory 死规则：merge≠CI 跑，必须逐个点名）
- [ ] **Step 3: manifest 改动后再 rsync 一次副本并核对**：`diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ --exclude='*.pyc' --exclude='__pycache__'` → 无输出
- [ ] **Step 4: 跑 apps/api 相关测试**：`cd apps/api && npx vitest run src/services/walking-skeleton.service.test.ts tests/routes/heartbeat-modules.test.ts` → PASS
- [ ] **Step 5: commit**（标题带 [CONFIG]：`[CONFIG] chore(line04): bump 1.0.91（锚点气泡扫描）+ CI 点名新测试`）

---

### Task 7: 收尾自检

- [ ] **Step 1: 全量 wechat-rpa 测试** `cd services/agent/wechat-rpa && python3 -m pytest tests/ -q` → 全绿
- [ ] **Step 2: 副本一致** `diff -r services/agent/wechat-rpa/ services/agent/build-modules/line04/wechat-rpa/ --exclude='*.pyc' --exclude='__pycache__'` → 无输出
- [ ] **Step 3: proven-to-fire 抽查**（守卫要亲眼见红）：
  - 临时把 `strip_system_bubbles` 改成 `return bubbles` → `test_timestamp_does_not_hijack_anchor` 必红 → 还原。
  - 临时把 scan_unread 预览触发分支注释掉 → `test_trigger_by_preview_change` 必红 → 还原。
  - 两次都在 Bash 里跑给日志留痕，还原后再全量绿一次。
- [ ] **Step 4: 信息卫生**：`git diff main --stat` 复查无临时文件/无 console.log 式调试残留/无消息明文日志。

---

## 真机 DoD（PR 合并 + staging 部署后，rog 上验，不在本 plan 自动化范围）
- 默忆连发 5 条一条不漏（查 zenithjoy_test 库 cs_memory_messages 全有 in 记录 + 默忆会话真收到合并回复），轮延迟不回 60s 级。
- 心跳 diag 出现 bubble_read_empty/anchor_stall 字段（skip_reasons 内），rog 用 OFFSCREEN 制造读空亲眼看计数动。
- 图片/语音/撤回/时间戳真实 UIA name 采样回填 fixture（若与 _is_system_bubble 假设不符，开后续小刀修正则表）。
