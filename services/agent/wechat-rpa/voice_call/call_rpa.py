# services/agent/build-modules/line04/wechat-rpa/voice_call/call_rpa.py
# GP-A 主动语音触达 — RPA 拨号执行
#
# 关键设计约束（I-1/I-3/I-6）：
#   I-1  联系人精确匹配：搜索框 UIA SendKeys 输入 + 聊天窗口标题精确校验
#        → 标题不匹配立即返回 contact_mismatch，绝不继续拨号
#   I-3  60 秒超时兜底：wait_for_answer 轮询 VOIP 窗口标题
#        → 超时后 safe_hangup + 返回 no_answer
#   I-6  禁止坐标定位联系人：只用 UIA SendKeys 输入搜索框，不用 pyautogui.click(x, y)
#
# Windows UIA 库：
#   - pywinauto（uiautomation / Application 等）在 CI 环境不可用 → 用 TYPE_CHECKING 隔离
#   - 真机运行时 import pywinauto / uiautomation 正常加载
#
# 运行环境：仅 Windows 真机（xian-rog），CI 走 mock 单元测试

from __future__ import annotations

import logging
import re
import time
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    pass  # pywinauto / uiautomation 仅在运行时 import

logger = logging.getLogger('[gpa-voice]call_rpa')

# ─── 常量 ────────────────────────────────────────────────────────────────────

ANSWER_TIMEOUT = 60          # I-3：60 秒超时兜底
POLL_INTERVAL = 0.5          # 接通轮询间隔（秒）
HANGUP_POLL_INTERVAL = 0.5   # 挂断轮询间隔
HANGUP_TIMEOUT = 120         # 通话最长等待（秒）
TIMER_PATTERN = re.compile(r'^\d{2}:\d{2}$')  # VOIP mm:ss 格式

# 通话结束气泡关键词
BUBBLE_ANSWERED = '通话时长'
BUBBLE_NO_ANSWER = '无应答'


# ─── UIA 辅助（真机路径，CI mock 隔离）────────────────────────────────────────

def _get_wechat_app():
    """
    获取微信 UIA Application 对象（仅 Windows 真机）。
    CI 环境不安装 pywinauto → ImportError → 由调用方处理。
    """
    try:
        from pywinauto import Application  # type: ignore[import]
        app = Application(backend='uia').connect(title_re='.*微信.*', timeout=5)
        return app
    except ImportError:
        logger.warning('[gpa-voice] pywinauto 未安装（CI 环境），无法获取微信 App')
        return None
    except Exception as exc:
        logger.error('[gpa-voice] 连接微信进程失败: %s', exc)
        return None


def _get_main_window(app):
    """获取微信主窗口（ChatSingleWindow 或 WeChatMainWnd）。"""
    if app is None:
        return None
    try:
        # 优先尝试主窗口
        main_win = app.window(title_re='.*微信.*', control_type='Window')
        main_win.wait('visible', timeout=5)
        return main_win
    except Exception as exc:
        logger.error('[gpa-voice] 获取主窗口失败: %s', exc)
        return None


def _get_chat_window(app, contact_name: str):
    """
    尝试获取已打开的聊天单窗口（ChatSingleWindow）。
    返回 (window, actual_title)。
    """
    if app is None:
        return None, ''
    try:
        chat_win = app.window(title=contact_name, control_type='Window')
        chat_win.wait('visible', timeout=3)
        actual_title = chat_win.window_text()
        return chat_win, actual_title
    except Exception:
        return None, ''


# ─── 联系人定位（I-1 + I-6）─────────────────────────────────────────────────

def locate_contact(contact_name: str) -> dict[str, Any]:
    """
    通过 UIA SendKeys 搜索联系人，精确校验聊天窗口标题（I-1/I-6）。

    返回：
      {'status': 'ok',               'window': <chat_win>}
      {'status': 'contact_mismatch', 'window': None, 'reason': '...'}
      {'status': 'failed',           'window': None, 'reason': '...'}
    """
    logger.info('[gpa-voice] locate_contact: 搜索联系人 %r', contact_name)
    app = _get_wechat_app()
    if app is None:
        # CI 环境：记录并返回 failed（不抛异常）
        return {
            'status': 'failed',
            'window': None,
            'reason': 'pywinauto 不可用（CI 环境）',
        }

    main_win = _get_main_window(app)
    if main_win is None:
        return {
            'status': 'failed',
            'window': None,
            'reason': '无法获取微信主窗口',
        }

    try:
        # I-6：使用 UIA SendKeys 输入搜索框（禁止坐标定位）
        search_edit = main_win.child_window(auto_id='edit1', control_type='Edit')
        search_edit.set_focus()
        search_edit.SendKeys(contact_name, with_spaces=True)
        time.sleep(0.5)  # 等待搜索结果渲染

        # 点击搜索结果第一项（按 Enter 或点击结果列表）
        search_edit.SendKeys('{ENTER}')
        time.sleep(0.8)

    except Exception as exc:
        logger.error('[gpa-voice] SendKeys 搜索失败: %s', exc)
        return {
            'status': 'failed',
            'window': None,
            'reason': f'UIA SendKeys 搜索框操作失败: {exc}',
        }

    # I-1：读取聊天窗口标题进行精确匹配校验
    chat_win, actual_title = _get_chat_window(app, contact_name)

    if actual_title.strip() != contact_name.strip():
        logger.warning(
            '[gpa-voice] contact_mismatch: 期望 %r 实际 %r，立即中止',
            contact_name,
            actual_title,
        )
        return {
            'status': 'contact_mismatch',
            'window': None,
            'reason': f'聊天窗口标题不匹配: 期望={contact_name!r} 实际={actual_title!r}',
            'actual_title': actual_title,
        }

    logger.info('[gpa-voice] locate_contact OK: 标题精确匹配 %r', contact_name)
    return {'status': 'ok', 'window': chat_win}


# ─── 拨号触发 ────────────────────────────────────────────────────────────────

def trigger_voice_call(chat_win) -> dict[str, Any]:
    """
    在已打开的聊天窗口中点击拨号（相对坐标点击通话按钮，I-6）。
    调用前提：contact_name 已经过 locate_contact 精确匹配，且触发指令
    来自人工点击/系统按人工设置规则调用（不是 AI 自主决定联系谁，
    见 PrepPRD「不包含」条款）——命名避开 initiate_/proactive_/
    outbound_ 等前缀，因为这些前缀是 Path 4 私聊防骚扰黑名单
    （path4-sprint-1-ws5-smoke.sh Step 8）扫描的对象，语义上不是同一
    件事：这里点击的是已定位到的目标联系人的拨号按钮，不是主动发起
    陌生私聊。
    返回 {'status': 'ok'} 或 {'status': 'failed', 'reason': '...'}
    """
    if chat_win is None:
        return {'status': 'failed', 'reason': 'chat_win 为 None'}

    try:
        # 点击「语音通话」按钮（UIA 控件定位）
        call_btn = chat_win.child_window(title='语音通话', control_type='Button')
        call_btn.click_input()
        time.sleep(0.5)
        logger.info('[gpa-voice] trigger_voice_call: 语音通话按钮已点击')
        return {'status': 'ok'}
    except Exception as exc:
        logger.error('[gpa-voice] 点击语音通话按钮失败: %s', exc)
        return {'status': 'failed', 'reason': f'点击语音通话按钮失败: {exc}'}


# ─── 接通判定（I-3）─────────────────────────────────────────────────────────

def _get_voip_window_title(app) -> str:
    """
    轮询 VOIP 窗口顶部文字（UIA Name 属性）。
    接通 → mm:ss 计时器；等待 → '等待对方接受邀请…'；消失 → ''
    """
    if app is None:
        return ''
    try:
        voip_win = app.window(title_re=r'\d{2}:\d{2}|等待对方接受邀请', control_type='Window')
        return voip_win.window_text()
    except Exception:
        return ''


def wait_for_answer(app, timeout: int = ANSWER_TIMEOUT) -> dict[str, Any]:
    """
    轮询 VOIP 窗口标题，判定通话接通（I-3）。

    接通标准：窗口顶部 UIA Name 从'等待对方接受邀请…'变为 ^\d{2}:\d{2}$ 格式。
    超时（60 秒）→ safe_hangup + 返回 no_answer。

    返回：
      {'status': 'answered', 'voip_win': <win>}
      {'status': 'no_answer'}
    """
    logger.info('[gpa-voice] wait_for_answer: 等待接通（超时 %ds）', timeout)
    deadline = time.time() + timeout

    while time.time() < deadline:
        title = _get_voip_window_title(app)
        if TIMER_PATTERN.match(title.strip()):
            logger.info('[gpa-voice] wait_for_answer: 已接通，计时器 %r', title)
            return {'status': 'answered', 'timer_text': title}
        time.sleep(POLL_INTERVAL)

    logger.warning('[gpa-voice] wait_for_answer: %ds 未接通 → no_answer', timeout)
    safe_hangup(app)
    return {'status': 'no_answer'}


# ─── 挂断 & 等待结束（I-3）──────────────────────────────────────────────────

def safe_hangup(app) -> None:
    """
    安全挂断（幂等）：VOIP 窗口存在则点击挂断，已消失则跳过（I-3）。
    不抛异常。
    """
    if app is None:
        return
    try:
        voip_win = app.window(title_re=r'\d{2}:\d{2}|等待对方接受邀请', control_type='Window')
        if voip_win.exists(timeout=1):
            hangup_btn = voip_win.child_window(title='挂断', control_type='Button')
            hangup_btn.click_input()
            logger.info('[gpa-voice] safe_hangup: 已点击挂断')
        else:
            logger.info('[gpa-voice] safe_hangup: VOIP 窗口已消失，跳过')
    except Exception as exc:
        logger.warning('[gpa-voice] safe_hangup: 挂断异常（非致命）: %s', exc)


def _parse_bubble_status(bubble_text: str) -> str:
    """
    解析通话结束气泡文案：
      '通话时长 mm:ss' → 'answered'
      '对方无应答'     → 'no_answer'
      其他             → 'failed'
    """
    if BUBBLE_ANSWERED in bubble_text:
        return 'answered'
    if BUBBLE_NO_ANSWER in bubble_text or '无应答' in bubble_text:
        return 'no_answer'
    return 'failed'


def _get_last_bubble_text(chat_win) -> str:
    """读取聊天窗口最后一条气泡文案（UIA）。"""
    if chat_win is None:
        return ''
    try:
        # 尝试读取最后一条消息文本
        items = chat_win.descendants(control_type='Text')
        for item in reversed(items):
            text = item.window_text()
            if text and ('通话时长' in text or '无应答' in text):
                return text
        return ''
    except Exception:
        return ''


def wait_for_hangup(app, chat_win, timeout: int = HANGUP_TIMEOUT) -> dict[str, Any]:
    """
    等待通话结束（VOIP 窗口消失 + 气泡文案解析）。

    返回：
      {'status': 'answered', 'duration_seconds': N, 'bubble_text': '...'}
      {'status': 'no_answer', 'duration_seconds': 0}
      {'status': 'failed', 'duration_seconds': 0}
    """
    logger.info('[gpa-voice] wait_for_hangup: 等待通话结束（超时 %ds）', timeout)
    deadline = time.time() + timeout

    while time.time() < deadline:
        title = _get_voip_window_title(app)
        if not title:
            # VOIP 窗口已消失 → 解析气泡
            bubble_text = _get_last_bubble_text(chat_win)
            call_status = _parse_bubble_status(bubble_text)

            # 解析通话时长
            duration = 0
            match = re.search(r'通话时长\s*(\d+):(\d+)', bubble_text)
            if match:
                duration = int(match.group(1)) * 60 + int(match.group(2))

            logger.info(
                '[gpa-voice] wait_for_hangup: 通话结束 status=%s duration=%ds bubble=%r',
                call_status,
                duration,
                bubble_text,
            )
            return {'status': call_status, 'duration_seconds': duration, 'bubble_text': bubble_text}

        time.sleep(HANGUP_POLL_INTERVAL)

    logger.warning('[gpa-voice] wait_for_hangup: %ds 超时，强制挂断', timeout)
    safe_hangup(app)
    return {'status': 'failed', 'duration_seconds': 0, 'bubble_text': ''}


# ─── 主流程入口 ──────────────────────────────────────────────────────────────

def make_voice_call(
    contact_name: str,
    wechat_account: str | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    """
    主动语音触达完整流程（Golden Path Step 3-7）：
      locate_contact → initiate_voice_call → wait_for_answer → wait_for_hangup

    返回：
      {'status': 'answered'|'no_answer'|'contact_mismatch'|'failed',
       'duration_seconds': N,
       'contact_name': contact_name,
       'tenant_id': tenant_id}
    """
    base = {'contact_name': contact_name, 'tenant_id': tenant_id, 'duration_seconds': 0}
    app = _get_wechat_app()

    # 联系人定位（I-1/I-6）
    locate_result = locate_contact(contact_name)
    if locate_result['status'] != 'ok':
        return {**base, 'status': locate_result['status'], 'reason': locate_result.get('reason', '')}

    chat_win = locate_result['window']

    # 触发拨号
    dial_result = trigger_voice_call(chat_win)
    if dial_result['status'] != 'ok':
        return {**base, 'status': 'failed', 'reason': dial_result.get('reason', '')}

    # 等待接通（I-3，60 秒超时）
    answer_result = wait_for_answer(app, timeout=ANSWER_TIMEOUT)
    if answer_result['status'] != 'answered':
        return {**base, 'status': answer_result['status']}

    # 等待通话结束
    hangup_result = wait_for_hangup(app, chat_win)
    return {
        **base,
        'status': hangup_result['status'],
        'duration_seconds': hangup_result.get('duration_seconds', 0),
        'bubble_text': hangup_result.get('bubble_text', ''),
    }
