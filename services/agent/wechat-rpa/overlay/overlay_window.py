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

    # ── Bug ① 修复：EnumWindows 支持微信 4.x Qt 类名 ────────────────────────

    @staticmethod
    def _is_wechat_main_window(class_name: str, title: str) -> bool:
        """
        判断是否为微信主窗口（支持 3.x mmui 和 4.1.10+ Qt 外框）。

        - mmui::MainWindow：4.1.8.x 标准类名
        - Qt*QWindowIcon + title=='微信'：4.1.10+ xwechat Qt5 外框（见 find_weixin.py）
        """
        if class_name == "mmui::MainWindow":
            return True
        # 4.1.10+ Qt 外框：类名含 QWindowIcon 且 title == "微信"
        if "QWindowIcon" in class_name and title == "微信":
            return True
        return False

    @staticmethod
    def _detect_wechat_hwnd_from_list(window_list: list) -> Optional[int]:
        """
        从 [(hwnd, class_name, title), ...] 列表中找微信主窗口句柄（纯函数，可单测）。
        找到第一个匹配即返回；无匹配返回 None。
        """
        for hwnd, cls, title in window_list:
            if PositionLoop._is_wechat_main_window(cls, title):
                return hwnd
        return None

    def _find_wechat_hwnd(self) -> Optional[int]:
        """
        查找微信主窗口句柄（仅 Windows）。

        Bug ① 修复：改用 EnumWindows 枚举所有顶级窗口，支持：
          - mmui::MainWindow（4.1.8.x）
          - Qt*QWindowIcon + title=微信（4.1.10+）
        原 FindWindowW("WeChatMainWndForPC") 仅匹配微信 3.x，4.x 永远返回 None。
        """
        if sys.platform != "win32":
            return None
        try:
            import ctypes
            import ctypes.wintypes

            found: list = []
            user32 = ctypes.windll.user32

            WNDENUMPROC = ctypes.WINFUNCTYPE(
                ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM
            )

            @WNDENUMPROC
            def _enum_callback(hwnd, _lParam):
                try:
                    buf_cls = ctypes.create_unicode_buffer(256)
                    buf_title = ctypes.create_unicode_buffer(512)
                    user32.GetClassNameW(hwnd, buf_cls, 256)
                    user32.GetWindowTextW(hwnd, buf_title, 512)
                    if PositionLoop._is_wechat_main_window(buf_cls.value, buf_title.value):
                        found.append(hwnd)
                        return False  # 停止枚举
                except Exception:
                    pass
                return True

            user32.EnumWindows(_enum_callback, 0)
            return found[0] if found else None
        except (OSError, AttributeError):
            return None

    # ── Bug ⑤ 修复：贴靠跟随（_calc_dock_position + _dock_to） ──────────────

    @staticmethod
    def _calc_dock_position(
        wechat_rect: tuple,
        screen_width: int,
        overlay_width: int = 300,
    ) -> tuple:
        """
        计算浮窗贴靠坐标（纯函数，可单测）。

        策略（PRD 2026-07-12）：
          - 微信右缘外侧能放下（right + overlay_width ≤ screen_width）→ x = right
          - 放不下 → x = right - 314（嵌内缘，距右边 14px）
          - y = top + 10
          - h = clamp(wechat_height - 20, 380, 980)

        返回 (x, y, overlay_width, h)。
        """
        left, top, right, bottom = wechat_rect
        wechat_height = bottom - top
        h = max(380, min(980, wechat_height - 20))

        if right + overlay_width <= screen_width:
            x = right
        else:
            x = right - 314

        y = top + 10
        return (x, y, overlay_width, h)

    def _get_overlay_hwnd(self) -> Optional[int]:
        """从 pywebview window 对象提取 hwnd。"""
        if self._webview_window is None:
            return None
        try:
            if hasattr(self._webview_window, "native_handle"):
                return self._webview_window.native_handle
            if hasattr(self._webview_window, "_window"):
                w = self._webview_window._window
                if hasattr(w, "hwnd"):
                    return w.hwnd
        except Exception:
            pass
        return None

    def _dock_to(self, wechat_hwnd: int, overlay_hwnd: int) -> None:
        """
        将浮窗贴靠到微信主窗口右缘（仅 Windows）。

        Bug ④ 修复：声明 SetWindowPos.argtypes 防止 64-bit HWND 截断（裸 windll
        在 64 位进程里 HWND 参数默认按 32 位传递，导致 err1400 静默不动）。
        """
        if sys.platform != "win32":
            return
        try:
            import ctypes
            import ctypes.wintypes

            user32 = ctypes.windll.user32

            # Bug ④ 修复：声明 argtypes 确保 64-bit HWND 正确传递
            SWP = user32.SetWindowPos
            SWP.argtypes = [
                ctypes.wintypes.HWND,   # hWnd
                ctypes.wintypes.HWND,   # hWndInsertAfter
                ctypes.c_int,           # X
                ctypes.c_int,           # Y
                ctypes.c_int,           # cx
                ctypes.c_int,           # cy
                ctypes.c_uint,          # uFlags
            ]
            SWP.restype = ctypes.wintypes.BOOL

            # 获取微信窗口矩形
            rect = ctypes.wintypes.RECT()
            if not user32.GetWindowRect(wechat_hwnd, ctypes.byref(rect)):
                return
            wechat_rect = (rect.left, rect.top, rect.right, rect.bottom)

            # 获取屏幕宽度
            screen_width = user32.GetSystemMetrics(0)

            x, y, w, h = self._calc_dock_position(wechat_rect, screen_width)

            HWND_TOPMOST = ctypes.wintypes.HWND(-1)
            SWP_NOACTIVATE = 0x0010
            SWP_NOZORDER = 0x0004

            SWP(overlay_hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_NOZORDER)
        except (OSError, AttributeError, Exception):
            pass

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
                # Bug ⑤ 修复：show 态执行贴靠跟随
                if visibility == "show" and hwnd is not None:
                    overlay_hwnd = self._get_overlay_hwnd()
                    if overlay_hwnd:
                        self._dock_to(hwnd, overlay_hwnd)
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
      - tail_pointer.txt 持久化：重启后从上次消费字节 offset 恢复，不重放旧 event_id（Gate A）
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
        self._pointer_path = os.path.join(state_dir, "tail_pointer.txt")
        self._seen_ids: set = set()
        self._last_inode: Optional[int] = None
        self._last_heartbeat_ts: Optional[float] = None
        # Gate A：从 tail_pointer.txt 恢复字节 offset（重启不重放旧事件）
        self._file_offset: int = self._load_pointer()

    def _load_pointer(self) -> int:
        """读取 tail_pointer.txt 中存储的字节 offset，损坏/不存在时归零不抛异常（Inv-13）。"""
        try:
            content = open(self._pointer_path, "r", encoding="utf-8").read().strip()
            val = int(content)
            return max(0, val)
        except (FileNotFoundError, OSError):
            return 0
        except (ValueError, TypeError):
            # 内容损坏（非整数）→ 归零软失败
            return 0

    def _save_pointer(self, offset: int) -> None:
        """将字节 offset 写回 tail_pointer.txt（软失败：写失败只 log，不抛异常）。"""
        try:
            tmp_path = self._pointer_path + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(str(offset))
            os.replace(tmp_path, self._pointer_path)
        except OSError:
            pass  # 写失败软失败（Inv-13）

    def _read_lines_from_offset(self, filepath: str, offset: int) -> tuple:
        """从指定字节 offset 处读取文件行，返回 (events, new_offset)（BEHAVIOR-8：只读）。"""
        lines = []
        new_offset = offset
        try:
            with open(filepath, "rb") as f:
                # 检查文件大小，offset 若超出则归零（文件被截断/轮转）
                f.seek(0, 2)
                file_size = f.tell()
                if offset > file_size:
                    offset = 0
                f.seek(offset)
                raw = f.read()
                new_offset = offset + len(raw)
            # 解析行（UTF-8，坏行跳过）
            for line in raw.decode("utf-8", errors="replace").splitlines():
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
        return lines, new_offset

    def _read_lines_safe(self, filepath: str) -> list:
        """只读读取文件行（全量），跳过坏行（BEHAVIOR-8：绝不写入）。"""
        lines = []
        try:
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
          - 正常 → 返回去重后的新事件列表（从 tail_pointer.txt 记录的 offset 起读取）
        """
        all_events = []

        # 检查 inode 变化（轮转检测）
        current_inode = self._get_inode(self._events_path)
        if current_inode != self._last_inode and self._last_inode is not None:
            # inode 变化 → 先读 .1（轮转前的旧文件），全量读
            rotated_events = self._read_lines_safe(self._events_path_rotated)
            all_events.extend(rotated_events)
            # 轮转后重置 offset，从新文件头读
            self._file_offset = 0
        self._last_inode = current_inode

        # 从上次 offset 读当前文件（Gate A：重启后不重放旧事件）
        current_events, new_offset = self._read_lines_from_offset(
            self._events_path, self._file_offset
        )
        all_events.extend(current_events)
        # 更新内存 offset
        self._file_offset = new_offset
        # 持久化 offset（Gate A：重启后恢复）
        self._save_pointer(new_offset)

        # 更新 heartbeat 时间戳
        for ev in all_events:
            if ev.get("type") == "heartbeat":
                ts = ev.get("ts")
                if isinstance(ts, (int, float)):
                    if self._last_heartbeat_ts is None or ts > self._last_heartbeat_ts:
                        self._last_heartbeat_ts = ts

        # heartbeat 超时降级（BEHAVIOR-4）——2026-07-16 根治：degraded 状态只是
        # UI 顶部"休息中"提示，不能拿它短路掉同批真实事件（真机上 listen_chat.py
        # 从未写过 "heartbeat" 类型事件，此条件因此永远成立，旧逻辑会把
        # reply_sent 等真实事件永久吞掉，画像卡因此永远没有数据可显示）。
        now = time.time()
        degraded = (self._last_heartbeat_ts is None
                    or (now - self._last_heartbeat_ts) > self.HEARTBEAT_TIMEOUT_SEC)

        # 幂等去重（精确 event_id 匹配）
        new_events = []
        for ev in all_events:
            eid = ev.get("event_id")
            if eid is not None:
                if eid in self._seen_ids:
                    continue
                self._seen_ids.add(eid)
            new_events.append(ev)

        if degraded:
            return [dict(self.DEGRADED_EVENT)] + new_events
        return new_events


# ─── OverlayApp ───────────────────────────────────────────────────────────────


class OverlayApp:
    """
    pywebview 无边框置顶浮窗主体（BEHAVIOR-1/12）。

    特性：
      - WS_EX_NOACTIVATE：不抢焦点（Windows）
      - --probe 模式：2s 内建窗即退，exit_code=0（CI 探针）
      - HTML v2 模板：深色玻璃，呼吸灯+时钟+今日已回复+工作记录卡片（BEHAVIOR-12）
    """

    # v2 HTML 模板（2026-07-12 xian-rog 真机视觉验收）：深色玻璃圆角 + 呼吸灯 +
    # 实时日期时钟 + 今日已回复N + 思考中动画 + 工作记录卡片（阶段彩徽+时间戳+已送达角标）
    HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI 客服助手</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif;
    background: rgba(10, 12, 18, 0.90);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
    color: #e2e8f0;
    border-radius: 14px;
    overflow: hidden;
    height: 100vh;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(255,255,255,0.07);
  }

  /* 顶部状态栏：呼吸灯 + 日期时钟 + 今日已回复 + 关闭 */
  .topbar {
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    min-height: 36px;
    flex-shrink: 0;
  }
  .breathe {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #4ade80;
    box-shadow: 0 0 6px rgba(74,222,128,0.6);
    animation: breathe 2.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes breathe {
    0%,100% { opacity:1; box-shadow:0 0 6px rgba(74,222,128,0.6); }
    50%      { opacity:0.3; box-shadow:0 0 2px rgba(74,222,128,0.2); }
  }
  .clock { font-size: 11px; color: #64748b; flex: 1; letter-spacing: 0.4px; }
  .reply-count {
    font-size: 10px; color: #4ade80; font-weight: 700;
    background: rgba(74,222,128,0.08);
    padding: 2px 7px; border-radius: 10px;
    border: 1px solid rgba(74,222,128,0.2);
    flex-shrink: 0;
  }
  .close-btn {
    cursor: pointer; color: #475569; font-size: 14px;
    width: 18px; height: 18px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%; transition: background 0.2s; flex-shrink: 0;
  }
  .close-btn:hover { background: rgba(255,255,255,0.08); color: #94a3b8; }

  /* 思考中动画区 */
  .thinking-area {
    padding: 7px 12px 5px;
    display: flex; align-items: center; gap: 6px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    min-height: 30px; flex-shrink: 0;
  }
  .thinking-label { font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 0.8px; flex-shrink: 0; }
  .thinking-text { font-size: 11px; color: #93c5fd; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dots { display: flex; gap: 3px; flex-shrink: 0; }
  .dots span {
    width: 4px; height: 4px; border-radius: 50%; background: #60a5fa;
    animation: dot 1.4s ease-in-out infinite both;
  }
  .dots span:nth-child(2) { animation-delay:.2s; }
  .dots span:nth-child(3) { animation-delay:.4s; }
  @keyframes dot { 0%,80%,100%{opacity:.2;transform:scale(.7)} 40%{opacity:1;transform:scale(1)} }
  .thinking-area.idle .dots { display: none; }
  .thinking-area.idle .thinking-text { color: #475569; }

  /* 工作记录流 */
  .stream {
    flex: 1; overflow-y: auto;
    padding: 8px 10px;
    display: flex; flex-direction: column; gap: 5px;
  }
  .stream::-webkit-scrollbar { width: 2px; }
  .stream::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 1px; }

  /* 工作记录卡片 */
  .card {
    background: rgba(255,255,255,0.04);
    border-radius: 8px; padding: 6px 9px;
    font-size: 11.5px; line-height: 1.45;
    border: 1px solid rgba(255,255,255,0.05);
  }
  .card-header { display: flex; align-items: center; gap: 5px; margin-bottom: 3px; }
  .badge {
    font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px;
    text-transform: uppercase; letter-spacing: 0.3px; flex-shrink: 0;
  }
  .b-think  { background:rgba(96,165,250,.14); color:#60a5fa; border:1px solid rgba(96,165,250,.3); }
  .b-reply  { background:rgba(74,222,128,.11); color:#4ade80; border:1px solid rgba(74,222,128,.25); }
  .b-stage  { background:rgba(245,158,11,.11); color:#fbbf24; border:1px solid rgba(245,158,11,.25); }
  .b-rest   { background:rgba(148,163,184,.07); color:#64748b; border:1px solid rgba(148,163,184,.14); }
  .card-ts { font-size: 9px; color: #475569; margin-left: auto; flex-shrink: 0; }
  .card-body { color: #cbd5e1; }
  .card-body.dim { color: #475569; font-style: italic; }
  .delivered { display:inline-block; font-size:9px; color:#4ade80;
    background:rgba(74,222,128,.10); border:1px solid rgba(74,222,128,.2);
    border-radius:4px; padding:0 4px; margin-left:4px; vertical-align:middle; }

  /* Step16：会话跟随客户画像卡 */
  .profile-card {
    display: none;
    flex-direction: column; gap: 3px;
    padding: 7px 12px; margin: 0 10px 6px;
    background: rgba(96,165,250,.06); border: 1px solid rgba(96,165,250,.14);
    border-radius: 8px; flex-shrink: 0;
  }
  .profile-row { display: flex; align-items: center; gap: 6px; }
  .profile-nickname { font-size: 12px; font-weight: 700; color: #e2e8f0; }
  .profile-level {
    font-size: 9px; font-weight: 700; color: #fbbf24;
    background: rgba(245,158,11,.11); border: 1px solid rgba(245,158,11,.25);
    border-radius: 4px; padding: 0 5px;
  }
  .profile-meta { font-size: 10px; color: #94a3b8; display: flex; gap: 10px; }
  .profile-actions { font-size: 10px; color: #93c5fd; }
  .profile-ai { font-size: 10px; color: #64748b; font-style: italic; }
  /* FR-2：三段论字段（need/budget/concern） */
  .profile-portrait { font-size: 10px; color: #94a3b8; display: flex; flex-direction: column; gap: 2px; }
  .profile-portrait-item { display: flex; gap: 4px; }
  .portrait-label { color: #60a5fa; font-weight: 600; min-width: 28px; flex-shrink: 0; }
  /* FR-4：查看画像按钮 */
  .profile-btn-row { display: flex; justify-content: flex-end; margin-top: 2px; }
  .btn-view-profile {
    font-size: 9px; color: #60a5fa; border: 1px solid rgba(96,165,250,.3);
    background: rgba(96,165,250,.06); border-radius: 4px; padding: 1px 7px;
    cursor: pointer; transition: background 0.15s;
  }
  .btn-view-profile:hover { background: rgba(96,165,250,.14); }
  .btn-view-profile:disabled { opacity: 0.4; cursor: default; }
</style>
</head>
<body>
<div class="topbar">
  <div class="breathe"></div>
  <div class="clock" id="clock">--</div>
  <div class="reply-count" id="reply-count">今日已回复 0</div>
  <div class="close-btn" onclick="window.pywebview && window.pywebview.api.close_window()">✕</div>
</div>
<div class="profile-card" id="profile-card">
  <div class="profile-row">
    <span class="profile-nickname" id="profile-nickname"></span>
    <span class="profile-level" id="profile-level"></span>
  </div>
  <div class="profile-meta">
    <span id="profile-source"></span>
    <span id="profile-contact-count"></span>
  </div>
  <div class="profile-actions" id="profile-actions"></div>
  <div class="profile-ai" id="profile-ai"></div>
  <!-- FR-2：三段论字段（need/budget/concern）来自 cs_memory_longterm.summary -->
  <div class="profile-portrait" id="profile-portrait" style="display:none">
    <div class="profile-portrait-item"><span class="portrait-label">需求</span><span id="portrait-need"></span></div>
    <div class="profile-portrait-item"><span class="portrait-label">预算</span><span id="portrait-budget"></span></div>
    <div class="profile-portrait-item"><span class="portrait-label">顾虑</span><span id="portrait-concern"></span></div>
  </div>
  <!-- FR-4：查看画像按钮 -->
  <div class="profile-btn-row">
    <button class="btn-view-profile" id="btn-view-profile" disabled
      onclick="window.pywebview && window.pywebview.api.open_customer_page && window.pywebview.api.open_customer_page(window.__currentWechatId || '')">
      查看画像
    </button>
  </div>
</div>
<div class="thinking-area idle" id="ta">
  <span class="thinking-label">状态</span>
  <span class="thinking-text" id="tt">待机中</span>
  <div class="dots"><span></span><span></span><span></span></div>
</div>
<div class="stream" id="stream"></div>
<script>
const MAX_CARDS = 25;
let replyCount = 0;
const stream = document.getElementById('stream');
const ta = document.getElementById('ta');
const tt = document.getElementById('tt');
const replyEl = document.getElementById('reply-count');

function updateClock() {
  const n = new Date();
  const p = x => String(x).padStart(2,'0');
  document.getElementById('clock').textContent =
    (n.getMonth()+1) + '/' + p(n.getDate()) + ' ' + p(n.getHours()) + ':' + p(n.getMinutes());
}
updateClock();
setInterval(updateClock, 15000);

function nowTs() {
  const n = new Date();
  const p = x => String(x).padStart(2,'0');
  return p(n.getHours()) + ':' + p(n.getMinutes()) + ':' + p(n.getSeconds());
}

function addCard(badgeCls, badgeTxt, bodyHtml) {
  const d = document.createElement('div');
  d.className = 'card';
  d.innerHTML = '<div class="card-header"><span class="badge ' + badgeCls + '">' + badgeTxt +
    '</span><span class="card-ts">' + nowTs() + '</span></div>' +
    '<div class="card-body">' + bodyHtml + '</div>';
  stream.appendChild(d);
  while (stream.children.length > MAX_CARDS) stream.removeChild(stream.firstChild);
  stream.scrollTop = stream.scrollHeight;
}

function setThinking(text) { ta.classList.remove('idle'); tt.textContent = text || '思考中...'; }
function setIdle(text)     { ta.classList.add('idle');    tt.textContent = text || '待机中'; }

// Step16：会话跟随客户画像卡——渲染六字段 + 三段论（FR-2：need/budget/concern）
window.__updateCustomerCard = function(profile) {
  const card = document.getElementById('profile-card');
  if (!card || !profile) return;
  card.style.display = 'flex';
  document.getElementById('profile-nickname').textContent = profile.nickname || '';
  document.getElementById('profile-level').textContent = profile.level || '';
  document.getElementById('profile-source').textContent = profile.source ? ('来源: ' + profile.source) : '';
  document.getElementById('profile-contact-count').textContent =
    (profile.contact_count !== undefined && profile.contact_count !== null)
      ? ('联系次数: ' + profile.contact_count) : '';
  const actions = Array.isArray(profile.recent_actions) ? profile.recent_actions.join('、') : '';
  document.getElementById('profile-actions').textContent = actions ? ('近期动态: ' + actions) : '';
  document.getElementById('profile-ai').textContent = profile.ai_profile || '';
  // FR-2：三段论字段渲染（need/budget/concern 来自 cs_memory_longterm.summary）
  const portrait = profile.portrait || {};
  const need = portrait.need || '';
  const budget = portrait.budget || '';
  const concern = portrait.concern || '';
  const portraitEl = document.getElementById('profile-portrait');
  if (portraitEl && (need || budget || concern)) {
    document.getElementById('portrait-need').textContent = need;
    document.getElementById('portrait-budget').textContent = budget;
    document.getElementById('portrait-concern').textContent = concern;
    portraitEl.style.display = 'flex';
  }
  // FR-4：有画像数据时启用「查看画像」按钮
  const btnViewProfile = document.getElementById('btn-view-profile');
  if (btnViewProfile && profile.nickname) {
    btnViewProfile.disabled = false;
  }
};

function renderEvent(ev) {
  if (ev.type === 'degraded') { setIdle(ev.msg || 'AI 客服暂时休息中'); return; }
  if (ev.type === 'thinking') { setThinking(ev.text || '思考中...'); return; }
  if (ev.type === 'reply_sent') {
    setIdle('已回复');
    replyCount++;
    replyEl.textContent = '今日已回复 ' + replyCount;
    const reasoning = ev.reasoning || '';
    const stage = ev.tags && ev.tags.stage ? ev.tags.stage : '';
    if (reasoning) addCard('b-think', '推理', reasoning);
    if (stage)     addCard('b-stage', stage, '');
    addCard('b-reply', '回复', '<span class="delivered">✓ 已送达</span>');
    return;
  }
  if (ev.type === 'heartbeat') return;
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    if (window.pywebview && window.pywebview.api) {
      const evs = await window.pywebview.api.get_events();
      if (evs && evs.length) evs.forEach(renderEvent);
    }
  } catch(e) {}
  finally { polling = false; }
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
        # 里程碑B：会话跟随画像卡（BEHAVIOR-4）
        self.current_customer: Optional[str] = None
        self._current_profile: dict = {}
        # FR-4：中台基础 URL，用于 open_customer_page 生成 CustomerProfilePage URL
        self._middleware_base_url: str = os.environ.get("ZJ_API", "http://localhost:5174")
        # FR-4：当前会话 wechat_id 缓存（无 session 时按钮置灰）
        self._current_wechat_id: Optional[str] = None

        if state_dir:
            self._event_consumer = EventTailConsumer(state_dir)
            self._position_loop = PositionLoop(state_dir)

    def _fetch_customer_profile(self, wechat_id: str) -> dict:
        """
        从中台拉取客户画像卡（BEHAVIOR-5 六字段）。
        降级：API 不可达时返回最小占位数据，不抛出异常。
        """
        try:
            import urllib.request
            api_base = os.environ.get("ZJ_API", "http://localhost:5200")
            url = f"{api_base}/api/wechat/customer-profile?wechat_id={wechat_id}"
            with urllib.request.urlopen(url, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            # 兼容 { data: {...} } 和直接 {...} 两种响应结构
            if isinstance(data, dict) and "data" in data:
                return data["data"]
            return data
        except Exception:
            # 降级：返回 wechat_id 作为 nickname，其余字段空值
            return {
                "level": "unknown",
                "nickname": wechat_id,
                "source": "",
                "contact_count": 0,
                "recent_actions": [],
                "ai_profile": "",
            }

    def switch_customer(self, wechat_id: str) -> dict:
        """
        切换当前显示的客户画像卡（BEHAVIOR-4）。
        wechat_id: 微信对话方标识（与 crm_customers.contact / wechat_id 对应）
        返回: 画像卡数据字典（level/nickname/source/contact_count/recent_actions/ai_profile）
        """
        profile = self._fetch_customer_profile(wechat_id)
        self.current_customer = wechat_id
        self._current_wechat_id = wechat_id  # FR-4：更新 wechat_id 缓存
        self._current_profile = profile
        # 如果浮窗已开启，通过 JS 更新画像卡 DOM（传完整六字段 + 三段论，不是只挑 nickname/level）
        if self._window is not None:
            try:
                self._window.evaluate_js(
                    f"window.__currentWechatId = {json.dumps(wechat_id)}; "
                    f"window.__updateCustomerCard && window.__updateCustomerCard("
                    f"{json.dumps(profile, ensure_ascii=False)})"
                )
            except Exception:
                pass  # JS 调用失败不影响状态更新
        return profile

    def open_customer_page(self, wechat_id: str) -> None:
        """
        FR-4（F4.2）：打开客户画像页（CustomerProfilePage）。
        通过 webbrowser.open 在系统默认浏览器打开中台 URL（Inv-15：外部浏览器，非嵌入渲染）。
        Gate G：xian-rog 真机验证 Windows webbrowser.open 可用性。
        """
        import webbrowser  # noqa: PLC0415
        if not wechat_id:
            # 无 wechat_id 时尝试使用缓存
            wechat_id = self._current_wechat_id or ""
        url = f"{self._middleware_base_url}/wechat/crm/{wechat_id}"
        webbrowser.open(url)

    def get_events(self) -> list:
        """暴露给 pywebview JS 侧的 API：获取新事件，并联动切换画像卡（Step16 会话跟随）。

        事件带 contact 字段且与当前显示客户不同 → 调 switch_customer 切换画像卡。
        switch_customer 内部异常已自行降级（不抛出），此处不重复吞异常。
        """
        if self._event_consumer is None:
            return []
        events = self._event_consumer.get_events()
        for ev in events:
            contact = ev.get("contact")
            if contact and contact != self.current_customer:
                self.switch_customer(contact)
        return events

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

        # 生产模式：创建浮窗（Bug ② 修复：加 js_api=self）
        window = webview.create_window(
            title="AI 客服助手",
            html=self.HTML_TEMPLATE,
            width=300,
            height=680,
            x=100,
            y=100,
            frameless=True,
            on_top=True,
            transparent=True,
            resizable=False,
            js_api=self,  # Bug ② 修复：JS 端需要此参数才能调用 pywebview.api.get_events()
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
