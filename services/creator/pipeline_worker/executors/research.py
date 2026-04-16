"""Stage 1: NotebookLM 调研

从 NotebookLM 拉取调研素材，输出 findings.json。
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
from datetime import date
from pathlib import Path

logger = logging.getLogger("pipeline-worker.research")

OUTPUT_BASE = os.environ.get(
    "CONTENT_OUTPUT_DIR",
    str(Path.home() / "content-output"),
)


def _slug(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-zA-Z0-9\u4e00-\u9fff-]", "-", text))[:40]


def _run(cmd: str, timeout: int = 60) -> str | None:
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (subprocess.TimeoutExpired, Exception) as e:
        logger.error("cmd 失败: %s → %s", cmd[:80], e)
        return None


def _parse_findings(raw: str | None, keyword: str) -> list[dict]:
    if not raw or not raw.strip():
        return []
    try:
        data = json.loads(raw)
        answer = data.get("answer", "")
        if not answer.strip():
            return []
        parts = re.split(r"\n\*\*\d+\.", answer)
        parts = [p for p in parts if p.strip()]
        findings = []
        for i, p in enumerate(parts):
            title_line = p.strip().split("\n")[0].replace("*", "").strip()[:100] or f"发现{i+1}"
            findings.append({
                "id": f"f{i+1:03d}",
                "title": title_line,
                "content": p.strip(),
                "source": "NotebookLM",
                "brand_relevance": 4,
                "used_in": [],
            })
        return findings
    except json.JSONDecodeError:
        return [{"id": "f001", "title": keyword, "content": raw[:3000], "source": "NotebookLM", "brand_relevance": 3, "used_in": []}]


def execute_research(run_data: dict) -> dict:
    """执行调研阶段。

    Args:
        run_data: {keyword, notebook_id, content_type, output_dir, ...}

    Returns:
        {success: bool, findings_path?: str, findings_count?: int, error?: str}
    """
    from ._fake import fake_output_dir, is_fake_mode

    keyword = run_data.get("keyword", "")
    notebook_id = run_data.get("notebook_id")
    content_type = run_data.get("content_type", "solo-company-case")

    # PR-e/5 端到端 CI fake 模式：跳过 NotebookLM
    if is_fake_mode():
        out_dir = fake_output_dir(run_data, "research")
        fp = Path(out_dir) / "findings.json"
        import json as _json

        fp.write_text(
            _json.dumps({"keyword": keyword, "findings": [], "fake": True}, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("[research] fake mode: skipping NotebookLM, stub at %s", fp)
        return {"success": True, "findings_path": str(fp), "findings_count": 0, "output_dir": out_dir}

    logger.info("[research] 开始: %s (notebook=%s)", keyword, notebook_id or "无")

    if not notebook_id:
        return {"success": False, "error": "notebook_id 未配置"}

    today_str = date.today().isoformat()
    out_dir = Path(OUTPUT_BASE) / "research" / f"{content_type}-{_slug(keyword)}-{today_str}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # 选择 notebook
    _run(f'notebooklm use {notebook_id} 2>&1')

    # 清空旧 sources
    _run('notebooklm source clear 2>&1', timeout=30)

    # web 搜索
    logger.info("[research] 开始 web 搜索: %s", keyword)
    _run(f'notebooklm source add-research "{keyword}" --mode deep --no-wait 2>&1', timeout=30)

    # 等待研究完成
    wait_result = _run('notebooklm research wait --timeout 300 --import-all 2>&1', timeout=330)
    logger.info("[research] 研究完成: %s", (wait_result or "(无输出)")[:200])

    # 提问获取 findings
    prompt = f"从所有源中，找出能证明'个人也能拥有过去只有公司才有的能力'的证据。关于{keyword}，每条带具体数据和来源。至少8条。"
    raw = _run(f'notebooklm ask "{prompt}" --json 2>&1', timeout=120)

    findings = _parse_findings(raw, keyword)
    if not findings:
        return {"success": False, "error": "NotebookLM 返回空内容或解析失败"}

    fp = out_dir / "findings.json"
    data = {
        "keyword": keyword,
        "series": content_type,
        "notebook_id": notebook_id,
        "extracted_at": today_str,
        "total_findings": len(findings),
        "findings": findings,
    }
    fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # 清空 sources
    _run('notebooklm source clear 2>&1', timeout=30)

    logger.info("[research] 完成: %d findings → %s", len(findings), fp)
    return {"success": True, "findings_path": str(fp), "findings_count": len(findings)}
