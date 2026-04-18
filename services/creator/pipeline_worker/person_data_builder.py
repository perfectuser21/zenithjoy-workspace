"""LLM person-data 构造器

用 LLM 把 research findings 转成**严格符合 V6 模板字段预算**的 person-data.json。

V6 模板 (gen-v6-person.mjs) 字段预算：
| 字段              | 预算            | 备注                     |
|-------------------|-----------------|--------------------------|
| name              | ≤ 8 字          | 头像圈内显示，短人名/概念 |
| handle            | ≤ 18 字         | @xxx 格式                |
| headline          | ≤ 20 字         | 模板 substring(0, 20/24) |
| key_stats[i].val  | ≤ 8 字          | 数字或短词               |
| key_stats[i].label| ≤ 12 字         | 卡片底部标签             |
| key_stats[i].sub  | ≤ 15 字         | 补充说明                 |
| flywheel[i]       | ≤ 6 字          | 飞轮节点短词             |
| flywheel_insight  | ≤ 28 字         | 模板 substring(0, 28)    |
| quote             | ≤ 36 字         | 模板 substring(0, 36)    |

当前生产 bug（cp-04181043 证据）：
- generate.py 把整段 keyword 塞给 name → 头像圈写 "为什"（前 2 字截断）
- key_stats.label 塞整段 finding.title → 卡片底部 "在2026年，随着智能体AI（Ag" 被裁切

解决：调 Cecelia /api/brain/llm-service/generate（tier=cortex）让 LLM
按严格预算生成合规 JSON；失败 fallback 硬截断（至少不塞整段 keyword）。
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger("pipeline-worker.person_data_builder")

# V6 模板字段预算（字符数上限）
BUDGET: dict[str, int] = {
    "name": 8,
    "handle": 18,
    "headline": 20,
    "stat_val": 8,
    "stat_label": 12,
    "stat_sub": 15,
    "flywheel_item": 6,
    "flywheel_insight": 28,
    "quote": 36,
}

LLM_TIMEOUT_SEC = 60
LLM_MAX_TOKENS = 2048


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _truncate(text: str, limit: int) -> str:
    """字符级截断（中文每个字符占 1，不按 UTF-8 byte）。"""
    if not isinstance(text, str):
        text = str(text or "")
    return text[:limit]


def _build_prompt(keyword: str, findings: list[dict]) -> str:
    """构造让 LLM 生成合规 JSON 的 prompt。"""
    # 只给前 7 条 findings，每条 title + content 前 400 字，避免 prompt 超长
    findings_summary = "\n".join(
        f"{i + 1}. 【{(f.get('title') or '')[:80]}】{(f.get('content') or '')[:400]}"
        for i, f in enumerate(findings[:7])
    )

    return f"""你正在为「{keyword}」生成一张社交媒体人物卡片（V6 模板）。
模板对每个字段有**严格字符预算**，超出会导致渲染时文字溢出/被裁切。

## 输入（research findings）
{findings_summary}

## 输出要求（严格 JSON，禁止 Markdown fence，禁止解释）

```json
{{
  "name": "<≤ {BUDGET['name']} 字，短人物名或核心概念名，不能是整段话>",
  "handle": "<≤ {BUDGET['handle']} 字，@xxx 格式英文/拼音，如 @solo-company>",
  "headline": "<≤ {BUDGET['headline']} 字，一句话核心主张>",
  "key_stats": [
    {{"val": "<≤ {BUDGET['stat_val']} 字，数字或短词>", "label": "<≤ {BUDGET['stat_label']} 字>", "sub": "<≤ {BUDGET['stat_sub']} 字 补充>"}},
    {{"val": "<≤ {BUDGET['stat_val']} 字>", "label": "<≤ {BUDGET['stat_label']} 字>", "sub": "<≤ {BUDGET['stat_sub']} 字>"}},
    {{"val": "<≤ {BUDGET['stat_val']} 字>", "label": "<≤ {BUDGET['stat_label']} 字>", "sub": "<≤ {BUDGET['stat_sub']} 字>"}}
  ],
  "flywheel": ["<≤ {BUDGET['flywheel_item']} 字>", "<≤ {BUDGET['flywheel_item']} 字>", "<≤ {BUDGET['flywheel_item']} 字>", "<≤ {BUDGET['flywheel_item']} 字>"],
  "flywheel_insight": "<≤ {BUDGET['flywheel_insight']} 字 心法>",
  "quote": "<≤ {BUDGET['quote']} 字 金句>"
}}
```

## 硬规则
1. name 绝对不能是完整 keyword（如不要 "为什么 2026 年龙虾 让一人公司..."），必须是该话题的**核心短名**（如 "一人公司"、"龙虾效应"、"AI 自由职业"）
2. 每个字段严格不超预算（中文按字符计）
3. flywheel 4 个节点应构成一个闭环（如：输入→加工→输出→反哺）
4. 只输出 JSON 对象本身，前后无任何文字

现在输出 JSON："""


def _call_cecelia_llm(prompt: str) -> str | None:
    """调 Cecelia /api/brain/llm-service/generate（tier=cortex）。

    Returns: 生成的文本；失败返回 None。
    """
    brain_url = os.environ.get("BRAIN_URL", "http://localhost:5221")
    body = json.dumps({
        "tier": "cortex",
        "prompt": prompt,
        "max_tokens": LLM_MAX_TOKENS,
        "timeout": LLM_TIMEOUT_SEC,
        "format": "json",
    }).encode("utf-8")

    headers = {"Content-Type": "application/json"}
    # 可选鉴权（internalAuth 白名单默认放行）
    token = os.environ.get("CECELIA_INTERNAL_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(
        f"{brain_url}/api/brain/llm-service/generate",
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=LLM_TIMEOUT_SEC + 10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            payload = data.get("data") if isinstance(data.get("data"), dict) else data
            text = payload.get("text") or payload.get("content") or ""
            if not text:
                logger.warning("[person-data-builder] LLM 返回空内容 raw=%s", str(data)[:300])
                return None
            return text
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
        logger.warning("[person-data-builder] LLM 调用失败: %s", e)
        return None
    except Exception as e:  # pragma: no cover
        logger.warning("[person-data-builder] LLM 异常: %s", e)
        return None


def _strip_json_fence(text: str) -> str:
    """去掉 markdown fence 包裹，仅保留 JSON 内容。"""
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*\n?", "", t)
        t = re.sub(r"\n?```\s*$", "", t)
    return t.strip()


def _enforce_budget(data: dict, keyword: str) -> dict:
    """防御性：即便 LLM 超预算，也硬截断到合规。"""
    out: dict[str, Any] = {}
    out["name"] = _truncate(data.get("name") or _fallback_name(keyword), BUDGET["name"])
    handle = data.get("handle") or f"@{_slug(keyword)}"
    if not handle.startswith("@"):
        handle = "@" + handle
    out["handle"] = _truncate(handle, BUDGET["handle"])
    out["headline"] = _truncate(data.get("headline") or keyword, BUDGET["headline"])

    key_stats_in = data.get("key_stats") or []
    key_stats: list[dict] = []
    for s in key_stats_in[:3]:
        if not isinstance(s, dict):
            continue
        key_stats.append({
            "val": _truncate(s.get("val", ""), BUDGET["stat_val"]),
            "label": _truncate(s.get("label", ""), BUDGET["stat_label"]),
            "sub": _truncate(s.get("sub", ""), BUDGET["stat_sub"]),
        })
    while len(key_stats) < 3:
        key_stats.append({"val": str(len(key_stats) + 1), "label": "待补充", "sub": ""})
    out["key_stats"] = key_stats

    flywheel_in = data.get("flywheel") or []
    flywheel = [
        _truncate(x if isinstance(x, str) else str(x), BUDGET["flywheel_item"])
        for x in flywheel_in[:4]
    ]
    while len(flywheel) < 4:
        flywheel.append("待补充")
    out["flywheel"] = flywheel

    out["flywheel_insight"] = _truncate(
        data.get("flywheel_insight") or "一次投入，无限次收益",
        BUDGET["flywheel_insight"],
    )
    out["quote"] = _truncate(data.get("quote") or out["name"], BUDGET["quote"])

    # 模板需要但 LLM 未生成的空字段
    out["timeline"] = []
    out["day_schedule"] = []
    out["qa"] = []
    out["avatar_b64_file"] = None
    return out


def _fallback_name(keyword: str) -> str:
    """从 keyword 里尝试提取一个合理短名（启发式）。

    规则：
    1. 去掉常见修饰词（"为什么"、"如何"、"的"、年份）
    2. 按空格/中文标点切分，取最长的 ≤ 8 字片段
    3. 兜底：前 8 字
    """
    cleaned = re.sub(r"\d{4}\s*年?", "", keyword)
    cleaned = re.sub(r"(为什么|如何|怎么|怎样|为什么是|是什么|为何)", "", cleaned)
    cleaned = cleaned.strip()
    parts = re.split(r"[\s,，。、:：/\-—]+", cleaned)
    candidates = [p for p in parts if 2 <= len(p) <= BUDGET["name"]]
    if candidates:
        candidates.sort(key=lambda p: abs(len(p) - BUDGET["name"]))
        return candidates[0]
    return cleaned[: BUDGET["name"]] if cleaned else keyword[: BUDGET["name"]]


def _build_fallback(keyword: str, findings: list[dict]) -> dict:
    """LLM 不可用时的 fallback：按预算硬截断，不塞整段 keyword。"""
    logger.warning("[person-data-builder] 使用硬截断 fallback")
    name = _fallback_name(keyword)
    key_stats = []
    for i, f in enumerate(findings[:3]):
        key_stats.append({
            "val": str(i + 1),
            "label": _truncate(f.get("title", "") or "", BUDGET["stat_label"]),
            "sub": "",
        })
    flywheel = [
        _truncate(f.get("title", "") or "", BUDGET["flywheel_item"])
        for f in findings[:4]
    ]
    quote_src = ""
    if findings:
        quote_src = findings[0].get("content", "") or findings[0].get("title", "") or ""
    data = {
        "name": name,
        "handle": f"@{_slug(keyword)}",
        "headline": _truncate(
            findings[0].get("title", "") if findings else keyword,
            BUDGET["headline"],
        ),
        "key_stats": key_stats,
        "flywheel": flywheel,
        "flywheel_insight": _truncate(name, BUDGET["flywheel_insight"]),
        "quote": _truncate(quote_src, BUDGET["quote"]),
    }
    return _enforce_budget(data, keyword)


def build_person_data(keyword: str, findings: list[dict]) -> dict:
    """主入口：调 LLM 生成合规 person-data，失败降级硬截断。

    Args:
        keyword: 话题关键词
        findings: research 阶段产出的 findings 列表

    Returns:
        dict: 符合 V6 模板字段预算的 person-data
    """
    if not findings:
        logger.warning("[person-data-builder] findings 为空，只能用关键词兜底")
        return _build_fallback(keyword, [])

    prompt = _build_prompt(keyword, findings)
    text = _call_cecelia_llm(prompt)
    if not text:
        return _build_fallback(keyword, findings)

    stripped = _strip_json_fence(text)
    try:
        data = json.loads(stripped)
    except json.JSONDecodeError as e:
        logger.warning(
            "[person-data-builder] LLM 输出非合法 JSON: %s; 前 200 字: %s",
            e, stripped[:200],
        )
        return _build_fallback(keyword, findings)

    if not isinstance(data, dict):
        logger.warning("[person-data-builder] LLM 输出非 dict，回退 fallback")
        return _build_fallback(keyword, findings)

    enforced = _enforce_budget(data, keyword)
    logger.info(
        "[person-data-builder] LLM 生成成功: name=%s handle=%s",
        enforced["name"], enforced["handle"],
    )
    return enforced
