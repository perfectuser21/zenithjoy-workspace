"""
RTC Voice Manager — GP-A 语音引擎迁移（thin 骨架 stub）

合同: Step 4 (I-9/I-10/I-11)
- StartVoiceChat/StopVoiceChat OpenAPI 封装（stub，不需真实 IAM 签名）
- 超时控制：I-9=5s（签发 token），I-10=10s（sidecar 入房）
- I-11：等待 OnUserJoined 事件（非仅信 HTTP 200）

NFR N-1: AK/SK 从环境变量读取，不入 git
NFR N-2: sidecar 崩溃直接 call failed，不做看门狗
"""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger('[gpa-voice]rtc_voice_manager')

# ─── 内部 stub 实现（thin 骨架）────────────────────────────────────────────────

def _call_start_api(*, timeout: int = 5) -> dict[str, Any]:
    """调用 StartVoiceChat OpenAPI（thin stub）。

    真实实现：POST https://rtc.volcengineapi.com/?Action=StartVoiceChat
    签名：HMAC-SHA256（AK/SK 从环境变量 VOLCENGINE_AK / VOLCENGINE_SK 读取）
    """
    logger.info('[rtc] StartVoiceChat stub called (timeout=%d)', timeout)
    # stub: 返回模拟 room_id/token
    return {
        'room_id': f'stub-room-{int(time.time())}',
        'token': 'stub-token-abc123',
    }


def _call_stop_api(*, room_id: str, token: str) -> dict[str, Any]:
    """调用 StopVoiceChat OpenAPI（thin stub）。"""
    logger.info('[rtc] StopVoiceChat stub called room_id=%s', room_id)
    return {'status': 'ok'}


def _wait_for_on_user_joined(room_id: str, timeout: int = 5) -> bool:
    """等待 OnUserJoined 事件（I-11：非仅信 HTTP 200）。

    thin stub: 模拟 500ms 延迟后收到事件。
    真实实现：监听 RTC SDK 回调 OnUserJoined。
    """
    logger.info('[rtc] Waiting for OnUserJoined (room=%s, timeout=%d)', room_id, timeout)
    time.sleep(0.1)  # stub: 模拟网络延迟
    return True


def _rtc_join(*, room_id: str, token: str) -> dict[str, Any]:
    """sidecar 加入 RTC 房间（thin stub）。"""
    logger.info('[rtc] RTC join stub room=%s', room_id)
    return {'status': 'ok'}


# ─── 公开 API ──────────────────────────────────────────────────────────────────

def start_voice_chat(*, timeout: int = 5) -> dict[str, Any]:
    """
    启动语音对话（StartVoiceChat）。

    I-9: timeout=5（RTC Token 超时判失败）
    I-11: 调用后等待 OnUserJoined 事件（非仅信 HTTP 200）

    返回：
        {'room_id': '...', 'token': '...', 'status': 'ok'}
        {'status': 'failed', 'reason': '...'}
    """
    try:
        result = _call_start_api(timeout=timeout)
        room_id = result['room_id']
        token = result['token']

        # I-11: 等待 AI Agent 真正入场（OnUserJoined 事件）
        joined = _wait_for_on_user_joined(room_id, timeout=5)
        if not joined:
            logger.error('[rtc] AI Agent 未收到 OnUserJoined 事件（I-11 失败）')
            stop_voice_chat(room_id=room_id, token=token)
            return {'status': 'failed', 'reason': 'ai_agent_not_joined'}

        return {'room_id': room_id, 'token': token, 'status': 'ok'}

    except TimeoutError as exc:
        logger.error('[rtc] start_voice_chat timeout: %s', exc)
        return {'status': 'failed', 'reason': str(exc)}
    except Exception as exc:
        logger.error('[rtc] start_voice_chat error: %s', exc)
        return {'status': 'failed', 'reason': str(exc)}


def stop_voice_chat(*, room_id: str, token: str) -> dict[str, Any]:
    """
    停止语音对话（StopVoiceChat）。

    返回：
        {'status': 'ok'}
        {'status': 'failed', 'reason': '...'}
    """
    try:
        return _call_stop_api(room_id=room_id, token=token)
    except Exception as exc:
        logger.error('[rtc] stop_voice_chat error: %s', exc)
        return {'status': 'failed', 'reason': str(exc)}


def join_rtc_room(*, room_id: str, token: str, timeout: int = 10) -> dict[str, Any]:
    """
    sidecar 加入 RTC 房间。

    I-10: timeout=10（入房超时判失败清理）

    返回：
        {'status': 'ok'}
        {'status': 'failed', 'reason': '...'}
    """
    try:
        result = _rtc_join(room_id=room_id, token=token)
        return result
    except TimeoutError as exc:
        logger.error('[rtc] sidecar 入房超时 (I-10): %s', exc)
        return {'status': 'failed', 'reason': str(exc)}
    except Exception as exc:
        logger.error('[rtc] join_rtc_room error: %s', exc)
        return {'status': 'failed', 'reason': str(exc)}
