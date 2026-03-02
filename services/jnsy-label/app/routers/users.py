"""
用户管理模块 - CRUD API
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import os

router = APIRouter(prefix="/api/users", tags=["users"])

# 用户数据存储路径
USERS_FILE = "/app/data/users.json"

def _load_users():
    """加载用户数据"""
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    # 默认用户
    return {
        "13800000001": {"name": "学员小明", "password": "123456", "role": "student"},
        "13800000002": {"name": "学员小红", "password": "123456", "role": "student"},
        "admin": {"name": "管理员", "password": "admin123", "role": "admin"},
    }

def _save_users(users):
    """保存用户数据"""
    os.makedirs(os.path.dirname(USERS_FILE), exist_ok=True)
    with open(USERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(users, f, ensure_ascii=False, indent=2)

# 全局用户缓存
_users_cache = None

def _get_users():
    global _users_cache
    if _users_cache is None:
        _users_cache = _load_users()
    return _users_cache

def get_user_by_phone(phone: str):
    """供其他模块调用"""
    return _get_users().get(phone)

class UserCreate(BaseModel):
    phone: str
    name: str
    password: str
    role: Optional[str] = "student"

class UserUpdate(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None

@router.get("")
async def list_users():
    """获取所有用户（不返回密码）"""
    users = _get_users()
    return [
        {"phone": phone, "name": u["name"], "role": u.get("role", "student")}
        for phone, u in users.items()
    ]

@router.get("/{phone}")
async def get_user(phone: str):
    """获取单个用户"""
    user = _get_users().get(phone)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    return {"phone": phone, "name": user["name"], "role": user.get("role", "student")}

@router.post("")
async def create_user(user: UserCreate):
    """创建用户"""
    users = _get_users()
    if user.phone in users:
        raise HTTPException(status_code=400, detail="手机号已存在")
    users[user.phone] = {
        "name": user.name,
        "password": user.password,
        "role": user.role
    }
    _save_users(users)
    return {"success": True, "phone": user.phone}

@router.put("/{phone}")
async def update_user(phone: str, user: UserUpdate):
    """更新用户"""
    users = _get_users()
    if phone not in users:
        raise HTTPException(status_code=404, detail="用户不存在")
    if user.name:
        users[phone]["name"] = user.name
    if user.password:
        users[phone]["password"] = user.password
    if user.role:
        users[phone]["role"] = user.role
    _save_users(users)
    return {"success": True}

@router.delete("/{phone}")
async def delete_user(phone: str):
    """删除用户"""
    users = _get_users()
    if phone not in users:
        raise HTTPException(status_code=404, detail="用户不存在")
    if phone == "admin":
        raise HTTPException(status_code=400, detail="不能删除管理员账户")
    del users[phone]
    _save_users(users)
    return {"success": True}
