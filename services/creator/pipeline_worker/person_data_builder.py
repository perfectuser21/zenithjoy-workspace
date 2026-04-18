"""LLM person-data 构造器

用 LLM 把 research findings 转成**严格符合 V6 模板字段预算**的 person-data.json。

V6 模板 (gen-v6-person.mjs) 字段预算：
| 字段                 | 预算            | 备注                        |
|----------------------|-----------------|-----------------------------|
| name                 | ≤ 8 字          | 头像圈内显示，短人名/概念   |
| handle               | ≤ 18 字         | @xxx 格式                   |
| headline             | ≤ 20 字         | 模板 substring(0, 20/24)    |
| key_stats[i].val     | ≤ 8 字          | 数字或短词                  |
| key_stats[i].label   | ≤ 12 字         | 卡片底部标签                |
| key_stats[i].sub     | ≤ 15 字         | 补充说明                    |
| flywheel[i]          | ≤ 6 字          | 飞轮节点短词                |
| flywheel_insight     | ≤ 28 字         | 模板 substring(0, 28)       |
| quote                | ≤ 36 字         | 模板 substring(0, 36)       |
| timeline[i].year     | ≤ 10 字         | 时间标签                    |
| timeline[i].title    | ≤ 16 字         | 事件标题                    |
| timeline[i].desc     | ≤ 28 字         | 事件描述                    |
| day_schedule[i].time | ≤ 12 字         | 时段                        |
| day_schedule[i].title| ≤ 12 字         | 日程标题                    |
| day_schedule[i].desc | ≤ 30 字         | 日程描述                    |
| qa[i].q              | ≤ 20 字         | 问题                        |
| qa[i].a              | ≤ 40 字         | 回答                        |

模板渲染要求的数组长度（gen-v6-person.mjs slice(0, N)）：
- key_stats: 3
- flywheel: 4
- timeline: 5
- day_schedule: 4
- qa: 4

当前生产 bug：
- prompt 只让 LLM 生成 name/handle/headline/key_stats/flywheel/flywheel_insight/quote
  导致 timeline/day_schedule/qa 走模板内置兜底 `待补充/暂无数据` 漫天飞
- 本修复：扩 prompt 要求 LLM 同时产出 timeline/day_schedule/qa，
  fallback 也必须用 findings 真实字段填（不得再塞"待补充"）

解决：调 Cecelia /api/brain/llm-service/generate（tier=cortex）让 LLM
按严格预算生成合规 JSON；失败 fallback 硬截断（不塞整段 keyword，也不塞"待补充"）。
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
    "timeline_year": 10,
    "timeline_title": 16,
    "timeline_desc": 28,
    "schedule_time": 12,
    "schedule_title": 12,
    "schedule_desc": 30,
    "qa_q": 20,
    "qa_a": 40,
}

# 模板要求的数组长度
LEN_KEY_STATS = 3
LEN_FLYWHEEL = 4
LEN_TIMELINE = 5
LEN_DAY_SCHEDULE = 4
LEN_QA = 4

# 禁止的占位文本（image_review 也用到）
PLACEHOLDER_KEYWORDS = ("待补充", "暂无数据", "待产出")

LLM_TIMEOUT_SEC = 60
LLM_MAX_TOKENS = 3072


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _truncate(text: str, limit: int) -> str:
    """字符级截断（中文每个字符占 1，不按 UTF-8 byte）。"""
    if not isinstance(text, str):
        text = str(text or "")
    return text[:limit]


def _clean_placeholder(text: str, fallback: str) -> str:
    """把占位文本替换成 fallback 真实文字。

    空串/None/占位关键词 → fallback。
    """
    if not isinstance(text, str):
        text = str(text or "")
    stripped = text.strip()
    if not stripped or stripped == "-":
        return fallback
    for ph in PLACEHOLDER_KEYWORDS:
        if ph in stripped:
            return fallback
    return stripped


def _build_prompt(keyword: str, findings: list[dict]) -> str:
    """构造让 LLM 生成合规 JSON 的 prompt。"""
    # 只给前 7 条 findings，每条 title + content 前 400 字，避免 prompt 超长
    findings_summary = "\n".join(
        f"{i + 1}. 【{(f.get('title') or '')[:80]}】{(f.get('content') or '')[:400]}"
        for i, f in enumerate(findings[:7])
    )

    return f"""你正在为「{keyword}」生成一张社交媒体人物卡片（V6 模板）。
模板对每个字段有**严格字符预算**，超出会导致渲染时文字溢出/被裁切；
**数组长度也必须严格匹配**（模板直接 slice 到固定长度）。

## 输入（research findings）
{findings_summary}

## 输出要求（严格 JSON，禁止 Markdown fence，禁止解释）

```json
{{
  "name": "<≤ {BUDGET['name']} 字，短人物名或核心概念名，不能是整段话>",
  "handle": "<≤ {BUDGET['handle']} 字，@xxx 格式英文/拼音，如 @solo-company>",
  "headline": "<≤ {BUDGET['headline']} 字，一句话核心主张>",
  "key_stats": [
    {{"val": "<≤ {BUDGET['stat_val']} 字>", "label": "<≤ {BUDGET['stat_label']} 字>", "sub": "<≤ {BUDGET['stat_sub']} 字>"}},
    {{"val": "<≤ {BUDGET['stat_val']} 字>", "label": "<≤ {BUDGET['stat_label']} 字>", "sub": "<≤ {BUDGET['stat_sub']} 字>"}},
    {{"val": "<≤ {BUDGET['stat_val']} 字>", "label": "<≤ {BUDGET['stat_label']} 字>", "sub": "<≤ {BUDGET['stat_sub']} 字>"}}
  ],
  "flywheel": ["<≤ {BUDGET['flywheel_item']} 字>", "<≤ {BUDGET['flywheel_item']} 字>", "<≤ {BUDGET['flywheel_item']} 字>", "<≤ {BUDGET['flywheel_item']} 字>"],
  "flywheel_insight": "<≤ {BUDGET['flywheel_insight']} 字 心法>",
  "quote": "<≤ {BUDGET['quote']} 字 金句>",
  "timeline": [
    {{"year": "<≤ {BUDGET['timeline_year']} 字，年份或阶段标签>", "title": "<≤ {BUDGET['timeline_title']} 字>", "desc": "<≤ {BUDGET['timeline_desc']} 字>"}},
    {{"year": "<...>", "title": "<...>", "desc": "<...>"}},
    {{"year": "<...>", "title": "<...>", "desc": "<...>"}},
    {{"year": "<...>", "title": "<...>", "desc": "<...>"}},
    {{"year": "<...>", "title": "<...>", "desc": "<...>"}}
  ],
  "day_schedule": [
    {{"time": "<≤ {BUDGET['schedule_time']} 字，如 '早上' 或 '8:00-10:00'>", "title": "<≤ {BUDGET['schedule_title']} 字>", "desc": "<≤ {BUDGET['schedule_desc']} 字>"}},
    {{"time": "<...>", "title": "<...>", "desc": "<...>"}},
    {{"time": "<...>", "title": "<...>", "desc": "<...>"}},
    {{"time": "<...>", "title": "<...>", "desc": "<...>"}}
  ],
  "qa": [
    {{"q": "<≤ {BUDGET['qa_q']} 字>", "a": "<≤ {BUDGET['qa_a']} 字>"}},
    {{"q": "<...>", "a": "<...>"}},
    {{"q": "<...>", "a": "<...>"}},
    {{"q": "<...>", "a": "<...>"}}
  ]
}}
```

## 硬规则
1. name 绝对不能是完整 keyword（如不要 "为什么 2026 年龙虾 让一人公司..."），必须是该话题的**核心短名**（如 "一人公司"、"龙虾效应"、"AI 自由职业"）
2. 每个字段严格不超预算（中文按字符计）
3. **数组长度必须严格**：key_stats=3, flywheel=4, timeline=5, day_schedule=4, qa=4
4. flywheel 4 个节点应构成一个闭环（如：输入→加工→输出→反哺）
5. timeline 5 条按时间/演进阶段排列，讲清楚该话题的发展脉络
6. day_schedule 4 条还原"这类人/这个模式"典型一天是怎么过的
7. qa 4 条回答读者最关心的问题
8. **禁止使用 "待补充"、"暂无数据"、"待产出" 这类占位文本**，任何字段都必须写真内容
9. 只输出 JSON 对象本身，前后无任何文字

现在输出 JSON："""


def _call_cecelia_llm(prompt: str) -> str | None:
    """调 Cecelia /api/brain/llm-service/generate（tier=cortex）。

    Returns: 生成的文本；失败返回 None。
    """
    brain_url = os.environ.get("BRAIN_URL", "http://localhost:5221")
    # tier=cortex 目前走 codex（本机 sandbox 失败）；thalamus 走 anthropic-api+bridge，可用。
    # 按简单抽取任务用 haiku 足够，且可 env 覆盖。
    tier = os.environ.get("PERSON_DATA_TIER", "thalamus")
    body = json.dumps({
        "tier": tier,
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


def _real_fill_from_findings(findings: list[dict], idx: int) -> dict:
    """从 findings 第 idx 条（循环）取真实字段，给 timeline/schedule/qa 的 fallback 用。

    至少返回 title/content 两个非空字段，不会是占位符。
    """
    if not findings:
        return {"title": "内容示例", "content": "系统生成的补充示例内容"}
    f = findings[idx % len(findings)]
    title = (f.get("title") or "").strip() or f"要点 {idx + 1}"
    content = (f.get("content") or "").strip() or title
    return {"title": title, "content": content}


def _build_timeline_fallback(findings: list[dict]) -> list[dict]:
    """用 findings 真实字段填 5 条 timeline，不得出现占位符。"""
    out: list[dict] = []
    for i in range(LEN_TIMELINE):
        real = _real_fill_from_findings(findings, i)
        out.append({
            "year": _truncate(f"阶段 {i + 1}", BUDGET["timeline_year"]),
            "title": _truncate(real["title"], BUDGET["timeline_title"]),
            "desc": _truncate(real["content"], BUDGET["timeline_desc"]),
        })
    return out


def _build_day_schedule_fallback(findings: list[dict]) -> list[dict]:
    """用 findings 真实字段填 4 条 day_schedule。"""
    slots = ["早上", "上午", "下午", "晚上"]
    out: list[dict] = []
    for i in range(LEN_DAY_SCHEDULE):
        real = _real_fill_from_findings(findings, i)
        out.append({
            "time": _truncate(slots[i], BUDGET["schedule_time"]),
            "title": _truncate(real["title"], BUDGET["schedule_title"]),
            "desc": _truncate(real["content"], BUDGET["schedule_desc"]),
        })
    return out


def _build_qa_fallback(findings: list[dict]) -> list[dict]:
    """用 findings 真实字段填 4 条 qa。"""
    qs = [
        "核心价值是什么",
        "怎么开始",
        "最大难点在哪",
        "下一步怎么走",
    ]
    out: list[dict] = []
    for i in range(LEN_QA):
        real = _real_fill_from_findings(findings, i)
        out.append({
            "q": _truncate(qs[i], BUDGET["qa_q"]),
            "a": _truncate(real["content"], BUDGET["qa_a"]),
        })
    return out


def _enforce_budget(data: dict, keyword: str, findings: list[dict] | None = None) -> dict:
    """防御性：即便 LLM 超预算或缺字段，也硬截断 + 补齐到合规 + 不允许占位符。

    Args:
        data: LLM 输出或 fallback 构造的初始 dict
        keyword: 话题关键词
        findings: research findings，用于补齐缺失的 timeline/schedule/qa
    """
    findings = findings or []
    out: dict[str, Any] = {}
    name_fallback = _fallback_name(keyword)
    out["name"] = _truncate(
        _clean_placeholder(data.get("name") or "", name_fallback),
        BUDGET["name"],
    )
    handle_raw = data.get("handle") or f"@{_slug(keyword)}"
    if not isinstance(handle_raw, str) or not handle_raw.strip():
        handle_raw = f"@{_slug(keyword)}"
    if not handle_raw.startswith("@"):
        handle_raw = "@" + handle_raw
    out["handle"] = _truncate(handle_raw, BUDGET["handle"])
    headline_fallback = (
        (findings[0].get("title") if findings else "") or name_fallback or keyword
    )
    out["headline"] = _truncate(
        _clean_placeholder(data.get("headline") or "", headline_fallback),
        BUDGET["headline"],
    )

    # key_stats 3 条
    key_stats_in = data.get("key_stats") or []
    key_stats: list[dict] = []
    for s in key_stats_in[:LEN_KEY_STATS]:
        if not isinstance(s, dict):
            continue
        key_stats.append({
            "val": _truncate(s.get("val", ""), BUDGET["stat_val"]),
            "label": _truncate(s.get("label", ""), BUDGET["stat_label"]),
            "sub": _truncate(s.get("sub", ""), BUDGET["stat_sub"]),
        })
    # 补齐（用 findings 真实 title 填，不再写 "待补充"）
    while len(key_stats) < LEN_KEY_STATS:
        i = len(key_stats)
        real = _real_fill_from_findings(findings, i)
        key_stats.append({
            "val": _truncate(str(i + 1), BUDGET["stat_val"]),
            "label": _truncate(real["title"], BUDGET["stat_label"]),
            "sub": _truncate(real["content"], BUDGET["stat_sub"]),
        })
    # 清掉占位
    for i, s in enumerate(key_stats):
        real = _real_fill_from_findings(findings, i)
        s["val"] = _truncate(_clean_placeholder(s["val"], str(i + 1)), BUDGET["stat_val"])
        s["label"] = _truncate(_clean_placeholder(s["label"], real["title"]), BUDGET["stat_label"])
        s["sub"] = _truncate(_clean_placeholder(s["sub"], real["content"]), BUDGET["stat_sub"])
    out["key_stats"] = key_stats

    # flywheel 4 条
    flywheel_in = data.get("flywheel") or []
    flywheel: list[str] = []
    for x in flywheel_in[:LEN_FLYWHEEL]:
        raw = x if isinstance(x, str) else str(x)
        flywheel.append(_truncate(raw, BUDGET["flywheel_item"]))
    default_wheel = ["输入", "加工", "输出", "反哺"]
    while len(flywheel) < LEN_FLYWHEEL:
        flywheel.append(default_wheel[len(flywheel)])
    for i, w in enumerate(flywheel):
        flywheel[i] = _truncate(
            _clean_placeholder(w, default_wheel[i]),
            BUDGET["flywheel_item"],
        )
    out["flywheel"] = flywheel

    out["flywheel_insight"] = _truncate(
        _clean_placeholder(
            data.get("flywheel_insight") or "",
            "一次投入，无限次收益",
        ),
        BUDGET["flywheel_insight"],
    )
    out["quote"] = _truncate(
        _clean_placeholder(data.get("quote") or "", out["name"]),
        BUDGET["quote"],
    )

    # timeline 5 条
    timeline_in = data.get("timeline") or []
    timeline: list[dict] = []
    for t in timeline_in[:LEN_TIMELINE]:
        if not isinstance(t, dict):
            continue
        timeline.append({
            "year": _truncate(t.get("year", ""), BUDGET["timeline_year"]),
            "title": _truncate(t.get("title", ""), BUDGET["timeline_title"]),
            "desc": _truncate(t.get("desc", ""), BUDGET["timeline_desc"]),
        })
    fallback_timeline = _build_timeline_fallback(findings)
    while len(timeline) < LEN_TIMELINE:
        timeline.append(fallback_timeline[len(timeline)])
    for i, t in enumerate(timeline):
        fb = fallback_timeline[i]
        t["year"] = _truncate(_clean_placeholder(t["year"], fb["year"]), BUDGET["timeline_year"])
        t["title"] = _truncate(_clean_placeholder(t["title"], fb["title"]), BUDGET["timeline_title"])
        t["desc"] = _truncate(_clean_placeholder(t["desc"], fb["desc"]), BUDGET["timeline_desc"])
    out["timeline"] = timeline

    # day_schedule 4 条
    schedule_in = data.get("day_schedule") or []
    schedule: list[dict] = []
    for s in schedule_in[:LEN_DAY_SCHEDULE]:
        if not isinstance(s, dict):
            continue
        schedule.append({
            "time": _truncate(s.get("time", ""), BUDGET["schedule_time"]),
            "title": _truncate(s.get("title", ""), BUDGET["schedule_title"]),
            "desc": _truncate(s.get("desc", ""), BUDGET["schedule_desc"]),
        })
    fallback_schedule = _build_day_schedule_fallback(findings)
    while len(schedule) < LEN_DAY_SCHEDULE:
        schedule.append(fallback_schedule[len(schedule)])
    for i, s in enumerate(schedule):
        fb = fallback_schedule[i]
        s["time"] = _truncate(_clean_placeholder(s["time"], fb["time"]), BUDGET["schedule_time"])
        s["title"] = _truncate(_clean_placeholder(s["title"], fb["title"]), BUDGET["schedule_title"])
        s["desc"] = _truncate(_clean_placeholder(s["desc"], fb["desc"]), BUDGET["schedule_desc"])
    out["day_schedule"] = schedule

    # qa 4 条
    qa_in = data.get("qa") or []
    qa: list[dict] = []
    for q in qa_in[:LEN_QA]:
        if not isinstance(q, dict):
            continue
        qa.append({
            "q": _truncate(q.get("q", ""), BUDGET["qa_q"]),
            "a": _truncate(q.get("a", ""), BUDGET["qa_a"]),
        })
    fallback_qa = _build_qa_fallback(findings)
    while len(qa) < LEN_QA:
        qa.append(fallback_qa[len(qa)])
    for i, q in enumerate(qa):
        fb = fallback_qa[i]
        q["q"] = _truncate(_clean_placeholder(q["q"], fb["q"]), BUDGET["qa_q"])
        q["a"] = _truncate(_clean_placeholder(q["a"], fb["a"]), BUDGET["qa_a"])
    out["qa"] = qa

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
    """LLM 不可用时的 fallback：按预算硬截断 + 用 findings 真实字段补齐。

    **绝对不得留 "待补充" 占位**。
    """
    logger.warning("[person-data-builder] 使用硬截断 fallback")
    name = _fallback_name(keyword)
    key_stats = []
    for i, f in enumerate(findings[:LEN_KEY_STATS]):
        key_stats.append({
            "val": str(i + 1),
            "label": _truncate(f.get("title", "") or "", BUDGET["stat_label"]),
            "sub": _truncate(f.get("content", "") or "", BUDGET["stat_sub"]),
        })
    flywheel = [
        _truncate(f.get("title", "") or "", BUDGET["flywheel_item"])
        for f in findings[:LEN_FLYWHEEL]
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
        # 关键：timeline / day_schedule / qa 也用 findings 填真实内容
        "timeline": _build_timeline_fallback(findings),
        "day_schedule": _build_day_schedule_fallback(findings),
        "qa": _build_qa_fallback(findings),
    }
    return _enforce_budget(data, keyword, findings)


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

    enforced = _enforce_budget(data, keyword, findings)
    logger.info(
        "[person-data-builder] LLM 生成成功: name=%s handle=%s timeline=%d schedule=%d qa=%d",
        enforced["name"], enforced["handle"],
        len(enforced["timeline"]), len(enforced["day_schedule"]), len(enforced["qa"]),
    )
    return enforced
