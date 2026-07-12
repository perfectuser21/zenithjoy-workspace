"""
overlay_window.py — Line04 AI 思考浮窗主体
pywebview 无边框置顶浮窗 + PositionLoop + EventTailConsumer

覆盖 BEHAVIOR-1/2/3/4/8/11/12（contract-dod.md）：
  - BEHAVIOR-1：2s 内建窗，WS_EX_NOACTIVATE 不抢焦，exit_code=0
  - BEHAVIOR-2：PositionLoop 四行判据表（500ms 贴靠+显隐循环）
  - BEHAVIOR-3：overlay-state.json 损坏→弃用默认值+备份.bak
  - BEHAVIOR-4：EventTailConsumer 健壮性（heartbeat 降级/inode 跨代/坏行跳过/幂等去重）
  - BEHAVIOR-8：events.jsonl 只读（唯一写者 = listen_chat）
  - BEHAVIOR-11：不干预微信窗口（仅 WS_EX_NOACTIVATE 设置，无窗口消息操作）
  - BEHAVIOR-12：UI 文案温和，禁用对抗性词汇
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path
from typing import Optional

# ─── PositionLoop ─────────────────────────────────────────────────────────────


class PositionLoop:
    """
    500ms 贴靠+显隐循环，四行判据表（BEHAVIOR-2）。

    四行判据优先级：
      1. hwnd is None → "hide"
      2. hwnd exists AND IsIconic → "hide"（最小化）
      3. hwnd exists AND DWMWA_CLOAKED≠0 → "freeze"（虚拟桌面隐藏）
      4. hwnd exists AND NOT IsWindowVisible → "hide"（托盘）
      5. 其余 → "show"
    """

    DEFAULT_STATE = {
        "user_closed": False,
        "position": {"x": 100, "y": 100},
        "visibility": "show",
    }

    def __init__(self, state_dir: str):
        self.state_dir = state_dir
        self._stop_event = threading.Event()
        self._state_path = os.path.join(state_dir, "overlay-state.json")
        self._bak_path = os.path.join(state_dir, "overlay-state.json.bak")
        self._webview_window = None

    def load_state(self) -> dict:
        """
        读取 overlay-state.json。
        损坏的 JSON → 弃用默认值 + 备份 .bak（BEHAVIOR-3）。
        """
        if not os.path.exists(self._state_path):
            return dict(self.DEFAULT_STATE)
        try:
            with open(self._state_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError(f"state 非 dict: {type(data)}")
            return data
        except (json.JSONDecodeError, ValueError, OSError):
            # 备份损坏文件
            try:
                shutil.copy2(self._state_path, self._bak_path)
            except OSError:
                pass
            return dict(self.DEFAULT_STATE)

    def save_state(self, state: dict) -> None:
        """持久化当前状态到 overlay-state.json。"""
        os.makedirs(self.state_dir, exist_ok=True)
        tmp_path = self._state_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
        os.replace(tmp_path, self._state_path)

    def get_visibility(self, hwnd) -> str:
        """
        四行判据表（BEHAVIOR-2）。
        非 Windows 环境（pytest/Linux CI）时 ctypes 不可用，退化为简单判断。
        """
        # 第 1 行：hwnd 为 None → hide
        if hwnd is None:
            return "hide"

        # Windows 平台：调 ctypes 查窗口状态
        if sys.platform == "win32":
            return self._get_visibility_win32(hwnd)

        # 非 Windows（Linux/macOS CI）：有 hwnd 则 show（纯函数逻辑测试）
        return "show"

    def _get_visibility_win32(self, hwnd) -> str:
        """Windows 平台实现：ctypes 查询四行判据。"""
        try:
            import ctypes
            import ctypes.wintypes

            user32 = ctypes.windll.user32
            dwmapi = ctypes.windll.dwmapi

            # 第 2 行：IsIconic（最小化）→ hide
            if user32.IsIconic(hwnd):
                return "hide"

            # 第 3 行：DWMWA_CLOAKED≠0（虚拟桌面不可见）→ freeze
            DWMWA_CLOAKED = 14
            cloaked = ctypes.c_int(0)
            hr = dwmapi.DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                ctypes.byref(cloaked),
                ctypes.sizeof(cloaked),
            )
            if hr == 0 and cloaked.value != 0:
                return "freeze"

            # 第 4 行：NOT IsWindowVisible（托盘/隐藏）→ hide
            if not user32.IsWindowVisible(hwnd):
                return "hide"

            # 第 5 行：其余 → show
            return "show"

        except (OSError, AttributeError):
            # ctypes 调用失败（非 Windows 或 API 不可用）→ 保守隐藏
            return "hide"

    def _find_wechat_hwnd(self) -> Optional[int]:
        """查找微信主窗口句柄（仅 Windows）。"""
        if sys.platform != "win32":
            return None
        try:
            import ctypes
            hwnd = ctypes.windll.user32.FindWindowW("WeChatMainWndForPC", None)
            return hwnd if hwnd else None
        except (OSError, AttributeError):
            return None

    def attach_to_hwnd_for_test(self, hwnd, iterations: int = 5) -> list:
        """
        测试用：运行 N 次 get_visibility 并收集结果（不含真实定时器）。
        """
        results = []
        for _ in range(iterations):
            v = self.get_visibility(hwnd)
            results.append(v)
        return results

    def run(self) -> None:
        """500ms 主循环（生产用，线程内运行）。"""
        while not self._stop_event.is_set():
            try:
                hwnd = self._find_wechat_hwnd()
                visibility = self.get_visibility(hwnd)
                self._apply_visibility(visibility)
            except Exception:
                pass  # 任何异常不崩溃主循环
            self._stop_event.wait(timeout=0.5)

    def _apply_visibility(self, visibility: str) -> None:
        """根据判据结果调整浮窗显隐（依赖 webview window 引用）。"""
        if self._webview_window is None:
            return
        try:
            if visibility == "hide":
                self._webview_window.hide()
            elif visibility == "show":
                self._webview_window.show()
            # freeze: 保持当前状态不变
        except Exception:
            pass

    def stop(self) -> None:
        self._stop_event.set()


# ─── EventTailConsumer ────────────────────────────────────────────────────────


class EventTailConsumer:
    """
    只读消费 events.jsonl（BEHAVIOR-4/8）。
    严禁以写模式打开 events.jsonl（唯一写者 = listen_chat）。

    特性：
      - inode 变化（日志轮转）→ 重开句柄，先读 .1 再读当前
      - 坏行（JSON parse error）→ 跳过
      - event_id 幂等去重（精确整串匹配）
      - heartbeat 超 180s → 返回降级事件
    """

    HEARTBEAT_TIMEOUT_SEC = 180
    DEGRADED_EVENT = {
        "type": "degraded",
        "msg": "AI 客服休息中，稍后自动恢复",
    }

    def __init__(self, state_dir: str):
        self.state_dir = state_dir
        self._events_path = os.path.join(state_dir, "events.jsonl")
        self._events_path_rotated = self._events_path + ".1"
        self._seen_ids: set = set()
        self._last_inode: Optional[int] = None
        self._last_heartbeat_ts: Optional[float] = None

    def _read_lines_safe(self, filepath: str) -> list:
        """只读读取文件行，跳过坏行（BEHAVIOR-8：绝不写入）。"""
        lines = []
        try:
            # 严禁以 'w'/'a' 模式打开 events.jsonl
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                        lines.append(ev)
                    except json.JSONDecodeError:
                        continue  # 坏行跳过（BEHAVIOR-4）
        except (FileNotFoundError, OSError):
            pass
        return lines

    def _get_inode(self, filepath: str) -> Optional[int]:
        """获取文件 inode（用于检测轮转）。"""
        try:
            return os.stat(filepath).st_ino
        except OSError:
            return None

    def get_events(self) -> list:
        """
        获取新事件列表（只读，幂等，降级处理）。

        返回规则：
          - heartbeat 超 180s → 返回 [DEGRADED_EVENT]
          - 正常 → 返回去重后的新事件列表
        """
        all_events = []

        # 检查 inode 变化（轮转检测）
        current_inode = self._get_inode(self._events_path)
        if current_inode != self._last_inode and self._last_inode is not None:
            # inode 变化 → 先读 .1（轮转前的旧文件）
            rotated_events = self._read_lines_safe(self._events_path_rotated)
            all_events.extend(rotated_events)
        self._last_inode = current_inode

        # 读当前文件（只读）
        current_events = self._read_lines_safe(self._events_path)
        all_events.extend(current_events)

        # 更新 heartbeat 时间戳
        for ev in all_events:
            if ev.get("type") == "heartbeat":
                ts = ev.get("ts")
                if isinstance(ts, (int, float)):
                    if self._last_heartbeat_ts is None or ts > self._last_heartbeat_ts:
                        self._last_heartbeat_ts = ts

        # heartbeat 超时降级（BEHAVIOR-4）
        now = time.time()
        if self._last_heartbeat_ts is None or (now - self._last_heartbeat_ts) > self.HEARTBEAT_TIMEOUT_SEC:
            return [dict(self.DEGRADED_EVENT)]

        # 幂等去重（精确 event_id 匹配）
        new_events = []
        for ev in all_events:
            eid = ev.get("event_id")
            if eid is not None:
                if eid in self._seen_ids:
                    continue
                self._seen_ids.add(eid)
            new_events.append(ev)

        return new_events


# ─── OverlayApp ───────────────────────────────────────────────────────────────


class OverlayApp:
    """
    pywebview 无边框置顶浮窗主体（BEHAVIOR-1/12）。

    特性：
      - WS_EX_NOACTIVATE：不抢焦点（Windows）
      - --probe 模式：2s 内建窗即退，exit_code=0（CI 探针）
      - HTML 模板：动态流 UI，温和文案（BEHAVIOR-12）
    """

    # HTML 模板：温和文案，动态流 UI，不含对抗性词汇（BEHAVIOR-12）
    HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 思考中</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
    background: rgba(15, 15, 15, 0.92);
    color: #e8e8e8;
    border-radius: 12px;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    padding: 10px 14px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #888;
  }
  .dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #4ade80;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .stream {
    flex: 1;
    overflow-y: auto;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stream::-webkit-scrollbar { width: 3px; }
  .stream::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
  .card {
    background: rgba(255,255,255,0.05);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.5;
    border-left: 2px solid transparent;
    transition: border-color 0.2s;
  }
  .card.thinking { border-left-color: #60a5fa; }
  .card.reply { border-left-color: #4ade80; }
  .card.stage { border-left-color: #f59e0b; }
  .card.waiting { border-left-color: rgba(255,255,255,0.1); color: #555; }
  .card.rest { border-left-color: rgba(255,255,255,0.1); color: #666; font-style: italic; }
  .label {
    font-size: 10px;
    color: #555;
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .close-btn {
    cursor: pointer;
    color: #555;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: auto;
    transition: color 0.2s;
  }
  .close-btn:hover { color: #aaa; }
</style>
</head>
<body>
<div class="header">
  <div class="dot"></div>
  <span>AI 客服助手</span>
  <span class="close-btn" onclick="window.pywebview && window.pywebview.api.close_window()">关闭</span>
</div>
<div class="stream" id="stream">
  <div class="card waiting">
    <div class="label">状态</div>
    <div>正在连接 AI 客服...</div>
  </div>
</div>
<script>
const MAX_NODES = 30;
const stream = document.getElementById('stream');

function addCard(type, label, text) {
  const card = document.createElement('div');
  card.className = 'card ' + type;
  card.innerHTML = '<div class="label">' + label + '</div><div>' + text + '</div>';
  stream.appendChild(card);
  // FIFO：超出 30 节点时移除最旧的
  while (stream.children.length > MAX_NODES) {
    stream.removeChild(stream.firstChild);
  }
  stream.scrollTop = stream.scrollHeight;
}

function renderEvent(ev) {
  if (ev.type === 'degraded') {
    addCard('rest', '提示', ev.msg || 'AI 客服暂时休息中');
    return;
  }
  if (ev.type === 'thinking') {
    addCard('thinking', '思考中', ev.text || '');
    return;
  }
  if (ev.type === 'reply_sent') {
    const reasoning = ev.reasoning || '';
    const stage = ev.tags && ev.tags.stage ? ev.tags.stage : '';
    if (reasoning) addCard('thinking', '推理', reasoning);
    if (stage) addCard('stage', '阶段', stage);
    addCard('reply', '已回复', '');
    return;
  }
  if (ev.type === 'heartbeat') {
    return;  // 心跳不渲染
  }
}

// 轮询事件（每 500ms 向 Python 侧拉取新事件）
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    if (window.pywebview && window.pywebview.api) {
      const events = await window.pywebview.api.get_events();
      if (events && events.length) {
        events.forEach(renderEvent);
      }
    }
  } catch(e) {
    // 静默处理连接异常
  } finally {
    polling = false;
  }
}

setInterval(poll, 500);
</script>
</body>
</html>"""

    def __init__(self, state_dir: str = "", probe_mode: bool = False):
        self.state_dir = state_dir
        self.probe_mode = probe_mode
        self._event_consumer: Optional[EventTailConsumer] = None
        self._position_loop: Optional[PositionLoop] = None
        self._window = None

        if state_dir:
            self._event_consumer = EventTailConsumer(state_dir)
            self._position_loop = PositionLoop(state_dir)

    def get_events(self) -> list:
        """暴露给 pywebview JS 侧的 API：获取新事件。"""
        if self._event_consumer is None:
            return []
        return self._event_consumer.get_events()

    def close_window(self) -> None:
        """用户点击关闭按钮 → 记录 user_closed + 关窗。"""
        if self._position_loop is not None:
            state = self._position_loop.load_state()
            state["user_closed"] = True
            self._position_loop.save_state(state)

        # 写 overlay-state.json（供 node handler 检测 user_closed）
        if self.state_dir:
            state_path = os.path.join(self.state_dir, "overlay-state.json")
            try:
                os.makedirs(self.state_dir, exist_ok=True)
                with open(state_path, "w", encoding="utf-8") as f:
                    json.dump({"user_closed": True}, f)
            except OSError:
                pass

        if self._window is not None:
            try:
                self._window.destroy()
            except Exception:
                pass

    def run(self) -> None:
        """启动 pywebview 浮窗（BEHAVIOR-1）。"""
        try:
            import webview
        except ImportError:
            print("[overlay] pywebview 未安装，退出", file=sys.stderr)
            sys.exit(1)

        if self.probe_mode:
            # 探针模式：快速建窗验证 WebView2 可用性，2s 后退出
            def _probe_destroy():
                time.sleep(2)
                try:
                    window.destroy()
                except Exception:
                    pass

            window = webview.create_window(
                title="ZJ Overlay Probe",
                html="<html><body>probe</body></html>",
                width=1,
                height=1,
                x=9999,
                y=9999,
                frameless=True,
            )
            t = threading.Thread(target=_probe_destroy, daemon=True)
            t.start()
            webview.start()
            return

        # 生产模式：创建浮窗
        window = webview.create_window(
            title="AI 客服助手",
            html=self.HTML_TEMPLATE,
            width=280,
            height=400,
            x=100,
            y=100,
            frameless=True,
            on_top=True,
            transparent=True,
            resizable=False,
        )
        self._window = window

        # Windows 平台：设置 WS_EX_NOACTIVATE（不抢焦）
        def _set_no_activate():
            if sys.platform == "win32":
                _apply_no_activate_win32(window)
            # 启动位置循环
            if self._position_loop is not None:
                self._position_loop._webview_window = window
                loop_thread = threading.Thread(
                    target=self._position_loop.run, daemon=True
                )
                loop_thread.start()

        webview.start(_set_no_activate, debug=False)


def _apply_no_activate_win32(window) -> None:
    """
    设置 WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW（不抢焦、不在任务栏）。
    BEHAVIOR-11：仅调 GetWindowLong/SetWindowLong 设置扩展样式，不干预微信窗口。
    """
    try:
        import ctypes

        GWL_EXSTYLE = -20
        WS_EX_NOACTIVATE = 0x08000000
        WS_EX_TOOLWINDOW = 0x00000080
        WS_EX_LAYERED = 0x00080000

        hwnd = None
        # pywebview 不同版本获取 hwnd 的方式不同
        if hasattr(window, 'native_handle'):
            hwnd = window.native_handle
        elif hasattr(window, '_window'):
            w = window._window
            if hasattr(w, 'hwnd'):
                hwnd = w.hwnd

        if hwnd:
            user32 = ctypes.windll.user32
            ex_style = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            ex_style |= WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_LAYERED
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style)
    except (OSError, AttributeError, Exception):
        pass  # 非 Windows 或 API 不可用时静默


# ─── CLI 入口 ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--probe" in sys.argv:
        # 探针模式：2s 建窗即退，exit_code=0（BEHAVIOR-1/7）
        state_dir = os.environ.get("ZJ_STATE_DIR", "")
        app = OverlayApp(state_dir=state_dir, probe_mode=True)
        app.run()
        sys.exit(0)
    else:
        # 生产模式
        state_dir = os.environ.get("ZJ_STATE_DIR", "")
        module_version = os.environ.get("ZJ_MODULE_VERSION", "unknown")
        if not state_dir:
            print("[overlay] ZJ_STATE_DIR 未设置，退出", file=sys.stderr)
            sys.exit(1)
        app = OverlayApp(state_dir=state_dir)
        app.run()
        sys.exit(0)
