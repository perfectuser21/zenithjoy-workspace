"""NAS 上传封装（tar over ssh）

使用 tar + ssh host alias 将本地目录上传到 NAS。

为什么不用 rsync：
- NAS 账号是中文用户名（徐啸）。rsync spawn ssh 时 UTF-8 bytes 会被 mangle
  （日志出现 `Authenticating as '\\220\\225'`），导致 Permission denied。
- 直接 `ssh <alias>` 走 SSH config 的 `User 徐啸` 能正常工作，因此改成
  `tar -cf - | ssh <alias> 'cd <dst> && tar -xf -'`，把用户名交给 OpenSSH 自己解析。

部署依赖：
- `~/.ssh/config` 必须有 `Host nas` 条目（`User 徐啸` + `HostName` + 密钥）。
- `NAS_SSH_ALIAS` 环境变量可以覆盖默认 alias（默认 `nas`）。

失败允许 2 次重试。
"""

from __future__ import annotations

import logging
import os
import subprocess
import time

logger = logging.getLogger("pipeline-worker.nas")

# 老参数保留供日志/排查，但 upload 不再直接拼 user@host。
NAS_USER = os.environ.get("NAS_USER", "徐啸")
NAS_HOST = os.environ.get("NAS_HOST", "100.110.241.76")
NAS_BASE = os.environ.get("NAS_BASE", "/volume1/workspace/vault/zenithjoy-creator/content")
NAS_SSH_ALIAS = os.environ.get("NAS_SSH_ALIAS", "nas")

MAX_RETRIES = 2
RETRY_DELAY = 5  # 秒
MKDIR_TIMEOUT = 30  # 秒
TAR_TIMEOUT = 120  # 秒


def _run_mkdir(ssh_alias: str, remote_dir: str) -> tuple[bool, str]:
    """远程 mkdir -p。成功返回 (True, "")，失败返回 (False, stderr)。"""
    cmd = ["ssh", ssh_alias, f"mkdir -p '{remote_dir}'"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=MKDIR_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return False, f"ssh mkdir 超时（{MKDIR_TIMEOUT}s）"
    except Exception as e:  # pragma: no cover - 防御
        return False, f"ssh mkdir 异常: {e}"

    if result.returncode != 0:
        err = (result.stderr or "").strip() or f"ssh mkdir exit {result.returncode}"
        return False, err
    return True, ""


def _run_tar_over_ssh(local_dir: str, ssh_alias: str, remote_dir: str) -> tuple[bool, str]:
    """tar -cf - | ssh <alias> 'cd <dst> && tar -xf -'。成功返回 (True, "")。"""
    tar_cmd = ["tar", "-cf", "-", "-C", local_dir, "."]
    ssh_cmd = ["ssh", ssh_alias, f"cd '{remote_dir}' && tar -xf -"]

    tar_proc: subprocess.Popen | None = None
    try:
        tar_proc = subprocess.Popen(tar_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            ssh_result = subprocess.run(
                ssh_cmd,
                stdin=tar_proc.stdout,
                capture_output=True,
                text=True,
                timeout=TAR_TIMEOUT,
            )
        finally:
            # 关闭 tar 的 stdout 让它能正常结束（SIGPIPE 防护）。
            if tar_proc.stdout is not None:
                try:
                    tar_proc.stdout.close()
                except Exception:  # pragma: no cover
                    pass

        # 等 tar 收尾，拿它的 stderr。
        try:
            _, tar_stderr_bytes = tar_proc.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            tar_proc.kill()
            tar_proc.communicate()
            return False, "tar 收尾超时"

        if tar_proc.returncode not in (0, None):
            tar_err = (tar_stderr_bytes or b"").decode("utf-8", "replace").strip()
            return False, tar_err or f"tar exit {tar_proc.returncode}"

        if ssh_result.returncode != 0:
            ssh_err = (ssh_result.stderr or "").strip() or f"ssh tar exit {ssh_result.returncode}"
            return False, ssh_err

        return True, ""

    except subprocess.TimeoutExpired:
        if tar_proc is not None:
            try:
                tar_proc.kill()
                tar_proc.communicate()
            except Exception:  # pragma: no cover
                pass
        return False, f"tar over ssh 超时（{TAR_TIMEOUT}s）"
    except Exception as e:
        if tar_proc is not None:
            try:
                tar_proc.kill()
                tar_proc.communicate()
            except Exception:  # pragma: no cover
                pass
        return False, f"tar over ssh 异常: {e}"


def upload_to_nas(local_dir: str, pipeline_id: str, ssh_alias: str | None = None) -> dict:
    """将 local_dir 同步到 NAS/{pipeline_id}/（tar over ssh）。

    Args:
        local_dir: 本地目录。
        pipeline_id: 远端子目录名。
        ssh_alias: SSH host alias，默认读 env ``NAS_SSH_ALIAS``（``nas``）。

    Returns:
        {success: bool, nas_path: str|None, error: str|None}
    """
    alias = ssh_alias or NAS_SSH_ALIAS
    nas_path = f"{NAS_BASE}/{pipeline_id}"

    last_error: str | None = None
    for attempt in range(1, MAX_RETRIES + 2):
        logger.info(
            "NAS 上传 attempt %d/%d: %s -> ssh://%s:%s",
            attempt, MAX_RETRIES + 1, local_dir, alias, nas_path,
        )

        ok, err = _run_mkdir(alias, nas_path)
        if not ok:
            last_error = f"mkdir 失败: {err}"
            logger.warning("NAS mkdir 失败 attempt %d: %s", attempt, err)
        else:
            ok, err = _run_tar_over_ssh(local_dir, alias, nas_path)
            if ok:
                logger.info("NAS 上传成功: %s", nas_path)
                return {"success": True, "nas_path": nas_path, "error": None}
            last_error = err
            logger.warning("NAS tar 上传失败 attempt %d: %s", attempt, err)

        if attempt <= MAX_RETRIES:
            time.sleep(RETRY_DELAY)

    logger.error("NAS 上传最终失败: %s", last_error)
    return {"success": False, "nas_path": None, "error": last_error}
