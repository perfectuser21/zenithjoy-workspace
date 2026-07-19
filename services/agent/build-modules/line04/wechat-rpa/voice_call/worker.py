# services/agent/build-modules/line04/wechat-rpa/voice_call/worker.py
# GP-A 主动语音触达 — worker 子进程执行器（BEHAVIOR-3）
#
# 设计要点（BEHAVIOR-3）：
#   I-9   call_phase 原子推进：UPDATE WHERE call_phase='claimed' RETURNING → 0行则退出
#   I-10  锁文件 finally 块清理：正常/异常退出均删除 /tmp/gpa-{call_id}.lock
#   N-5   指数退避重试：POST /records 失败重试 3 次（间隔 1s/2s/4s）
#   N-5   本地落盘兜底：3次退避耗尽 → 写 /tmp/gpa-failed-records.jsonl
#
# 运行方式（子进程）：
#   python -m voice_call.worker \
#     --call-id <uuid> --tenant-id <id> --contact-name <name> \
#     --wechat-account <wx> --machine-id <machine>
#
# sprint: 07191407-gpa-dispatch-trigger  task: 2ac0e77b

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger('[gpa-voice]worker')

# 指数退避重试参数
MAX_RETRY = 3
BASE_BACKOFF = 1.0  # 秒


# ─── WorkerContext（依赖注入，便于测试 mock）──────────────────────────────────

@dataclass
class WorkerContext:
    """
    子进程执行上下文（依赖注入，CI 测试可全 mock）。

    make_voice_call_fn: 执行真实拨号 + 音频桥接（call_rpa.make_voice_call）
    local_fallback_fn:  本地落盘回调（None → 默认写 /tmp/gpa-failed-records.jsonl）
    """
    call_id: str
    tenant_id: str
    contact_name: str
    wechat_account: str
    machine_id: str
    db: Any
    make_voice_call_fn: Callable
    local_fallback_fn: Callable | None = None


# ─── 本地落盘（N-5 兜底）─────────────────────────────────────────────────────

def _default_local_fallback(record: dict) -> None:
    """
    默认落盘实现：追加写入 /tmp/gpa-failed-records.jsonl（N-5）。
    record 包含 call_id + status 等字段。
    """
    path = '/tmp/gpa-failed-records.jsonl'
    try:
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
        logger.info('[gpa-voice] 本地落盘兜底: %s', path)
    except OSError as e:
        logger.error('[gpa-voice] 本地落盘写入失败: %s', e)


# ─── worker 主逻辑 ────────────────────────────────────────────────────────────

def run_worker(ctx: WorkerContext) -> None:
    """
    子进程执行主函数。

    流程：
      1. db.advance_to_dialing(call_id, machine_id) → 0行则立即退出（I-9）
      2. make_voice_call_fn(contact_name, wechat_account) → {status, duration_seconds, transcript, bubble_text}
         - contact_mismatch / RuntimeError → write_failed + 退出
      3. db.write_record(result) → 指数退避重试 3 次
         - 3次耗尽 → local_fallback_fn(record)（N-5）
      4. finally 块：os.remove(lock_file)（I-10）
    """
    call_id = ctx.call_id
    lock_file = f'/tmp/gpa-{call_id}.lock'

    try:
        # ─── Step 1: 原子推进到 dialing（I-9 防重复拨打）──────────────────────
        rows = ctx.db.advance_to_dialing(call_id, ctx.machine_id)
        if rows == 0:
            logger.info(
                '[gpa-voice] 0 rows returned, aborting: call_id=%s machine=%s',
                call_id,
                ctx.machine_id,
            )
            return  # 另一台机器已认领/推进，立即退出

        logger.info('[gpa-voice] advance_to_dialing OK: call_id=%s', call_id)

        # ─── Step 2: 执行拨号 + 音频桥接 ──────────────────────────────────────
        result: dict
        try:
            result = ctx.make_voice_call_fn(
                contact_name=ctx.contact_name,
                wechat_account=ctx.wechat_account,
            )
            if result is None:
                result = {'status': 'failed', 'duration_seconds': 0, 'transcript': '', 'bubble_text': ''}
        except Exception as exc:
            error_reason = str(exc)
            if 'contact_mismatch' in error_reason:
                logger.warning('[gpa-voice] contact_mismatch: call_id=%s', call_id)
            else:
                logger.error('[gpa-voice] make_voice_call 异常: call_id=%s err=%s', call_id, exc)

            # 写失败状态
            try:
                ctx.db.write_failed(
                    call_id=call_id,
                    tenant_id=ctx.tenant_id,
                    error_reason=error_reason,
                    call_phase='failed',
                )
            except Exception as write_err:
                logger.error('[gpa-voice] write_failed 异常: %s', write_err)
            return

        # ─── Step 3: 回写记录（指数退避重试 N-5）──────────────────────────────
        record = {
            'call_id': call_id,
            'tenant_id': ctx.tenant_id,
            'contact_name': ctx.contact_name,
            'wechat_account': ctx.wechat_account,
            'machine_id': ctx.machine_id,
            'status': result.get('status', 'failed'),
            'duration_seconds': result.get('duration_seconds', 0),
            'transcript': result.get('transcript', ''),
            'bubble_text': result.get('bubble_text', ''),
        }

        success = False
        for attempt in range(MAX_RETRY):
            try:
                ctx.db.write_record(record)
                success = True
                logger.info('[gpa-voice] write_record OK: call_id=%s attempt=%d', call_id, attempt)
                break
            except Exception as e:
                backoff = BASE_BACKOFF * (2 ** attempt)
                logger.warning(
                    '[gpa-voice] write_record 失败（%d/%d），%gs 后重试: %s',
                    attempt + 1, MAX_RETRY, backoff, e,
                )
                time.sleep(backoff)

        if not success:
            # 3次耗尽 → 本地落盘兜底（N-5）
            logger.error('[gpa-voice] write_record 3次重试全部失败，落盘兜底: call_id=%s', call_id)
            fallback_fn = ctx.local_fallback_fn or _default_local_fallback
            try:
                fallback_fn(record)
            except Exception as fb_err:
                logger.error('[gpa-voice] 本地落盘兜底也失败: %s', fb_err)

    finally:
        # I-10: finally 块保证锁文件清理（正常/异常均执行）
        try:
            if os.path.exists(lock_file):
                os.remove(lock_file)
                logger.info('[gpa-voice] 锁文件已清理: %s', lock_file)
        except OSError as e:
            logger.warning('[gpa-voice] 锁文件清理失败（非致命）: %s', e)


# ─── CLI 入口（子进程模式）────────────────────────────────────────────────────

if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='GP-A voice call worker subprocess')
    parser.add_argument('--call-id',        required=True)
    parser.add_argument('--tenant-id',      required=True)
    parser.add_argument('--contact-name',   required=True)
    parser.add_argument('--wechat-account', default='')
    parser.add_argument('--machine-id',     required=True)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)

    # 真机运行时使用真实依赖
    from voice_call.call_rpa import make_voice_call  # type: ignore
    import importlib
    _db_module = importlib.import_module('voice_call.db_client')
    _db = _db_module.WorkerDbClient()

    ctx = WorkerContext(
        call_id=args.call_id,
        tenant_id=args.tenant_id,
        contact_name=args.contact_name,
        wechat_account=args.wechat_account,
        machine_id=args.machine_id,
        db=_db,
        make_voice_call_fn=make_voice_call,
    )

    run_worker(ctx)
