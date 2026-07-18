# services/agent/build-modules/line04/wechat-rpa/voice_call/audio_bridge.py
# GP-A 虚拟声卡音频桥接
#
# 关键设计约束（I-2/I-4/I-5/N-5/N-6）：
#   I-2  音频设备阻断启动：启动前 preflight 检测通过才能调用
#   I-4  合规开场白不可跳过：接通后第一句必须是合规语
#   I-5  WebSocket 断线不静默：最多 3 次重连，间隔 2 秒，超限则 fail + 挂断
#   N-5  设备名动态发现：sounddevice.query_devices() + VB-Audio / VoiceMeeter 关键词
#   N-6  合规开场白固定文本（含产品名占位符）
#
# 音频路由（Windows 虚拟声卡）：
#   WDM-KS 写入 → VB-Audio Cable Input → 微信进程读入（对方听到）
#   WASAPI 读取 ← VoiceMeeter AUX Output ← 微信进程写出（对方声音）
#
# WebSocket 端点：豆包 ASR/TTS 中继（ws://localhost:8765 或远程）

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Callable

logger = logging.getLogger('[gpa-voice]audio_bridge')

# ─── 合规开场白（I-4 + N-6）──────────────────────────────────────────────────

# 合规开场白必须是接通后第一句话（I-4）。
# 格式：「您好，我是 {企业名} 的智能语音助手」（N-6 固定结构）
COMPLIANCE_OPENING = '您好，我是您企业的智能语音助手，本次通话将全程录音，感谢您的接听。'

# 也可由 system_prompt 配置传入（覆盖上面的默认值）
DEFAULT_SYSTEM_PROMPT = (
    '你是一名企业的智能语音助手。接通后第一句必须播出合规开场白，内容为：'
    f'"{COMPLIANCE_OPENING}"。禁止跳过。'
)

# ─── 设备关键词（N-5）────────────────────────────────────────────────────────

_OUTPUT_KEYWORDS = ['VB-Audio', 'CABLE Input', 'VoiceMeeter Input']
_INPUT_KEYWORDS = ['VoiceMeeter', 'VB-Audio', 'CABLE Output', 'AUX']

# ─── WebSocket 重连参数（I-5）────────────────────────────────────────────────

MAX_RECONNECT = 3    # 最多 3 次重连
RECONNECT_INTERVAL = 2  # 重连间隔（秒）


# ─── 音频设备发现（N-5）──────────────────────────────────────────────────────

def _query_audio_devices() -> list[dict[str, Any]]:
    """sounddevice.query_devices() 封装，不可用时返回空列表。"""
    try:
        import sounddevice as sd  # type: ignore[import]
        raw = sd.query_devices()
        return list(raw) if hasattr(raw, '__iter__') else [raw]
    except ImportError:
        logger.warning('[gpa-voice] sounddevice 未安装（CI 环境）')
        return []
    except Exception as exc:
        logger.error('[gpa-voice] query_devices 失败: %s', exc)
        return []


def _find_output_device(devices: list[dict[str, Any]]) -> dict[str, Any] | None:
    """查找 WDM-KS 输出设备（VB-Audio / VoiceMeeter Input，N-5）。"""
    for d in devices:
        name = str(d.get('name', ''))
        if int(d.get('max_output_channels', 0)) > 0:
            for kw in _OUTPUT_KEYWORDS:
                if kw.lower() in name.lower():
                    return d
    return None


def _find_input_device(devices: list[dict[str, Any]]) -> dict[str, Any] | None:
    """查找 WASAPI 输入设备（VoiceMeeter / VB-Audio，N-5）。"""
    for d in devices:
        name = str(d.get('name', ''))
        if int(d.get('max_input_channels', 0)) > 0:
            for kw in _INPUT_KEYWORDS:
                if kw.lower() in name.lower():
                    return d
    return None


# ─── 合规开场白 TTS 播放（I-4 + N-6）────────────────────────────────────────

def _play_compliance_opening(
    output_device_name: str,
    system_prompt: str | None = None,
) -> None:
    """
    播放合规开场白到 WDM-KS 输出设备（I-4 + N-6）。
    必须是接通后第一个操作（串行，非并发）。
    """
    opening_text = system_prompt or COMPLIANCE_OPENING
    logger.info('[gpa-voice] 播放合规开场白: %r → 设备 %r', opening_text, output_device_name)
    # 真机实现：调用 TTS API 生成音频 → 写入 WDM-KS 输出设备
    # Skeleton 阶段：记录日志，占位
    logger.info('[gpa-voice] [TODO: TTS播放合规开场白] %s', opening_text)


# ─── WebSocket 音频中继（I-5）────────────────────────────────────────────────

async def _connect_with_retry(ws_url: str, on_disconnect: Callable | None = None) -> Any:
    """
    WebSocket 断线重连（I-5）：
    最多 MAX_RECONNECT(3) 次，间隔 RECONNECT_INTERVAL(2) 秒。
    超限后通知 on_disconnect 回调（非静默丢弃）。
    """
    try:
        import websockets  # type: ignore[import]
    except ImportError:
        logger.warning('[gpa-voice] websockets 未安装（CI 环境），跳过 WebSocket 中继')
        return None

    reconnect_count = 0
    last_exc: Exception | None = None

    while reconnect_count <= MAX_RECONNECT:
        try:
            conn = await websockets.connect(ws_url)
            if reconnect_count > 0:
                logger.info('[gpa-voice] WebSocket 重连成功（第 %d 次）', reconnect_count)
            return conn
        except Exception as exc:
            last_exc = exc
            reconnect_count += 1
            if reconnect_count <= MAX_RECONNECT:
                logger.warning(
                    '[gpa-voice] WebSocket 连接失败（%d/%d），%ds 后重试: %s',
                    reconnect_count,
                    MAX_RECONNECT,
                    RECONNECT_INTERVAL,
                    exc,
                )
                await asyncio.sleep(RECONNECT_INTERVAL)
            else:
                logger.error(
                    '[gpa-voice] WebSocket 达到重连上限 %d 次，判定失败: %s',
                    MAX_RECONNECT,
                    exc,
                )
                if on_disconnect:
                    on_disconnect(reason=f'WebSocket 断线重连失败（{MAX_RECONNECT} 次）: {exc}')
                return None

    return None


# ─── 音频桥接主函数 ───────────────────────────────────────────────────────────

def start_audio_bridge(
    ws_url: str = 'ws://localhost:8765',
    system_prompt: str | None = None,
    on_disconnect: Callable | None = None,
    output_device_name: str | None = None,
    input_device_name: str | None = None,
) -> dict[str, Any]:
    """
    启动虚拟声卡音频桥接（WDM-KS 写入 + WASAPI 读取 + 豆包 WebSocket 中继）。

    必须在 voice_call_preflight() 通过后调用（I-2）。
    合规开场白在接通后第一句串行播出（I-4 + N-6）。
    WebSocket 断线最多重连 3 次 × 2s（I-5）。

    参数：
      ws_url             — 豆包 ASR/TTS WebSocket 端点
      system_prompt      — 合规开场白文本（None → 使用默认值）
      on_disconnect      — WebSocket 断线超限回调（用于触发 safe_hangup）
      output_device_name — WDM-KS 输出设备名（None → 动态发现）
      input_device_name  — WASAPI 输入设备名（None → 动态发现）

    返回：
      {'status': 'ok', 'output_device': '...', 'input_device': '...'}
      {'status': 'device_error', 'reason': '...'}
      {'status': 'ws_error', 'reason': '...'}
    """
    logger.info('[gpa-voice] start_audio_bridge: 初始化音频桥接 ws=%s', ws_url)

    # 1. 动态发现音频设备（N-5）
    if output_device_name is None or input_device_name is None:
        devices = _query_audio_devices()
        if output_device_name is None:
            out_dev = _find_output_device(devices)
            output_device_name = out_dev['name'] if out_dev else None
        if input_device_name is None:
            in_dev = _find_input_device(devices)
            input_device_name = in_dev['name'] if in_dev else None

    if output_device_name is None:
        reason = f'未找到 WDM-KS 输出设备（关键词: {_OUTPUT_KEYWORDS}）'
        logger.error('[gpa-voice] audio_bridge device_error: %s', reason)
        return {'status': 'device_error', 'reason': reason}

    if input_device_name is None:
        reason = f'未找到 WASAPI 输入设备（关键词: {_INPUT_KEYWORDS}）'
        logger.error('[gpa-voice] audio_bridge device_error: %s', reason)
        return {'status': 'device_error', 'reason': reason}

    logger.info(
        '[gpa-voice] 音频设备: WDM-KS输出=%r, WASAPI输入=%r',
        output_device_name,
        input_device_name,
    )

    # 2. 合规开场白（I-4 + N-6）— 必须是接通后第一个操作（串行）
    _play_compliance_opening(output_device_name, system_prompt or DEFAULT_SYSTEM_PROMPT)

    # 3. 建立 WebSocket 中继（I-5，最多 3 次重连）
    try:
        loop = asyncio.new_event_loop()
        ws_conn = loop.run_until_complete(
            _connect_with_retry(ws_url, on_disconnect=on_disconnect)
        )
        loop.close()
    except Exception as exc:
        logger.error('[gpa-voice] audio_bridge ws_error: %s', exc)
        return {'status': 'ws_error', 'reason': str(exc)}

    if ws_conn is None:
        # CI 环境或 websockets 未安装 → 骨架阶段不 fail，记录 warning
        logger.warning('[gpa-voice] WebSocket 未建立（CI 环境或驱动不可用），骨架阶段跳过')

    logger.info('[gpa-voice] start_audio_bridge OK: 桥接已就绪')
    return {
        'status': 'ok',
        'output_device': output_device_name,
        'input_device': input_device_name,
        'ws_connected': ws_conn is not None,
    }
