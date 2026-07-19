# services/agent/build-modules/line04/wechat-rpa/voice_call/dispatcher.py
# GP-A 主动语音触达 — 派发调度器（machine 级乐观锁认领 + 熔断保护）
#
# 设计要点（BEHAVIOR-2 + BEHAVIOR-4）：
#   BEHAVIOR-2  乐观锁 fetch_pending → claim_task → 判断 RETURNING 行数 → spawn_fn
#   BEHAVIOR-4  CircuitBreaker：60min 窗口内 5 次 <30s 快失败 → circuit_open + 飞书告警
#   I-10        锁文件防 Agent 重启并发：/tmp/gpa-{call_id}.lock
#   I-11        machine 级熔断：agent 重启复位熔断状态（实例级）
#   I-13        DB 故障降级：fetch_pending 异常 → 空列表，不崩溃
#
# 运行环境：xian-rog（Windows/Linux 均可），CI 走 mock 单元测试
#
# sprint: 07191407-gpa-dispatch-trigger  task: 2ac0e77b

from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, List

logger = logging.getLogger('[gpa-voice]dispatcher')


# ─── 熔断器（I-11，BEHAVIOR-4）────────────────────────────────────────────────

class CircuitBreaker:
    """
    machine 级熔断器（仿 OverlayWatchdog 模式）。
    60 分钟窗口内连续 5 次 <30s 快失败 → circuit_open=True。
    agent 重启 → 实例级复位（新实例 fast_failures=[]，circuit_open=False）。
    """

    def __init__(
        self,
        machine_id: str,
        feishu_alert_fn: Callable | None = None,
        fast_fail_threshold: int = 5,
        fast_fail_window_seconds: int = 3600,   # 60 分钟
        fast_fail_duration_max: int = 30,        # <30s 算快失败
    ) -> None:
        self.machine_id = machine_id
        self.feishu_alert_fn = feishu_alert_fn
        self.fast_fail_threshold = fast_fail_threshold
        self.fast_fail_window_seconds = fast_fail_window_seconds
        self.fast_fail_duration_max = fast_fail_duration_max

        self._fast_failures: list[float] = []   # 快失败时间戳列表
        self._is_open: bool = False

    def record_fast_failure(self, duration_seconds: float) -> None:
        """记录一次快失败（duration < fast_fail_duration_max）。触发熔断时发飞书告警。"""
        if duration_seconds >= self.fast_fail_duration_max:
            return  # 不是快失败，跳过

        now = time.time()
        self._fast_failures.append(now)

        # 清理窗口外的记录
        window_start = now - self.fast_fail_window_seconds
        self._fast_failures = [t for t in self._fast_failures if t >= window_start]

        if len(self._fast_failures) >= self.fast_fail_threshold and not self._is_open:
            self._is_open = True
            logger.error(
                '[gpa-voice] circuit_open=True: machine=%s, %d 次快失败（<30s），停止轮询',
                self.machine_id,
                len(self._fast_failures),
            )
            self._send_feishu_alert()

    def is_open(self) -> bool:
        """熔断是否已开启。"""
        return self._is_open

    def force_open(self) -> None:
        """强制开启熔断（测试用）。"""
        self._is_open = True

    def reset(self) -> None:
        """复位熔断（agent 重启时调用）。"""
        self._is_open = False
        self._fast_failures = []
        logger.info('[gpa-voice] CircuitBreaker 已复位: machine=%s', self.machine_id)

    def _send_feishu_alert(self) -> None:
        """发送飞书告警。优先使用注入的 feishu_alert_fn，否则尝试 requests.post。"""
        alert_msg = {
            'msg_type': 'text',
            'content': {
                'text': (
                    f'[GP-A 熔断告警] machine_id={self.machine_id}\n'
                    f'60min 内出现 {len(self._fast_failures)} 次 <30s 快失败，已触发熔断（circuit_open=True）。\n'
                    '请检查 xian-rog 上的 dispatcher 日志和 worker 子进程状态。\n'
                    '重启 dispatcher 进程可复位熔断状态。'
                )
            },
        }

        if self.feishu_alert_fn is not None:
            try:
                self.feishu_alert_fn(alert_msg)
            except Exception as e:
                logger.warning('[gpa-voice] 飞书告警回调失败: %s', e)
            return

        webhook_url = os.environ.get('FEISHU_ALERT_WEBHOOK', '')
        if not webhook_url:
            logger.warning('[gpa-voice] FEISHU_ALERT_WEBHOOK 未设置，跳过飞书告警')
            return

        try:
            import requests  # type: ignore[import]
            requests.post(webhook_url, json=alert_msg, timeout=5)
            logger.info('[gpa-voice] 飞书告警已发送 webhook=%s', webhook_url)
        except Exception as e:
            logger.warning('[gpa-voice] 飞书告警 requests.post 失败: %s', e)


# ─── 锁文件辅助函数（I-10）────────────────────────────────────────────────────

def _lock_path(call_id: str) -> str:
    return f'/tmp/gpa-{call_id}.lock'


def _is_lock_active(call_id: str) -> bool:
    """
    检查锁文件是否存在且 PID 活跃。
    - 不存在 → False
    - 存在但 PID 已退出（ProcessLookupError）→ 清理 stale 锁 → False
    - 存在且 PID 活跃 → True
    """
    lock_file = _lock_path(call_id)
    if not os.path.exists(lock_file):
        return False

    try:
        with open(lock_file, 'r') as f:
            pid_str = f.read().strip()
        pid = int(pid_str)
        os.kill(pid, 0)  # 发送信号 0 检查进程是否存在
        # PID 存在 → 锁活跃
        logger.debug('[gpa-voice] 锁文件活跃: call_id=%s pid=%d', call_id, pid)
        return True
    except ProcessLookupError:
        # PID 已退出 → stale 锁文件，清理
        logger.info('[gpa-voice] 清理 stale 锁文件: call_id=%s', call_id)
        try:
            os.remove(lock_file)
        except OSError:
            pass
        return False
    except (ValueError, OSError) as e:
        logger.warning('[gpa-voice] 锁文件读取异常: %s，视为非活跃', e)
        return False


def _write_lock(call_id: str, pid: int) -> None:
    """写入锁文件（I-10）。"""
    lock_file = _lock_path(call_id)
    with open(lock_file, 'w') as f:
        f.write(str(pid))
    logger.debug('[gpa-voice] 写入锁文件: call_id=%s pid=%d', call_id, pid)


# ─── 主调度器（BEHAVIOR-2 + BEHAVIOR-4）──────────────────────────────────────

class VoiceOutreachDispatcher:
    """
    GP-A 语音触达派发调度器。

    设计：
      - db.fetch_pending() → 获取 queued 任务列表
      - db.claim_task(call_id, machine_id) → 乐观锁认领（RETURNING 行数）
      - 锁文件防重（I-10）：/tmp/gpa-{call_id}.lock
      - 熔断器（I-11）：circuit_open 时 poll_once 立即返回
      - spawn_fn(cmd) → 产生子进程执行 worker.py
    """

    def __init__(
        self,
        db: Any,
        machine_id: str,
        spawn_fn: Callable,
        feishu_alert_fn: Callable | None = None,
    ) -> None:
        self.db = db
        self.machine_id = machine_id
        self.spawn_fn = spawn_fn
        self.circuit_breaker = CircuitBreaker(
            machine_id=machine_id,
            feishu_alert_fn=feishu_alert_fn,
        )

    def poll_once(self) -> None:
        """
        执行一次轮询：
          1. 熔断检查（circuit_open → 立即返回）
          2. fetch_pending（DB 故障 → 空列表降级）
          3. 对每条任务：乐观锁认领 + 锁文件检查 + spawn 子进程
        """
        # I-11: 熔断检查
        if self.circuit_breaker.is_open():
            logger.warning('[gpa-voice] circuit_open=True, stopping poll: machine=%s', self.machine_id)
            return

        # I-13: DB 故障降级
        try:
            pending_tasks: List[dict] = self.db.fetch_pending()
        except Exception as e:
            logger.warning('[gpa-voice] fetch_pending DB 故障，跳过本轮: %s', e)
            return

        if not pending_tasks:
            return

        for task in pending_tasks:
            call_id = task.get('call_id', task.get('id', ''))
            self._process_task(task, call_id)

    def _process_task(self, task: dict, call_id: str) -> None:
        """处理单条 pending 任务：乐观锁认领 + 锁文件检查 + spawn。"""
        # I-10: 锁文件检查（防 Agent 重启后并发）
        if _is_lock_active(call_id):
            logger.info('[gpa-voice] 锁文件活跃，跳过认领: call_id=%s', call_id)
            return

        # 乐观锁认领（UPDATE WHERE call_phase='queued' RETURNING）
        rows_updated = self.db.claim_task(call_id, self.machine_id)

        if rows_updated == 0:
            # 另一个 Agent 抢先认领了 → 静默跳过（不写 INFO 日志）
            return

        # 认领成功 → 写锁文件
        try:
            _write_lock(call_id, os.getpid())
        except OSError as e:
            logger.warning('[gpa-voice] 写锁文件失败: %s（继续执行）', e)

        # spawn 子进程执行 worker.py
        cmd = [
            'python', '-m', 'voice_call.worker',
            '--call-id', call_id,
            '--tenant-id', task.get('tenant_id', ''),
            '--contact-name', task.get('contact_name', ''),
            '--wechat-account', task.get('wechat_account', '') or '',
            '--machine-id', self.machine_id,
        ]
        logger.info('[gpa-voice] spawn worker: call_id=%s machine=%s', call_id, self.machine_id)
        self.spawn_fn(cmd)
