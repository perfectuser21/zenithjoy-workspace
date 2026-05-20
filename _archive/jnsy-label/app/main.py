# 金诺AI - 数据标注平台
from fastapi import FastAPI, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os

app = FastAPI(title="金诺AI", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 导入路由
from .routers import labeling, users, stats
app.include_router(labeling.router)
app.include_router(users.router)
app.include_router(stats.router)

print("🚀 金诺AI 启动")

# UI 静态文件 (支持开发和生产环境)
ui_candidates = [
    "/app/ui",                                    # Docker 生产环境
    os.path.join(os.path.dirname(__file__), "ui"), # 开发环境 (相对路径)
]
ui_folder = next((p for p in ui_candidates if os.path.exists(p)), None)
if ui_folder:
    app.mount("/ui", StaticFiles(directory=ui_folder, html=True), name="ui")
    print(f"✅ UI: {ui_folder}")
else:
    print("⚠️ UI 目录未找到")

@app.get("/")
async def root():
    return RedirectResponse(url="/ui/login.html")

@app.get("/api/status")
async def status():
    return {"status": "OK", "version": "2.0.0", "label_studio": "已集成"}

# ============ 认证系统 ============
class LoginRequest(BaseModel):
    phone: str
    password: str

@app.post("/auth/login")
async def login(req: LoginRequest):
    from .routers.users import get_user_by_phone
    user = get_user_by_phone(req.phone)
    if user and user["password"] == req.password:
        return {
            "access_token": f"token_{req.phone}",
            "token_type": "bearer",
            "user": {"phone": req.phone, "name": user["name"], "role": user.get("role", "student")}
        }
    raise HTTPException(status_code=401, detail="手机号或密码错误")

@app.get("/api/user/me")
async def get_me(token: str = ""):
    from .routers.users import get_user_by_phone
    if token.startswith("token_"):
        phone = token.replace("token_", "")
        user = get_user_by_phone(phone)
        if user:
            return {"phone": phone, "name": user["name"], "role": user.get("role", "student")}
    raise HTTPException(status_code=401, detail="未登录")
