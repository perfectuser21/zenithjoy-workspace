# services/agent/build-modules/line04/wechat-rpa/voice_call/__init__.py
# GP-A 主动语音触达模块导出
#
# 模块结构：
#   call_rpa.py      — RPA 拨号执行（联系人精确匹配 / 拨号 / 接通判定 / 挂断）
#   audio_bridge.py  — 虚拟声卡音频桥接（WDM-KS 写入 + WASAPI 读取 + 豆包中继）
#   call_recorder.py — 通话记录回写中台 API
#   preflight.py     — 启动前置检查（音频设备自检，阻断式）

from .call_rpa import (
    locate_contact,
    trigger_voice_call,
    wait_for_answer,
    wait_for_hangup,
    safe_hangup,
    make_voice_call,
)
from .audio_bridge import start_audio_bridge
from .call_recorder import write_call_record
from .preflight import voice_call_preflight

__all__ = [
    'locate_contact',
    'trigger_voice_call',
    'wait_for_answer',
    'wait_for_hangup',
    'safe_hangup',
    'make_voice_call',
    'start_audio_bridge',
    'write_call_record',
    'voice_call_preflight',
]
