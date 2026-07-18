# services/agent/build-modules/line04/wechat-rpa/voice_call/call_recorder.py
# GP-A 通话记录回写中台 API
#
# 职责（N-2/N-3）：
#   - POST /api/cs/voice-outreach/records 写入通话记录
#   - 含 tenant_id 多租户字段（N-3）
#   - 结构化日志带 [gpa-voice] 前缀（N-2）
#
# 字段说明：
#   tenant_id       — 多租户隔离（N-3，必填）
#   contact_name    — 被叫联系人姓名
#   wechat_account  — 主账号（weixin 唯一标识）
#   status          — answered / no_answer / failed
#   duration_seconds — 实际通话秒数（no_answer / failed 时为 0）
#   called_at       — 发起拨打时间戳（ISO 8601）

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import requests  # HTTP 客户端

logger = logging.getLogger('[gpa-voice]call_recorder')

# ─── 状态枚举（与 DB migration 保持一致）────────────────────────────────────

CALL_STATUS_ANSWERED = 'answered'
CALL_STATUS_NO_ANSWER = 'no_answer'
CALL_STATUS_FAILED = 'failed'

VALID_STATUSES = {CALL_STATUS_ANSWERED, CALL_STATUS_NO_ANSWER, CALL_STATUS_FAILED}


def write_call_record(
    tenant_id: str,
    contact_name: str,
    status: str,
    duration_seconds: int = 0,
    wechat_account: str | None = None,
    called_at: str | None = None,
    api_base_url: str = 'http://localhost:3000',
    auth_token: str | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    将通话结果 POST 到中台 /api/cs/voice-outreach/records（N-3 多租户）。

    参数：
      tenant_id        — 租户 ID（必填，N-3 多租户隔离）
      contact_name     — 被叫联系人姓名
      status           — 'answered' | 'no_answer' | 'failed'
      duration_seconds — 通话时长（秒），no_answer/failed 时为 0
      wechat_account   — 发起拨号的微信账号
      called_at        — 拨打时间（None → 自动用当前时间）
      api_base_url     — 中台 API base URL
      auth_token       — 认证 token（可选）
      extra            — 扩展字段（可选）

    返回：
      {'ok': True,  'call_id': '...', 'status': status}
      {'ok': False, 'error': '...', 'status_code': N}
    """
    if status not in VALID_STATUSES:
        logger.error(
            '[gpa-voice] write_call_record: 非法 status=%r，有效值: %s',
            status,
            VALID_STATUSES,
        )
        return {'ok': False, 'error': f'非法 status: {status!r}'}

    ts = called_at or datetime.now(timezone.utc).isoformat()

    payload: dict[str, Any] = {
        'tenant_id': tenant_id,
        'contact_name': contact_name,
        'status': status,
        'duration_seconds': duration_seconds,
        'called_at': ts,
    }
    if wechat_account:
        payload['wechat_account'] = wechat_account
    if extra:
        payload.update(extra)

    url = f'{api_base_url.rstrip("/")}/api/cs/voice-outreach/records'
    headers = {'Content-Type': 'application/json'}
    if auth_token:
        headers['Authorization'] = f'Bearer {auth_token}'

    logger.info(
        '[gpa-voice] write_call_record: POST %s tenant=%r contact=%r status=%r duration=%ds',
        url,
        tenant_id,
        contact_name,
        status,
        duration_seconds,
    )

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        if resp.status_code in (200, 201):
            data = resp.json() if resp.content else {}
            call_id = data.get('call_id') or data.get('data', {}).get('call_id', '')
            logger.info('[gpa-voice] write_call_record OK: call_id=%r', call_id)
            return {'ok': True, 'call_id': call_id, 'status': status}
        else:
            logger.error(
                '[gpa-voice] write_call_record FAIL: HTTP %d %s',
                resp.status_code,
                resp.text[:200],
            )
            return {'ok': False, 'error': resp.text[:200], 'status_code': resp.status_code}
    except requests.exceptions.ConnectionError as exc:
        logger.error('[gpa-voice] write_call_record 连接失败: %s', exc)
        return {'ok': False, 'error': f'连接失败: {exc}'}
    except requests.exceptions.Timeout:
        logger.error('[gpa-voice] write_call_record 超时')
        return {'ok': False, 'error': '请求超时（10s）'}
    except Exception as exc:
        logger.error('[gpa-voice] write_call_record 未知异常: %s', exc)
        return {'ok': False, 'error': str(exc)}
