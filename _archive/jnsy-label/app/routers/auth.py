from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from ._utils import now_utc
from ..db import get_db
from .. import models
from ..security import hash_password, verify_password, create_access_token
from ..schemas import ActivateIn, LoginIn, TokenOut

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/activate", response_model=TokenOut)
def activate(payload: ActivateIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.phone == payload.phone).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found (not whitelisted)")
    if user.status == "DISABLED":
        raise HTTPException(status_code=403, detail="User disabled")
    if user.name != payload.name:
        raise HTTPException(status_code=400, detail="Name/phone mismatch")

    inv = (
        db.query(models.Invite)
        .filter(models.Invite.user_id == user.id, models.Invite.code == payload.code)
        .order_by(models.Invite.id.desc())
        .first()
    )
    if not inv:
        raise HTTPException(status_code=400, detail="Invalid invite code")
    if inv.used_at is not None:
        raise HTTPException(status_code=400, detail="Invite code already used")
    if inv.expires_at < now_utc():
        raise HTTPException(status_code=400, detail="Invite code expired")

    user.password_hash = hash_password(payload.password)
    user.status = "ACTIVE"
    inv.used_at = now_utc()
    db.add_all([user, inv])
    db.commit()

    token = create_access_token(subject=user.phone)
    return TokenOut(access_token=token)

@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.phone == payload.phone).first()
    if not user or user.status != "ACTIVE" or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(subject=user.phone)
    return TokenOut(access_token=token)
