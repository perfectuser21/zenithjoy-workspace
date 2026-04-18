"""图片视觉审查（Claude Vision）

用 Claude 的多模态能力扫描 generate 阶段产出的 PNG，判断是否：
- 文字溢出边界/贴边/裁切/截断
- 布局重叠
- 中文字体异常（豆腐方块）
- 整体视觉明显丑陋/错位

注意：Cecelia HTTP `/api/brain/llm-service/generate` 当前**不支持 image 输入**
（只透传 prompt），因此本模块直接调 Anthropic REST API 走多模态，
凭据从 `~/.credentials/anthropic.json` 读（与 brain llm-caller 一致）。

失败策略（保守）：vision 调用异常/依赖缺失时，判 pass + 日志 warning，
**不因为 vision 本身挂掉而阻塞 pipeline**。但 vision 如果成功返回
major 级问题，则实锤 FAIL。
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger("pipeline-worker.image_vision_review")

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
VISION_MODEL = os.environ.get("IMAGE_VISION_MODEL", "claude-sonnet-4-5")
PER_IMAGE_TIMEOUT_SEC = 45
MAX_TOKENS = 512

VISION_PROMPT = """你是严格的社交媒体卡片图片质检员。
请仔细看这张卡片图（1080×1080 或 1080×1920），回答下面 4 个问题：

1. 文字是否溢出/贴边/被裁切？（尤其看卡片四边文字是否完整）
2. 是否存在文字重叠、布局错位？
3. 中文字体是否正常渲染？（不应该出现豆腐方块 □□□）
4. 整体视觉是否专业可接受？（不能有明显丑陋/错位/破图）

请严格输出一个合法 JSON 对象（不要 markdown fence，不要解释）：
{
  "pass": true 或 false,
  "severity": "ok" 或 "minor" 或 "major",
  "issues": ["问题1", "问题2"]
}

判定规则：
- 任何文字被裁切/溢出 → severity=major, pass=false
- 豆腐方块 → severity=major, pass=false
- 明显布局错位 → severity=major, pass=false
- 轻微美学问题（如配色一般）→ severity=minor, pass=true
- 全部正常 → severity=ok, pass=true, issues=[]
"""


def _load_anthropic_api_key() -> str | None:
    """从 ~/.credentials/anthropic.json 读 api_key（与 brain llm-caller 同源）。

    env ANTHROPIC_API_KEY 优先。
    """
    env_key = os.environ.get("ANTHROPIC_API_KEY")
    if env_key:
        return env_key
    try:
        cred_path = Path.home() / ".credentials" / "anthropic.json"
        if cred_path.exists():
            data = json.loads(cred_path.read_text("utf-8"))
            return data.get("api_key")
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("[vision] 读 anthropic.json 失败: %s", e)
    return None


def _encode_image(path: Path) -> tuple[str, str] | None:
    """读 PNG 为 base64。返回 (media_type, base64_data) 或 None。"""
    try:
        raw = path.read_bytes()
        b64 = base64.standard_b64encode(raw).decode("ascii")
        return ("image/png", b64)
    except OSError as e:
        logger.warning("[vision] 读图失败 %s: %s", path, e)
        return None


def _strip_json_fence(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    return t.strip()


def _call_vision(image_path: Path, api_key: str) -> dict[str, Any] | None:
    """调 Anthropic REST API，多模态判断单张图。

    Returns: {pass: bool, severity: str, issues: [str]} 或 None（调用失败）
    """
    encoded = _encode_image(image_path)
    if not encoded:
        return None
    media_type, b64 = encoded

    body = json.dumps({
        "model": VISION_MODEL,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64,
                        },
                    },
                    {"type": "text", "text": VISION_PROMPT},
                ],
            }
        ],
    }).encode("utf-8")

    req = urllib.request.Request(
        ANTHROPIC_API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=PER_IMAGE_TIMEOUT_SEC) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_snip = ""
        try:
            body_snip = e.read().decode("utf-8")[:300]
        except Exception:
            pass
        logger.warning("[vision] HTTP %d for %s: %s", e.code, image_path.name, body_snip)
        return None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        logger.warning("[vision] 网络错误 %s: %s", image_path.name, e)
        return None
    except Exception as e:  # pragma: no cover
        logger.warning("[vision] 调用异常 %s: %s", image_path.name, e)
        return None

    # 解 Anthropic messages API 响应：content[0].text
    content = data.get("content") or []
    text = ""
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            text = block.get("text", "")
            break
    if not text:
        logger.warning("[vision] 响应无 text block: %s", str(data)[:300])
        return None

    stripped = _strip_json_fence(text)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as e:
        logger.warning("[vision] JSON 解析失败 %s: %s; 前 200 字: %s",
                       image_path.name, e, stripped[:200])
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

    api_key = _load_anthropic_api_key()
    if not api_key:
        logger.warning("[vision] 找不到 ANTHROPIC_API_KEY，跳过视觉检查（保守判 pass）")
        result["skipped"] = len(image_paths)
        result["issues"].append("vision: ANTHROPIC_API_KEY 缺失，vision 检查被跳过")
        return result

    max_severity = "ok"
    for p in image_paths:
        if not p.exists():
            logger.warning("[vision] 图不存在: %s", p)
            result["skipped"] += 1
            continue

        item: dict[str, Any] = {"image": p.name}
        resp = _call_vision(p, api_key)
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
