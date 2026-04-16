"""NAS rsync 上传封装

使用 rsync over SSH 将本地目录上传到 NAS。
SSH key 需提前配置（徐啸@100.110.241.76）。
失败允许 2 次重试。
"""

from __future__ import annotations

import logging
import os
import subprocess
import time

logger = logging.getLogger("pipeline-worker.nas")

NAS_USER = os.environ.get("NAS_USER", "徐啸")
NAS_HOST = os.environ.get("NAS_HOST", "100.110.241.76")
NAS_BASE = os.environ.get("NAS_BASE", "/volume1/workspace/vault/zenithjoy-creator/content")

MAX_RETRIES = 2
RETRY_DELAY = 5  # 秒


def upload_to_nas(local_dir: str, pipeline_id: str) -> dict:
    """将 local_dir 同步到 NAS/{pipeline_id}/。

    Returns:
        {success: bool, nas_path: str|None, error: str|None}
    """
    nas_path = f"{NAS_BASE}/{pipeline_id}"
    remote = f"{NAS_USER}@{NAS_HOST}:{nas_path}/"

    cmd = [
        "rsync", "-avz", "--mkpath", "--timeout=60",
        f"{local_dir}/",
        remote,
    ]

    last_error = None
    for attempt in range(1, MAX_RETRIES + 2):
        try:
            logger.info("NAS 上传 attempt %d/%d: %s → %s", attempt, MAX_RETRIES + 1, local_dir, remote)
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if result.returncode == 0:
                logger.info("NAS 上传成功: %s", nas_path)
                return {"success": True, "nas_path": nas_path, "error": None}
            last_error = result.stderr.strip() or f"rsync exit code {result.returncode}"
            logger.warning("NAS 上传失败 attempt %d: %s", attempt, last_error)
        except subprocess.TimeoutExpired:
            last_error = "rsync 超时（120s）"
            logger.warning("NAS 上传超时 attempt %d", attempt)
        except Exception as e:
            last_error = str(e)
            logger.warning("NAS 上传异常 attempt %d: %s", attempt, e)

        if attempt <= MAX_RETRIES:
            time.sleep(RETRY_DELAY)

    logger.error("NAS 上传最终失败: %s", last_error)
    return {"success": False, "nas_path": None, "error": last_error}
