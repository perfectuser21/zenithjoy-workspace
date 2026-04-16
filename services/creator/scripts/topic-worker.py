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
- 派发成功 → PATCH /api/topics/{id} 将 status 置 '研究中' + 写入 pipeline_id
- 派发失败 → topic 保持 '已通过'，下轮再试

环境变量：
    APPS_API_BASE               apps/api 地址（默认 http://localhost:5200；兼容 CREATOR_PIPELINE_API）
    ZENITHJOY_INTERNAL_TOKEN    内部 API 鉴权 token（401/403 → 退出）
    TOPIC_DAILY_LIMIT           覆盖每日限额（优先于 apps/api 的 pacing_config）
    DEFAULT_CONTENT_TYPE        触发 pipeline 用的 content_type（默认 'post'）

Brain Task: fff07775-ce14-45cd-b4ee-2be074353267
"""

from __future__ import annotations

import argparse
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

            try:
                resp = client.trigger_pipeline({
                    "content_type": content_type,
                    "topic": t.get("title"),
                    "topic_id": t.get("id"),
                    "triggered_by": "topic-worker",
                })
                data = resp.get("data") if isinstance(resp, dict) else None
                pipeline_id = None
                if isinstance(resp, dict):
                    pipeline_id = (
                        resp.get("id")
                        or resp.get("pipeline_id")
                        or (data or {}).get("id")
                        or (data or {}).get("pipeline_id")
                    )

                patch_body: dict[str, Any] = {"status": "研究中"}
                if pipeline_id:
                    patch_body["pipeline_id"] = pipeline_id
                try:
                    client.patch_topic(t["id"], patch_body)
                except ZenithJoyAPIError as patch_err:
                    logger.warning(
                        "PATCH /api/topics/%s 失败（pipeline 已触发 id=%s）：%s",
                        t.get("id"), pipeline_id, patch_err,
                    )
                    entry["patch_error"] = str(patch_err)

                entry["dispatched"] = True
                entry["pipeline_id"] = pipeline_id
            except ZenithJoyAPIError as e:
                if e.status_code in (401, 403):
                    raise
                entry["dispatched"] = False
                entry["error"] = str(e)

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
