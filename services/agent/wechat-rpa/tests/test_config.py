"""
test_config.py — 验证 config.py 所有必要参数存在且类型正确
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config


def test_user_facing_params_exist():
    """所有用户可调参数必须存在"""
    assert isinstance(config.OFFSCREEN_REPLY, bool)
    assert isinstance(config.OFFSCREEN_X, int)
    assert isinstance(config.OFFSCREEN_Y, int)
    assert isinstance(config.REAL_PUBLISH, bool)
    assert isinstance(config.CHAT_PER_MINUTE_LIMIT, int)
    assert isinstance(config.MOMENT_PER_24H_LIMIT, int)
    assert isinstance(config.MIN_OPERATION_INTERVAL_SECONDS, float)
    assert isinstance(config.SENDER_COOLDOWN_SECONDS, float)
    assert isinstance(config.REPLIED_TTL_SECONDS, int)
    assert isinstance(config.REPLY_FAILURE_COOLDOWN_SECONDS, int)
    assert isinstance(config.HEARTBEAT_INTERVAL_SECONDS, int)
    assert isinstance(config.UIA_REACTIVATE_INTERVAL_SECONDS, int)
    assert isinstance(config.WECHAT_LAUNCH_COOLDOWN_SECONDS, int)
    assert isinstance(config.MAIN_LOOP_POLL_INTERVAL_SECONDS, int)
    assert isinstance(config.WECHAT_EXE_DEFAULT_PATH, str)


def test_default_values_are_safe():
    """默认值必须是合理的安全值"""
    assert config.OFFSCREEN_REPLY is False, "默认必须窗口可见模式（B 方案，PrepPRD 06211342），不藏屏外"
    # 离屏坐标必须【真在屏外】——按机器几何判断，不写死阈值：整窗(默认宽1200)在虚拟屏左界之外；
    # 非 Windows（CI）取不到几何 → 回退到兜底负值 OFFSCREEN_X_FALLBACK。
    import ctypes as _ct
    try:
        _vleft = _ct.windll.user32.GetSystemMetrics(76)  # SM_XVIRTUALSCREEN
        assert config.OFFSCREEN_X + 1200 <= _vleft, \
            f"窗口右界({config.OFFSCREEN_X}+1200)须在虚拟屏左界({_vleft})之外，实际未越界"
    except (AttributeError, OSError):
        assert config.OFFSCREEN_X == config.OFFSCREEN_X_FALLBACK, "非 Windows 须回退兜底值"
    assert config.CHAT_PER_MINUTE_LIMIT >= 0  # 0 = 不限私聊每分钟条数（客服不设硬上限）
    assert config.MOMENT_PER_24H_LIMIT >= 1
    assert config.SENDER_COOLDOWN_SECONDS >= 10
    assert config.WECHAT_MAX_VERSION < (4, 1, 9), "不能支持 4.1.9+（UIA 被砍）"


def test_wechat_version_range():
    """微信版本范围合理"""
    assert config.WECHAT_MIN_VERSION < config.WECHAT_MAX_VERSION
    assert config.WECHAT_MAX_VERSION[0] == 4
    assert config.WECHAT_MAX_VERSION[1] == 1
    assert config.WECHAT_MAX_VERSION[2] == 8


def test_print_config_callable():
    """print_config 必须可调用且不抛异常"""
    config.print_config()  # 不应该抛出任何异常


def test_machine_override_non_existent_file(tmp_path, monkeypatch):
    """不存在的 machine.config.json 不影响默认值"""
    import importlib
    monkeypatch.setenv("ZENITHJOY_CORE_DIR", str(tmp_path / "nonexistent"))
    importlib.reload(config)
    assert config.OFFSCREEN_REPLY is False
    # 无 machine.config 覆盖时，OFFSCREEN_X == 几何推导的默认值（真机推导/非Windows回退），不写死 -2600
    assert config.OFFSCREEN_X == config.compute_offscreen_x()
