# services/agent/build-modules/line04/wechat-rpa/voice_call/preflight.py
# GP-A 启动前置检查 — 音频设备阻断式自检（I-2）
#
# 规则：
#   - WDM-KS 输出设备（VB-Audio Cable Input / VoiceMeeter Input）必须可发现
#   - WASAPI 输入设备（VoiceMeeter AUX Output 或等价）必须可发现
#   - 任一失败 → 立即返回 device_error，不进入拨号流程（阻断）
#   - 设备名动态发现（N-5）：sounddevice.query_devices() + 关键词匹配（VB-Audio / VoiceMeeter）
#
# 使用：
#   result = voice_call_preflight()
#   if result['status'] != 'ok':
#       print(f"[gpa-voice] preflight FAIL: {result}")
#       sys.exit(1)

from __future__ import annotations

import logging
import sys
from typing import Any

logger = logging.getLogger('[gpa-voice]preflight')

# 设备名关键词（N-5 动态匹配，不硬编码完整名）
_WDM_KS_OUTPUT_KEYWORDS = ['VB-Audio', 'CABLE Input', 'VoiceMeeter Input']
_WASAPI_INPUT_KEYWORDS = ['VoiceMeeter', 'VB-Audio', 'CABLE Output', 'AUX']


def _list_audio_devices() -> list[dict[str, Any]]:
    """
    枚举系统音频设备（sounddevice.query_devices()）。
    返回设备字典列表，每项含 name / max_output_channels / max_input_channels / hostapi_info。
    在非 Windows / 无驱动环境返回空列表（由调用方判断 device_error）。
    """
    try:
        import sounddevice as sd  # type: ignore[import]
        raw = sd.query_devices()
        if hasattr(raw, '__iter__'):
            return list(raw)
        return [raw]
    except ImportError:
        logger.warning('[gpa-voice] sounddevice 未安装，跳过设备枚举（非 Windows 环境）')
        return []
    except Exception as exc:
        logger.error('[gpa-voice] query_devices 失败: %s', exc)
        return []


def _find_device_by_keywords(
    devices: list[dict[str, Any]],
    keywords: list[str],
    channel_key: str,
) -> dict[str, Any] | None:
    """
    在 devices 中按关键词搜索设备名（不区分大小写）。
    channel_key: 'max_output_channels' 或 'max_input_channels'
    """
    for device in devices:
        name = str(device.get('name', ''))
        channels = int(device.get(channel_key, 0))
        if channels > 0:
            for kw in keywords:
                if kw.lower() in name.lower():
                    return device
    return None


def voice_call_preflight() -> dict[str, Any]:
    """
    音频设备启动前置检查（阻断式，I-2）。

    返回值：
      {'status': 'ok', 'output_device': '...', 'input_device': '...'}
      {'status': 'device_error', 'reason': '...'}
    """
    logger.info('[gpa-voice] preflight 开始：枚举音频设备')
    devices = _list_audio_devices()

    if not devices:
        # 非 Windows / 无音频驱动环境 → 在 CI 或开发机返回 device_error（阻断）
        logger.warning('[gpa-voice] preflight: 无音频设备（可能是 CI 环境或未安装驱动）')
        return {
            'status': 'device_error',
            'reason': '无法枚举音频设备（sounddevice 返回空列表或未安装）',
            'output_device': None,
            'input_device': None,
        }

    # WDM-KS 输出设备（VB-Audio / VoiceMeeter Input 类）
    output_device = _find_device_by_keywords(
        devices,
        _WDM_KS_OUTPUT_KEYWORDS,
        'max_output_channels',
    )

    # WASAPI 输入设备（VoiceMeeter AUX Output / VB-Audio 类）
    input_device = _find_device_by_keywords(
        devices,
        _WASAPI_INPUT_KEYWORDS,
        'max_input_channels',
    )

    if output_device is None:
        reason = (
            f'未找到 WDM-KS 输出设备（关键词: {_WDM_KS_OUTPUT_KEYWORDS}）。'
            '请安装 VB-Audio Cable 或 VoiceMeeter 并重启驱动。'
        )
        logger.error('[gpa-voice] preflight FAIL: %s', reason)
        return {'status': 'device_error', 'reason': reason}

    if input_device is None:
        reason = (
            f'未找到 WASAPI 输入设备（关键词: {_WASAPI_INPUT_KEYWORDS}）。'
            '请确认 VoiceMeeter AUX Output 或 VB-Audio 输入端已启用。'
        )
        logger.error('[gpa-voice] preflight FAIL: %s', reason)
        return {'status': 'device_error', 'reason': reason}

    output_name = output_device.get('name', 'unknown')
    input_name = input_device.get('name', 'unknown')

    logger.info('[gpa-voice] preflight OK: WDM-KS 输出=%s, WASAPI 输入=%s', output_name, input_name)
    return {
        'status': 'ok',
        'output_device': output_name,
        'input_device': input_name,
    }


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    result = voice_call_preflight()
    if result['status'] != 'ok':
        print(f'[gpa-voice] preflight FAIL: {result["reason"]}')
        sys.exit(1)
    print(f'[gpa-voice] preflight OK')
    print(f'  WDM-KS 输出: {result["output_device"]}')
    print(f'  WASAPI 输入: {result["input_device"]}')
