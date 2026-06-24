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
import sys
from pathlib import Path

# Windows embedded Python 默认 cp1252 stdout 无法编码中文，强制 UTF-8
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ══════════════════════════════════════════════════════════
#  用户可调参数（影响业务行为，sprint PrepPRD 必须声明变更）
# ══════════════════════════════════════════════════════════

# ── 回复模式 ──────────────────────────────────────────────
OFFSCREEN_REPLY: bool = False
"""默认 False = 窗口可见模式（B 方案，PrepPRD 06211342）：微信窗口留屏上用户随时能看，
   回复全程纯 UIA SetValue+PostMessage（不碰系统鼠标键盘）+ NOACTIVATE（不激活），
   操作完把前台焦点还给操作前的窗口（不抢用户键鼠焦点）。配「真送达读回验证」确认真送达。

   True = 旧「藏窗口」离屏模式（微信移到屏外 -2600 + DWM cloak）—— 已知错方向（PrepPRD §0.3）：
   用户看不了、没法验证送达、还会卡死（窗口留屏外+cloak 打不开）。保留为可选开关仅供回退，
   默认不用。新「静默」语义 = 不抢焦点，而非藏窗口（memory wechat_qt_uia_works_dont_downgrade）。
   【常见问题】True 模式双屏幕时窗口移到 OFFSCREEN_X 坐标可能仍在可视区 → 调 OFFSCREEN_X"""

OFFSCREEN_X_FALLBACK: int = -2600
"""几何推导不可用（非 Windows / GetSystemMetrics 失败）时的兜底离屏 X。
   保持历史值 -2600，单屏机器够用。"""


def _get_system_metrics():
    """返回 Windows user32.GetSystemMetrics 可调用对象；非 Windows / 不可用 → None。

    抽成函数是为了让单测可 monkeypatch（不依赖真实 Windows API）。
    """
    try:
        import ctypes  # 仅 Windows 运行时需要

        return ctypes.windll.user32.GetSystemMetrics  # type: ignore[attr-defined]
    except Exception:
        return None


def rect_visible(rc, vleft: int, vtop: int, vw: int, vh: int) -> bool:
    """窗口矩形 rc 是否与虚拟屏矩形 [vleft,vleft+vw) × [vtop,vtop+vh) 相交（=用户可见）。

    rc 需有 left/top/right/bottom 属性（ctypes RECT 或等价对象）。
    不相交 → False（完全在屏外，静默）。压边界一像素也算相交 → True。
    """
    return not (
        rc.right <= vleft
        or rc.left >= vleft + vw
        or rc.bottom <= vtop
        or rc.top >= vtop + vh
    )


def compute_offscreen_x(win_width: int = 1200) -> int:
    """从所有显示器并集（虚拟屏）几何推导离屏 X：移到最左显示器左界之外。

    禁止写死环境假设值（如 -2600）——多屏 / 不同屏幕几何上写死值会落在可见区。
    正解 = 取虚拟屏最左边界 SM_XVIRTUALSCREEN，再减去窗口宽度和余量，确保整窗在所有显示器之外。

      vleft = GetSystemMetrics(76)   # SM_XVIRTUALSCREEN  所有显示器并集左界
      OFFSCREEN_X = vleft - win_width - 200

    非 Windows / 调用失败 → 回退 OFFSCREEN_X_FALLBACK（-2600），绝不抛。
    """
    # 防御：win_width 非正（负值/0）会让窗口算不出真离屏，钳到一个保守宽度（典型微信窗 ~1200）
    if not isinstance(win_width, int) or win_width <= 0:
        win_width = 1200
    gsm = _get_system_metrics()
    if gsm is None:
        return OFFSCREEN_X_FALLBACK
    try:
        vleft = int(gsm(76))  # SM_XVIRTUALSCREEN
    except Exception:
        # API 调用 / 类型转换失败 → 回退兜底，绝不抛
        return OFFSCREEN_X_FALLBACK
    return vleft - win_width - 200


OFFSCREEN_X: int = compute_offscreen_x()
"""静默模式下微信窗口移到的 X 坐标（负值 = 屏幕左边界之外）。
   【几何推导】模块加载时 compute_offscreen_x() 从虚拟屏最左界推导（不写死），
     如 ROG 单屏 vleft=0 → -1400；左侧多一屏 vleft=-1920 → -3320。
   【machine.config.json 覆盖】显式写 OFFSCREEN_X 时仍优先（显式 > 推导，见文件末尾覆盖逻辑）。
   【非 Windows / 推导失败】回退 OFFSCREEN_X_FALLBACK = -2600。"""

OFFSCREEN_Y: int = 60
"""静默模式下微信窗口的 Y 坐标（60 = 距顶部 60px，UIA 需要非零值）"""

REAL_PUBLISH: bool = True
"""True = 真实发送消息
   False = dryrun 模式（只打印，不控制微信）
   【首次部署新机器建议先设 False 验证环境，确认无误再改 True】"""

# ── 回复延迟与人工优先 ────────────────────────────────────
REPLY_DELAY_SECONDS: float = 2.0
"""收到私聊后等约 2 秒再回（拟人，避免秒回露馅）。
   listen_chat 在确认要回复某条消息之后、实际发送之前 sleep 这么久。"""

HUMAN_PRIORITY_WAIT_SECONDS: float = 25.0
"""操作者手动介入某会话后，该会话 AI 回复等待从 REPLY_DELAY 延长到这个值，
   留时间给人工先回（约 25s）。等待窗口结束后需重新检查：若期间人工已回该条 → 跳过不回。"""

REPLY_DIRECTION_CHECK: bool = False
"""不回自己/人工优先的消息方向检测开关。
   True = 读最后气泡方向，右对齐判我方→跳过(防回自己/回操作者)；
   False = 关闭方向检测，对所有未读消息都回(真机阈值未校准前默认关，否则会把收到的消息误判成我方而永不回)。
   真机校准 _last_bubble_direction 的气泡位置阈值后再改回 True。"""

# ── 频控限制 ──────────────────────────────────────────────
CHAT_PER_MINUTE_LIMIT: int = 0
"""私聊每分钟最多回复条数。0 = 不限私聊条数（客服不设每分钟硬上限）；
   >0 才启用每分钟上限（防封号）。注意：操作间隔≥1s 与去重冷却仍照常生效。"""

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

UPDATE_LOCK_INTERVAL_SECONDS: int = 300
"""关死微信自动更新的重施间隔（秒）。微信会恢复更新器，每隔此时间重施一次 + verify。
默认 5 分钟（24h 待机工作机：足够压住自升，又不过度 taskkill）。"""

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
WECHAT_MIN_VERSION: tuple = (4, 1, 8)
"""支持的微信最低版本。只认 4.1.8.x（高于低于都不行）：
   < 4.1.8 控件配方不一致、>= 4.1.9 无障碍控件树被砍，均 RPA 不可用。"""

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
    print(f"  方向检测      REPLY_DIRECTION_CHECK = {REPLY_DIRECTION_CHECK}  ({'读气泡方向跳过我方' if REPLY_DIRECTION_CHECK else '关闭（对所有未读都回）'})")
    print(f"  微信版本限制  {WECHAT_MIN_VERSION} ~ {WECHAT_MAX_VERSION}")
    print(f"  心跳间隔      HEARTBEAT       = {HEARTBEAT_INTERVAL_SECONDS}s")
    print(f"  主循环间隔    POLL            = {MAIN_LOOP_POLL_INTERVAL_SECONDS}s")
    print("=" * 55)
