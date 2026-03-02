from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models
from ..db import get_db
from ..security import get_current_user
from ..schemas import QuestionOut, SubmitIn, SubmitOut

router = APIRouter()


@router.get("", response_model=List[QuestionOut])
def list_questions(
    type: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    q = db.query(models.Question)
    if type:
        q = q.filter(models.Question.type == type)
    items = q.order_by(models.Question.id.desc()).all()
    return [QuestionOut(id=x.id, type=x.type, stem=x.stem) for x in items]


@router.get("/{question_id}", response_model=QuestionOut)
def get_question(
    question_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    x = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not x:
        raise HTTPException(status_code=404, detail="Question not found")
    return QuestionOut(id=x.id, type=x.type, stem=x.stem)


@router.post("/{question_id}/submit", response_model=SubmitOut)
def submit_answer(
    question_id: int,
    payload: SubmitIn,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """
    文本标注判分：只接收 selected_label
    """
    q = db.query(models.Question).filter(models.Question.id == question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    if q.type != "text_classification":
        raise HTTPException(status_code=400, detail="This endpoint is for text_classification only")

    correct = (q.correct_label or "").strip()
    selected = (payload.selected_label or "").strip()
    is_correct = (selected == correct)

    sub = models.Submission(
        user_id=user.id,
        question_id=q.id,
        answer={"selected_label": selected},
        is_correct=is_correct,
        score=1 if is_correct else 0,
        feedback={"correct_label": correct},
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    return SubmitOut(
        ok=True,
        is_correct=is_correct,
        score=sub.score,
        attempt=sub.attempt,
        explanation=None,
    )


@router.get("/me/history")
def my_history(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    subs = (
        db.query(models.Submission)
        .filter(models.Submission.user_id == user.id)
        .order_by(models.Submission.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id": s.id,
            "question_id": s.question_id,
            "is_correct": s.is_correct,
            "score": s.score,
            "attempt": s.attempt,
            "created_at": s.created_at.isoformat(),
        }
        for s in subs
    ]
