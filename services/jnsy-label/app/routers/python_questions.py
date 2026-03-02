from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..schemas import PythonRunIn, PythonRunOut, PythonSubmitIn, PythonSubmitOut

router = APIRouter()


def _run_python(code: str, time_limit_sec: int = 2) -> tuple[bool, str, str]:
    """
    返回: (ok, stdout, stderr)
    """
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "main.py"
        p.write_text(code, encoding="utf-8")

        try:
            cp = subprocess.run(
                [sys.executable, str(p)],
                capture_output=True,
                text=True,
                timeout=max(1, int(time_limit_sec)),
            )
            ok = (cp.returncode == 0)
            stdout = (cp.stdout or "").strip()
            stderr = (cp.stderr or "").strip()
            return ok, stdout, stderr
        except subprocess.TimeoutExpired:
            return False, "", "Time limit exceeded"


@router.post("/{question_id}/run", response_model=PythonRunOut)
def run_code(
    question_id: int,
    payload: PythonRunIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    if q.type != "python":
        raise HTTPException(status_code=400, detail="This endpoint is for python questions only")

    time_limit = 2
    if isinstance(q.payload, dict):
        time_limit = int(q.payload.get("time_limit_sec", 2) or 2)

    ok, stdout, stderr = _run_python(payload.code, time_limit_sec=time_limit)
    return PythonRunOut(ok=ok, stdout=stdout, stderr=stderr, time_ms=0)


@router.post("/{question_id}/python_submit", response_model=PythonSubmitOut)
def python_submit(
    question_id: int,
    payload: PythonSubmitIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """
    Python 判分：独立 endpoint，避免与文本判分 /submit 冲突
    """
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    if q.type != "python":
        raise HTTPException(status_code=400, detail="This endpoint is for python questions only")

    if not isinstance(q.payload, dict):
        raise HTTPException(status_code=500, detail="Invalid python question payload")

    expected = str(q.payload.get("expected_stdout", "") or "").strip()
    strict = bool(q.payload.get("strict", True))
    time_limit = int(q.payload.get("time_limit_sec", 2) or 2)

    ok, stdout, stderr = _run_python(payload.code, time_limit_sec=time_limit)

    if strict:
        is_correct = (stdout == expected)
    else:
        is_correct = (stdout.strip() == expected.strip())

    sub = models.Submission(
        user_id=user.id,
        question_id=q.id,
        answer={"code": payload.code, "stdout": stdout, "stderr": stderr},
        is_correct=is_correct,
        score=1 if is_correct else 0,
        feedback={"expected_stdout": expected},
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    return PythonSubmitOut(
        ok=True,
        is_correct=is_correct,
        score=sub.score,
        attempt=sub.attempt,
        explanation=None if is_correct else f"期望输出: {expected!r}",
        stdout=stdout,
        stderr=stderr,
    )
