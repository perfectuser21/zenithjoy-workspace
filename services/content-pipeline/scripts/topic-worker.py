#!/usr/bin/env python3
"""选题池 worker — 每日按节奏从 topics 表挑 N 条建 pipeline。

PR-c 起：本脚本不再直连 SQLite，全部改走 apps/api HTTP 端点。
- 数据源：apps/api (默认 http://localhost:5200)
- 鉴权：Authorization: Bearer ${ZENITHJOY_INTERNAL_TOKEN}

挑选规则：
- status='已通过'（由 apps/api 侧按 priority ASC, created_at ASC 排序）
- scheduled_date IS NULL 或 scheduled_date <= today（服务器不支持日期比较参数，本地过滤）
- LIMIT N（N = pacing_config.daily_limit，env TOPIC_DAILY_LIMIT 优先，默认 1）

行为：
- 默认 dry-run（只打印挑选结果），加 --apply 才真正派发
- 挂号成功只记录工作单；实际执行状态由领取工作单的 Worker 推进
- 挂号未知持久化恢复信息，下轮复用同一 run；明确拒绝不自动重试

环境变量：
    APPS_API_BASE               apps/api 地址（默认 http://localhost:5200；兼容 CREATOR_PIPELINE_API）
    ZENITHJOY_INTERNAL_TOKEN    内部 API 鉴权 token（401/403 → 退出）
    TOPIC_DAILY_LIMIT           覆盖每日限额（优先于 apps/api 的 pacing_config）
    DEFAULT_CONTENT_TYPE        触发 pipeline 用的 content_type（默认 'post'）

Brain Task: fff07775-ce14-45cd-b4ee-2be074353267
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import logging
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any, Optional

# 允许 `python3 topic-worker.py` 直接跑（把 services/creator 加入 path）
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lib.http_client import ZenithJoyAPIError, ZenithJoyClient  # noqa: E402
from pipeline_worker.terminal_checkpoint import save_checkpoint  # noqa: E402

logger = logging.getLogger("topic-worker")


def _resolve_daily_limit(client: ZenithJoyClient) -> int:
    """优先 env TOPIC_DAILY_LIMIT；否则 apps/api /api/pacing-config.daily_limit；再默认 1。"""
    env = os.environ.get("TOPIC_DAILY_LIMIT")
    if env:
        try:
            return max(0, int(env))
        except ValueError:
            logger.warning("TOPIC_DAILY_LIMIT=%s 不是整数，忽略", env)

    try:
        data = client.get_pacing_config()
    except ZenithJoyAPIError as e:
        if e.status_code in (401, 403):
            raise  # 鉴权错误由上层退出
        logger.warning("GET /api/pacing-config 失败，退回默认 1: %s", e)
        return 1

    value = data.get("daily_limit", 1)
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        logger.warning("pacing-config 返回非整数 daily_limit=%r，退回 1", value)
        return 1


def _filter_by_schedule(
    topics: list[dict[str, Any]],
    today: Optional[str],
) -> list[dict[str, Any]]:
    """本地过滤 scheduled_date <= today 或 NULL。apps/api 不支持日期比较参数。"""
    today = today or date.today().isoformat()
    out: list[dict[str, Any]] = []
    for t in topics:
        sched = t.get("scheduled_date")
        if not sched or str(sched) <= today:
            out.append(t)
    return out


def _register_topic(client, topic, content_type):
    """本机串行化请求意图；服务端 topic 行锁负责跨进程/机器的 run 幂等。"""
    key = hashlib.sha256(f'{client.base_url}:{topic["id"]}'.encode()).hexdigest()
    state_root = Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state')))
    path = state_root / 'zenithjoy/topic-worker' / (key + '.json')
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.with_suffix('.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        record = json.loads(path.read_text()) if path.exists() else {
            'topic_id': topic['id'], 'phase': 'intent', 'request': {
                'content_type': content_type, 'topic': topic.get('title'),
                'topic_id': topic['id'], 'triggered_by': 'topic-worker',
            },
        }
        if record['topic_id'] != topic['id']:
            raise ValueError('topic checkpoint identity mismatch')
        if record['phase'] == 'registered':
            return {'dispatched': True, 'pipeline_id': record['pipeline_id'],
                    'status': record['status'], 'cecelia_task_id': record['cecelia_task_id']}
        if record['phase'] == 'rejected':
            return {'dispatched': False, 'pipeline_id': record.get('pipeline_id'),
                    'error': record.get('error', '挂号已拒绝，不自动重试')}
        save_checkpoint(path, record)  # 在可能提交的 HTTP 请求前保存意图
        try:
            if record.get('pipeline_id'):
                response = client.register_pipeline(record['pipeline_id'])
            else:
                # 服务端同 topic_id 行锁读回原意图，超时重发不会新造 run。
                response = client.trigger_pipeline(record['request'])
            data = response.get('data', response)
            if isinstance(data, dict) and data.get('id'):
                record['pipeline_id'] = data['id']
            if (not isinstance(data, dict) or not data.get('cecelia_task_id')
                    or data.get('status') not in ('pending', 'running', 'completed', 'failed')):
                record.update(phase='unknown', error='挂号响应缺少工作单身份或状态')
                save_checkpoint(path, record)
                return {'dispatched': False, 'pipeline_id': record.get('pipeline_id'), 'error': record['error']}
            record.update(phase='registered', status=data['status'], cecelia_task_id=data['cecelia_task_id'])
            save_checkpoint(path, record)
            return {'dispatched': True, 'pipeline_id': record['pipeline_id'],
                    'status': record['status'], 'cecelia_task_id': record['cecelia_task_id']}
        except ZenithJoyAPIError as error:
            payload = error.response_json or {}
            details = (payload.get('error') or {}).get('details') or {}
            if details.get('pipeline_run_id'):
                record['pipeline_id'] = details['pipeline_run_id']
            rejected = details.get('registration_status') == 'rejected' or (
                error.status_code is not None and 400 <= error.status_code < 500
                and error.status_code not in (408, 429) and details.get('registration_status') != 'unknown')
            record.update(phase='rejected' if rejected else 'unknown',
                          error=str(error))
            save_checkpoint(path, record)
            if error.status_code in (401, 403):
                raise
            return {'dispatched': False, 'pipeline_id': record.get('pipeline_id'), 'error': str(error)}


def run(
    *,
    apply: bool = False,
    api_base: Optional[str] = None,
    today: Optional[str] = None,
    client: Optional[ZenithJoyClient] = None,
) -> dict[str, Any]:
    """主入口；返回包含 dispatch 结果的字典（便于测试）。

    参数：
        apply     True 才真正派发；否则 dry-run
        api_base  apps/api 地址；默认走 env
        today     覆盖"今日"，主要供测试
        client    注入 ZenithJoyClient（测试）；否则由 env 构造
    """
    owns_client = client is None
    if client is None:
        if api_base:
            token = os.environ.get("ZENITHJOY_INTERNAL_TOKEN")
            client = ZenithJoyClient(base_url=api_base, token=token)
        else:
            client = ZenithJoyClient.from_env()

    try:
        limit = _resolve_daily_limit(client)

        # 选 topics（apps/api 已按 priority/created_at 排序）
        if limit <= 0:
            items: list[dict[str, Any]] = []
        else:
            # 多取一些以防 scheduled_date 过滤后不够；上限 max(limit*4, limit+10)
            fetch_n = max(limit * 4, limit + 10)
            try:
                raw = client.list_topics(status="已通过", limit=fetch_n)
            except ZenithJoyAPIError as e:
                if e.status_code in (401, 403):
                    raise
                logger.error("GET /api/topics 失败：%s", e)
                return {"limit": limit, "selected": 0, "apply": apply, "results": [], "error": str(e)}
            items = _filter_by_schedule(raw, today)[:limit]

        content_type = os.environ.get("DEFAULT_CONTENT_TYPE", "post")
        results: list[dict[str, Any]] = []

        for t in items:
            entry: dict[str, Any] = {"topic_id": t.get("id"), "title": t.get("title")}

            if not apply:
                entry["dispatched"] = False
                entry["dry_run"] = True
                results.append(entry)
                continue

            entry.update(_register_topic(client, t, content_type))

            results.append(entry)

        return {
            "limit": limit,
            "selected": len(items),
            "apply": apply,
            "results": results,
        }
    finally:
        if owns_client:
            client.close()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="真正派发 pipeline（默认 dry-run，只打印挑选结果）",
    )
    parser.add_argument(
        "--api-base",
        default=None,
        help="apps/api 地址；默认从 env APPS_API_BASE / CREATOR_PIPELINE_API 读，否则 http://localhost:5200",
    )
    parser.add_argument("--today", default=None, help="覆盖今日日期（YYYY-MM-DD），主要供测试")
    parser.add_argument(
        "--log-level",
        default=os.environ.get("LOG_LEVEL", "INFO"),
        help="日志级别（DEBUG/INFO/WARNING/ERROR）",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    try:
        summary = run(apply=args.apply, api_base=args.api_base, today=args.today)
    except ZenithJoyAPIError as e:
        if e.status_code in (401, 403):
            logger.error("apps/api 鉴权失败（%s），请检查 ZENITHJOY_INTERNAL_TOKEN", e.status_code)
            return 3
        logger.error("apps/api 调用异常：%s", e)
        return 4

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
