"""Cecelia Brain can-run 调度客户端

调用 POST /api/brain/can-run 询问是否可执行指定资源类型。
超时 5s，Cecelia 不可达时 fallback=approved（不阻断 pipeline）。
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger("pipeline-worker.cecelia")

CAN_RUN_TIMEOUT = 5  # 秒


def can_run(resource_type: str, size: int = 1) -> dict[str, Any]:
    """询问 Cecelia 是否可执行资源。

    Returns:
        {approved: bool, reason: str, retry_after: int|None}
    """
    brain_url = os.environ.get("BRAIN_URL", "http://localhost:5221")
    url = f"{brain_url}/api/brain/can-run"
    body = json.dumps({"resource_type": resource_type, "size": size}).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=CAN_RUN_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            logger.info("can-run(%s) → approved=%s reason=%s", resource_type, data.get("approved"), data.get("reason"))
            return {
                "approved": data.get("approved", True),
                "reason": data.get("reason", ""),
                "retry_after": data.get("retry_after"),
            }
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        logger.warning("can-run(%s) 请求失败，fallback approved: %s", resource_type, e)
        return {
            "approved": True,
            "reason": f"cecelia 不可达，fallback approved: {e}",
            "retry_after": None,
        }
