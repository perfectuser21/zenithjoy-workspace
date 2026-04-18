"""图片视觉审查（Claude Vision，走 Claude Max 订阅）

用 Claude 的多模态能力扫描 generate 阶段产出的 PNG，判断是否：
- 文字溢出边界/贴边/裁切/截断
- 布局重叠
- 中文字体异常（豆腐方块）
- 整体视觉明显丑陋/错位

实现方式：subprocess 调 `claude -p --image <path>` CLI，走主理人的
Claude Max 订阅账号（通过 `CLAUDE_CONFIG_DIR=~/.claude-account1`），
**不再直连 Anthropic REST API**，零 API 扣费。

失败策略（保守）：vision 调用异常/依赖缺失时，判 pass + 日志 warning，
**不因为 vision 本身挂掉而阻塞 pipeline**。但 vision 如果成功返回
major 级问题，则实锤 FAIL。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger("pipeline-worker.image_vision_review")

CLAUDE_CLI_PATH = os.environ.get("CLAUDE_CLI_PATH", "/opt/homebrew/bin/claude")
PER_IMAGE_TIMEOUT_SEC = int(os.environ.get("IMAGE_VISION_TIMEOUT", "90"))
# 默认走 account2 避免与当前对话的 account1 context 污染（subprocess 会继承 CLAUDE.md/memory）
DEFAULT_VISION_ACCOUNT = os.environ.get("VISION_CLAUDE_ACCOUNT", "account2")

_VISION_PROMPT_TEMPLATE = """请用 Read 工具读取这张图 {image_path}，判断是否存在问题：

1. 文字溢出/贴边/被裁切（尤其四边文字是否完整）
2. 文字重叠、布局错位
3. 中文字体异常（豆腐方块 □□□）
4. 明显丑陋/错位/破图

严格输出一行合法 JSON（无 markdown fence，无解释）：
{{"pass":true或false,"severity":"ok"或"minor"或"major","issues":["问题1","问题2"]}}

判定：任何文字裁切/溢出/豆腐块/明显错位 → severity=major + pass=false；
轻微美学问题 → severity=minor + pass=true；全部正常 → severity=ok + pass=true + issues=[]。
"""


def _build_prompt(image_path: Path) -> str:
    return _VISION_PROMPT_TEMPLATE.format(image_path=str(image_path))


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    return t.strip()


def _call_vision(
    image_path: Path,
    prompt: str | None = None,
    timeout: int = PER_IMAGE_TIMEOUT_SEC,
) -> dict[str, Any] | None:
    """调 `claude -p` 走 Claude Max 订阅（零 API 扣费）。

    image_path 通过 prompt 传给 Claude，由它自己的 Read 工具读。
    通过 CLAUDE_CONFIG_DIR 切到订阅账号，subprocess 非交互调用。

    Returns: {pass: bool, severity: str, issues: [str]} 或 None（调用失败）
    """
    account = os.environ.get("VISION_CLAUDE_ACCOUNT", DEFAULT_VISION_ACCOUNT)
    env = os.environ.copy()
    env["CLAUDE_CONFIG_DIR"] = str(Path.home() / f".claude-{account}")
    # 非交互 + 不让 claude CLI 以为自己嵌在 Claude Code 里（避免 context 污染父会话）
    env.pop("CLAUDECODE", None)

    effective_prompt = prompt if prompt is not None else _build_prompt(image_path)

    cmd = [
        CLAUDE_CLI_PATH,
        "-p",
        effective_prompt,
        "--output-format",
        "text",
        "--dangerously-skip-permissions",
    ]

    try:
        result = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd="/tmp",
            check=False,
        )
    except subprocess.TimeoutExpired:
        logger.warning("[vision] claude CLI 超时 %ds for %s", timeout, image_path.name)
        return None
    except FileNotFoundError:
        logger.warning("[vision] claude CLI 不存在: %s", CLAUDE_CLI_PATH)
        return None
    except OSError as e:
        logger.warning("[vision] subprocess 启动失败 %s: %s", image_path.name, e)
        return None

    if result.returncode != 0:
        logger.warning(
            "[vision] claude CLI 失败 code=%d for %s, stderr=%s",
            result.returncode, image_path.name, (result.stderr or "")[:200],
        )
        return None

    text = (result.stdout or "").strip()
    if not text:
        logger.warning("[vision] claude CLI 空输出 for %s", image_path.name)
        return None

    stripped = _strip_json_fence(text)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as e:
        logger.warning(
            "[vision] JSON 解析失败 %s: %s; 前 200 字: %s",
            image_path.name, e, stripped[:200],
        )
        return None
    if not isinstance(parsed, dict):
        return None
    # 归一化字段
    return {
        "pass": bool(parsed.get("pass", True)),
        "severity": str(parsed.get("severity") or "ok").lower(),
        "issues": [str(x) for x in (parsed.get("issues") or [])],
    }


def review_images(image_paths: list[Path]) -> dict[str, Any]:
    """对一批 PNG 做 vision 审查，聚合结果。

    Args:
        image_paths: PNG 路径列表

    Returns:
        {
            review_passed: bool,          # 有任意 major → False
            checked: int,                 # 真正被 vision 看过的图数
            skipped: int,                 # 因 vision 异常跳过的图数
            issues: [str],                # 扁平化 issue 列表（带图名前缀）
            per_image: [dict],            # 每张图的详细结果
            severity: "ok"|"minor"|"major",  # 聚合等级
        }
    """
    result: dict[str, Any] = {
        "review_passed": True,
        "checked": 0,
        "skipped": 0,
        "issues": [],
        "per_image": [],
        "severity": "ok",
    }

    if not image_paths:
        logger.info("[vision] 无图可审，跳过")
        return result

    max_severity = "ok"
    for p in image_paths:
        if not p.exists():
            logger.warning("[vision] 图不存在: %s", p)
            result["skipped"] += 1
            continue

        item: dict[str, Any] = {"image": p.name}
        resp = _call_vision(p)
        if resp is None:
            result["skipped"] += 1
            item["status"] = "skipped"
            item["reason"] = "vision 调用失败，保守判 pass"
            result["per_image"].append(item)
            continue

        result["checked"] += 1
        item.update(resp)
        item["status"] = "reviewed"
        result["per_image"].append(item)

        severity = resp.get("severity", "ok")
        for issue in resp.get("issues", []):
            result["issues"].append(f"{p.name}: {issue}")

        # severity 聚合：major > minor > ok
        if severity == "major":
            max_severity = "major"
            result["review_passed"] = False
        elif severity == "minor" and max_severity != "major":
            max_severity = "minor"

    result["severity"] = max_severity
    logger.info(
        "[vision] 完成: checked=%d skipped=%d severity=%s pass=%s",
        result["checked"], result["skipped"], max_severity, result["review_passed"],
    )
    return result
