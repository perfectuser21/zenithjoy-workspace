"""Stage 2: LLM 文案生成

基于 research findings 生成社交媒体文案 + 公众号长文。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from datetime import date
from pathlib import Path

logger = logging.getLogger("pipeline-worker.copywriting")

OUTPUT_BASE = os.environ.get(
    "CONTENT_OUTPUT_DIR",
    str(Path.home() / "content-output"),
)

MIN_SOCIAL_COPY_LEN = 200
MIN_ARTICLE_LEN = 500


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _load_findings(keyword: str) -> list[dict]:
    """从 research 目录加载 findings。"""
    research_dir = Path(OUTPUT_BASE) / "research"
    if not research_dir.exists():
        return []

    s = _slug(keyword)
    best_findings: list[dict] = []
    for cand in research_dir.iterdir():
        if s in cand.name:
            fp = cand / "findings.json"
            if fp.exists():
                try:
                    data = json.loads(fp.read_text("utf-8"))
                    f = data.get("findings", [])
                    if len(f) > len(best_findings):
                        best_findings = f
                except (json.JSONDecodeError, OSError):
                    pass
    return best_findings


def _filter_top(findings: list[dict]) -> list[dict]:
    top = [f for f in findings if (f.get("brand_relevance") or 0) >= 3][:7]
    if not top and findings:
        top = findings[:7]
    return top


def _call_llm(prompt: str, max_tokens: int = 8192, timeout: int = 180) -> str | None:
    """调用 LLM（通过 Cecelia llm-caller 或直接 anthropic CLI）。"""
    # 使用 anthropic 命令行或 curl 调用 LLM
    # 先尝试 Cecelia brain 的 llm 接口
    brain_url = os.environ.get("BRAIN_URL", "http://localhost:5221")
    import urllib.request
    import urllib.error

    body = json.dumps({
        "tier": "thalamus",
        "prompt": prompt,
        "max_tokens": max_tokens,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{brain_url}/api/brain/llm-service/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            # 兼容新格式 {success, data: {text, content}, error} 和旧格式 {text}
            payload = data.get("data") if isinstance(data.get("data"), dict) else data
            return payload.get("text") or payload.get("content", "")
    except Exception as e:
        logger.warning("LLM via Cecelia 失败: %s", e)

    # fallback: 直接调用 anthropic CLI
    try:
        result = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "text"],
            capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except Exception as e:
        logger.warning("LLM via claude CLI 失败: %s", e)

    return None


def execute_copywriting(run_data: dict) -> dict:
    """执行文案生成阶段。

    Args:
        run_data: {keyword, content_type, previous_feedback?, ...}

    Returns:
        {success: bool, output_dir?: str, files?: list, error?: str}
    """
    from ._fake import fake_output_dir, is_fake_mode

    keyword = run_data.get("keyword", "")
    previous_feedback = run_data.get("previous_feedback")

    # PR-e/5 端到端 CI fake 模式：跳过 LLM 调用
    if is_fake_mode():
        out_dir = fake_output_dir(run_data, "copywriting")
        fp = Path(out_dir) / "content.md"
        fp.write_text(f"# {keyword}\n\n(fake copywriting output for e2e CI)\n", encoding="utf-8")
        logger.info("[copywriting] fake mode: skipping LLM, stub at %s", fp)
        return {"success": True, "output_dir": out_dir, "files": [str(fp)]}

    logger.info("[copywriting] 开始: %s", keyword)

    findings = _load_findings(keyword)
    top = _filter_top(findings)
    logger.info("[copywriting] 找到 %d 条 findings，筛选 %d 条", len(findings), len(top))

    if not top:
        return {"success": False, "error": "research findings 为空，无法生成文案，请先完成 research 阶段"}

    findings_summary = "\n".join(
        f"{i+1}. {f.get('title', '')}: {(f.get('content') or '')[:1500]}"
        for i, f in enumerate(top)
    )

    prompt = f"""你是一位专业的内容创作者，擅长将调研素材转化为高质量的社交媒体文案和深度长文。

## 任务
为「{keyword}」创作两个版本的内容：
1. 社交媒体文案（小红书/抖音风格，500-800字，口语化，含互动引导）
2. 公众号长文（深度分析，1500-2000字，结构清晰）

## 调研素材（{len(top)} 条）
{findings_summary}
"""

    if previous_feedback:
        prompt += f"\n\n## 上次审查意见（请针对以下问题改进）\n{previous_feedback}"

    prompt += """

请严格按以下格式输出，不要省略分隔符：
=== 社交媒体文案 ===
[在此输出小红书/抖音风格文案，500-800字，口语化，含互动引导]
=== 公众号长文 ===
[在此输出深度分析长文，1500-2000字，结构清晰]

**绝对禁止**：不要询问用户问题，不要说"需要更多信息"，不要输出选项让用户选择。必须直接输出完整文案。"""

    text = _call_llm(prompt)
    if not text:
        return {"success": False, "error": "LLM 调用失败，无返回内容"}

    # 解析输出
    social_match = re.search(r"=== 社交媒体文案 ===([\s\S]*?)(?:=== 公众[号]?长文 ===|$)", text)
    article_match = re.search(r"=== 公众[号]?长文 ===([\s\S]*?)$", text)
    social_copy = (social_match.group(1).strip() if social_match else "").strip()
    article_copy = (article_match.group(1).strip() if article_match else "").strip()

    if len(social_copy) < MIN_SOCIAL_COPY_LEN or len(article_copy) < MIN_ARTICLE_LEN:
        return {
            "success": False,
            "error": f"LLM 输出不符格式要求（社交 {len(social_copy)}字/{MIN_SOCIAL_COPY_LEN}，长文 {len(article_copy)}字/{MIN_ARTICLE_LEN}）",
        }

    today_str = date.today().isoformat()
    out_dir = Path(OUTPUT_BASE) / f"{today_str}-{_slug(keyword)}"
    (out_dir / "cards").mkdir(parents=True, exist_ok=True)
    (out_dir / "article").mkdir(parents=True, exist_ok=True)

    (out_dir / "cards" / "copy.md").write_text(
        f"# {keyword}：社交媒体文案\n\n{social_copy}\n", encoding="utf-8",
    )
    (out_dir / "article" / "article.md").write_text(
        f"# {keyword}：深度分析\n\n{article_copy}\n", encoding="utf-8",
    )

    logger.info("[copywriting] 完成: %s", out_dir)
    return {
        "success": True,
        "output_dir": str(out_dir),
        "files": ["cards/copy.md", "article/article.md"],
    }
