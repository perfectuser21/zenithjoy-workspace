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
    assert config.OFFSCREEN_REPLY is True, "默认必须静默后台，不能台前弹窗"
    # 离屏坐标必须把整窗放到虚拟屏最左界【之外】，不写死阈值（如 -2000）：
    # 真机单屏 vleft=0 → 推导 -1400（窗右界 -200，仍在屏外），写死 <=-2000 会误判。
    # 正确性属性 = 窗口右界(OFFSCREEN_X + win_width)严格小于虚拟屏左界 vleft。
    if config.OFFSCREEN_X == config.OFFSCREEN_X_FALLBACK:
        # 非 Windows / 推导失败 → 回退兜底（单屏够用，无 vleft 可验）
        assert config.OFFSCREEN_X <= -2000, "回退兜底值必须足够负"
    else:
        # Windows 几何推导值：窗右界必须落在虚拟屏左界之外
        import config as _cfg
        gsm = _cfg._get_system_metrics()
        vleft = int(gsm(76)) if gsm is not None else 0  # SM_XVIRTUALSCREEN
        assert config.OFFSCREEN_X + 1200 < vleft, \
            f"窗右界({config.OFFSCREEN_X + 1200})必须 < 虚拟屏左界({vleft})，确保整窗屏外"
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
    """不存在的 machine.config.json 不影响默认值（无覆盖时 = 几何推导值，不写死 -2600）"""
    import importlib
    monkeypatch.setenv("ZENITHJOY_CORE_DIR", str(tmp_path / "nonexistent"))
    importlib.reload(config)
    assert config.OFFSCREEN_REPLY is True
    # 无 machine.config.json 覆盖时，OFFSCREEN_X 必须等于几何推导结果：
    # CI Linux / 推导失败 → 回退 -2600；真机 Windows → 从虚拟屏左界推导（如 ROG 单屏 -1400）。
    # 断言验证的是「没有外部 override」，不是某个写死数字。
    assert config.OFFSCREEN_X == config.compute_offscreen_x()
