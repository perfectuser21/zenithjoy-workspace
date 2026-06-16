"""
wechat-rpa/config.py — 微信 RPA 所有行为参数的唯一来源

【用法】
  from config import OFFSCREEN_REPLY, OFFSCREEN_X, CHAT_PER_MINUTE_LIMIT, ...

【机器级覆盖】
  在 agent 安装目录下建 machine.config.json，可覆盖任何参数：
  {
    "OFFSCREEN_X": -9000,    // 双屏幕时左屏更宽，需要更负的值
    "REAL_PUBLISH": false    // 某台机器跑 dryrun 模式
  }

【新功能开发规则】
  所有新增行为参数必须先加到这里，不能散写在代码里。
  每次 sprint 在 PrepPRD 的"行为参数"一节声明改动。
"""
from __future__ import annotations
import json
import os
from pathlib import Path

# ══════════════════════════════════════════════════════════
#  用户可调参数（影响业务行为，sprint PrepPRD 必须声明变更）
# ══════════════════════════════════════════════════════════

# ── 回复模式 ──────────────────────────────────────────────
OFFSCREEN_REPLY: bool = True
"""True = 静默后台回复（微信窗口移到屏外，用户看不见操作过程）
   False = 台前回复（微信窗口会弹出到前台，用户可见，会闪屏）
   【常见问题】双屏幕时窗口移到 OFFSCREEN_X 坐标可能仍在可视区 → 调 OFFSCREEN_X"""

OFFSCREEN_X: int = -2600
"""静默模式下微信窗口移到的 X 坐标（负值 = 屏幕左边界之外）
   【单屏幕 1920px】-2600 足够
   【双屏幕左屏 2560px】需要改为 -5200 或更负
   【ROG 双屏】如果还在闪屏，把这个值改为 -9000"""

OFFSCREEN_Y: int = 60
"""静默模式下微信窗口的 Y 坐标（60 = 距顶部 60px，UIA 需要非零值）"""

REAL_PUBLISH: bool = True
"""True = 真实发送消息
   False = dryrun 模式（只打印，不控制微信）
   【首次部署新机器建议先设 False 验证环境，确认无误再改 True】"""

# ── 频控限制 ──────────────────────────────────────────────
CHAT_PER_MINUTE_LIMIT: int = 2
"""私聊每分钟最多回复条数（防封号）"""

MOMENT_PER_24H_LIMIT: int = 1
"""朋友圈每 24 小时最多发布条数（防封号）"""

MIN_OPERATION_INTERVAL_SECONDS: float = 1.0
"""任意两次微信操作之间的最小间隔（秒）"""

# ── 消息去重与冷却 ────────────────────────────────────────
SENDER_COOLDOWN_SECONDS: float = 30.0
"""成功回复后同一发件人的冷却时间（秒）
   冷却期内同一人再来消息不重复回，防刷屏"""

REPLIED_TTL_SECONDS: int = 120
"""已回复记录的过期时间（秒）
   过期后该消息可以被重新回复（防永久封锁正常用户）"""

REPLY_FAILURE_COOLDOWN_SECONDS: int = 60
"""同一消息发送失败后的冷却时间（秒），防死循环"""

# ── 心跳与保活 ────────────────────────────────────────────
HEARTBEAT_INTERVAL_SECONDS: int = 60
"""向中台上报心跳的间隔（秒）"""

UIA_REACTIVATE_INTERVAL_SECONDS: int = 45
"""UIAutomation 屏幕阅读器标志失效后重新激活的冷却时间（秒）"""

WECHAT_LAUNCH_COOLDOWN_SECONDS: int = 120
"""微信进程自动拉起的冷却时间（秒），防重复启动"""

WECHAT_STARTUP_WAIT_SECONDS: int = 5
"""拉起微信后等待窗口出现的时间（秒）"""

# ── 主循环 ────────────────────────────────────────────────
MAIN_LOOP_POLL_INTERVAL_SECONDS: int = 3
"""监听主循环的轮询间隔（秒）"""

INTER_SEND_MIN_INTERVAL_SECONDS: float = 1.0
"""多人排队时每条消息发送之间的最小间隔（秒）"""

# ── 微信版本限制 ──────────────────────────────────────────
WECHAT_MIN_VERSION: tuple = (4, 0, 0)
"""支持的微信最低版本（低于此版本无 mmui::MainWindow，RPA 不可用）"""

WECHAT_MAX_VERSION: tuple = (4, 1, 8, 999)
"""支持的微信最高版本（>= 4.1.9 砍掉 UIA 控件树，RPA 不可用）
   当前锁定：4.1.8.107"""

WECHAT_EXE_DEFAULT_PATH: str = r"C:\Program Files\Tencent\Weixin\Weixin.exe"
"""微信可执行文件的默认安装路径"""

# ══════════════════════════════════════════════════════════
#  内部超时参数（调优用，正常不需要改）
# ══════════════════════════════════════════════════════════

TRAY_RESTORE_SLEEP: float = 0.30
MINIMIZED_RESTORE_SLEEP: float = 0.75
VISIBLE_MOVE_SLEEP: float = 0.15
UIA_SETVALUE_SLEEP: float = 0.3
KEYDOWN_KEYUP_SLEEP: float = 0.05
SEND_VERIFY_SLEEP: float = 0.4
BUTTON_CLICK_SLEEP: float = 0.5
OPEN_CHAT_POLL_INTERVAL: float = 0.4
OPEN_CHAT_MAX_ATTEMPTS: int = 3
OPEN_CHAT_VERIFY_POLLS: int = 5
FIND_INPUT_RETRIES: int = 3
FIND_INPUT_RETRY_SLEEP: float = 1.0
TITLE_MIN_MATCH_LENGTH: int = 4
OFFSCREEN_RESTORE_BEFORE_SEND_SLEEP: float = 0.5
OFFSCREEN_MOVE_SLEEP: float = 0.3

# ══════════════════════════════════════════════════════════
#  机器级覆盖（读取 machine.config.json）
# ══════════════════════════════════════════════════════════

def _load_machine_overrides() -> None:
    """从 agent 安装目录旁的 machine.config.json 读取覆盖值，写回本模块全局变量。"""
    candidates = [
        Path(os.environ.get("ZENITHJOY_CORE_DIR", "")) / "machine.config.json",
        Path(__file__).parent / "machine.config.json",
        Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "zenithjoy" / "machine.config.json",
    ]
    for p in candidates:
        if p.exists():
            try:
                overrides = json.loads(p.read_text(encoding="utf-8"))
                g = globals()
                applied = []
                for k, v in overrides.items():
                    if k in g and not k.startswith("_"):
                        g[k] = v
                        applied.append(f"{k}={v!r}")
                if applied:
                    print(f"[config] 机器覆盖已加载 ({p}): {', '.join(applied)}")
            except Exception as e:
                print(f"[config] machine.config.json 读取失败: {e}")
            return


_load_machine_overrides()


# ══════════════════════════════════════════════════════════
#  启动诊断打印
# ══════════════════════════════════════════════════════════

def print_config() -> None:
    """打印当前有效配置，供排查用。agent 启动时自动调用。"""
    print("=" * 55)
    print("  wechat-rpa 当前有效配置")
    print("=" * 55)
    print(f"  回复模式      OFFSCREEN_REPLY = {OFFSCREEN_REPLY}  ({'静默后台' if OFFSCREEN_REPLY else '⚠️  台前弹窗（会闪屏）'})")
    print(f"  离屏坐标      OFFSCREEN_X     = {OFFSCREEN_X}")
    print(f"  发送模式      REAL_PUBLISH    = {REAL_PUBLISH}  ({'真实发送' if REAL_PUBLISH else 'dryrun 模式'})")
    print(f"  私聊频控      CHAT/MIN        = {CHAT_PER_MINUTE_LIMIT} 条/分钟")
    print(f"  朋友圈频控    MOMENT/24H      = {MOMENT_PER_24H_LIMIT} 条/天")
    print(f"  发件人冷却    SENDER_COOLDOWN = {SENDER_COOLDOWN_SECONDS}s")
    print(f"  微信版本限制  {WECHAT_MIN_VERSION} ~ {WECHAT_MAX_VERSION}")
    print(f"  心跳间隔      HEARTBEAT       = {HEARTBEAT_INTERVAL_SECONDS}s")
    print(f"  主循环间隔    POLL            = {MAIN_LOOP_POLL_INTERVAL_SECONDS}s")
    print("=" * 55)
