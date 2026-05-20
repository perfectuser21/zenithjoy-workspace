from datetime import datetime, timedelta
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from .config import settings
from .db import get_db
from . import models
from passlib.exc import UnknownHashError
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.exc import UnknownHashError

pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")
ALGORITHM = "HS256"

bearer_scheme = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except (UnknownHashError, ValueError, TypeError):
        # hash 不可识别/为空/格式异常时，不要让系统 500，直接当密码不对
        return False

def create_access_token(subject: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode = {"sub": subject, "exp": expire}
    return jwt.encode(to_encode, settings.app_secret_key, algorithm=ALGORITHM)

def get_current_user(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.app_secret_key, algorithms=[ALGORITHM])
        phone: str | None = payload.get("sub")
        if not phone:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = db.query(models.User).filter(models.User.phone == phone).first()
    if not user or user.status != "ACTIVE":
        raise HTTPException(status_code=401, detail="User not active")
    return user

def require_admin(x_admin_key: str | None = Header(default=None, alias="X-ADMIN-KEY")):
    if x_admin_key != settings.admin_key:
        raise HTTPException(status_code=403, detail="Admin key invalid")
    return True
