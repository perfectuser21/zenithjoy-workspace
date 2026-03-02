from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from enum import Enum

from pydantic import BaseModel, Field, validator
import re


# --------------------
# Enums
# --------------------
class QuestionType(str, Enum):
    """题目类型枚举"""
    TEXT = "text"
    PYTHON = "python"


# --------------------
# User / Auth
# --------------------
class UserCreate(BaseModel):
    """创建用户的请求模型"""
    phone: str = Field(..., pattern=r"^\d{11}$", description="11位手机号码")
    password: str = Field(..., min_length=6, max_length=128, description="密码，最少6位")


class UserOut(BaseModel):
    """用户信息响应模型"""
    id: int
    phone: str
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class InviteCreate(BaseModel):
    """邀请用户请求模型"""
    phone: str = Field(..., pattern=r"^\d{11}$", description="11位手机号码")


class InviteOut(BaseModel):
    """邀请用户响应模型"""
    ok: bool
    phone: str
    password: str = Field(..., description="生成的临时密码")


# --------------------
# Authentication Models
# --------------------
class ActivateIn(BaseModel):
    """激活账户请求模型"""
    phone: str = Field(..., pattern=r"^\d{11}$", description="11位手机号码")
    code: str = Field(..., min_length=4, max_length=8, description="激活验证码")


class LoginIn(BaseModel):
    """登录请求模型"""
    phone: str = Field(..., pattern=r"^\d{11}$", description="11位手机号码")
    password: str = Field(..., min_length=6, max_length=128, description="密码")


class TokenOut(BaseModel):
    """令牌响应模型"""
    access_token: str = Field(..., description="访问令牌")
    token_type: str = Field(default="bearer", description="令牌类型")
    expires_in: Optional[int] = Field(default=3600, description="过期时间（秒）")


class ActivateOut(BaseModel):
    """激活账户响应模型"""
    ok: bool
    message: str = Field(default="激活成功", description="响应消息")
    user: Optional[UserOut] = None


class LoginOut(BaseModel):
    """登录响应模型"""
    ok: bool
    token: Optional[TokenOut] = None
    user: Optional[UserOut] = None
    message: Optional[str] = Field(default=None, description="提示信息，如需要激活")


class RefreshTokenIn(BaseModel):
    """刷新令牌请求模型"""
    refresh_token: str = Field(..., description="刷新令牌")


class ChangePasswordIn(BaseModel):
    """修改密码请求模型"""
    old_password: str = Field(..., min_length=6, max_length=128, description="旧密码")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码")


class ResetPasswordIn(BaseModel):
    """重置密码请求模型"""
    phone: str = Field(..., pattern=r"^\d{11}$", description="11位手机号码")
    code: str = Field(..., min_length=4, max_length=8, description="验证码")
    new_password: str = Field(..., min_length=6, max_length=128, description="新密码")


# --------------------
# Questions
# --------------------
class QuestionOut(BaseModel):
    """题目基础信息响应模型"""
    id: int
    type: QuestionType
    stem: str = Field(..., description="题干")
    submodule: Optional[str] = Field(default=None, description="子模块")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class QuestionDetailOut(QuestionOut):
    """题目详情响应模型"""
    labels: Optional[List[str]] = None
    starter_code: Optional[str] = None
    correct_label: Optional[str] = None
    expected_stdout: Optional[str] = None
    strict: Optional[bool] = None
    time_limit_sec: Optional[int] = None


# 文本题创建（admin）
class TextQuestionCreate(BaseModel):
    """文本题目创建请求模型"""
    stem: str = Field(..., min_length=5, description="题干")
    labels: List[str] = Field(..., min_items=2, description="选项列表")
    correct_label: str = Field(..., description="正确答案")
    submodule: Optional[str] = Field(default=None, description="子模块")
    
    @validator('labels')
    def labels_must_contain_correct(cls, v, values):
        if 'correct_label' in values and values['correct_label'] not in v:
            raise ValueError('正确答案必须包含在选项中')
        return v


class TextImportOut(BaseModel):
    """文本题目导入响应模型"""
    ok: bool
    created: int = Field(0, description="成功创建的数量")
    errors: List[ImportErrorItem] = Field(default_factory=list, description="错误列表")


class ImportErrorItem(BaseModel):
    """导入错误项模型"""
    row: int = Field(..., description="行号")
    reason: str = Field(..., description="错误原因")
    data: Optional[Dict[str, Any]] = Field(default=None, description="原始数据")


# Python题创建（admin）
class PythonQuestionCreate(BaseModel):
    """Python题目创建请求模型"""
    stem: str = Field(..., min_length=5, description="题干")
    starter_code: str = Field(..., description="初始代码")
    expected_stdout: str = Field(..., description="预期输出")
    strict: bool = Field(default=True, description="是否严格匹配")
    time_limit_sec: int = Field(default=2, ge=1, le=30, description="时间限制（秒）")
    submodule: Optional[str] = Field(default=None, description="子模块")


# 向后兼容别名
AdminCreatePythonQuestion = PythonQuestionCreate


# --------------------
# Submit (Text)
# --------------------
class SubmitIn(BaseModel):
    """文本题目提交请求模型"""
    selected_label: str = Field(..., description="选择的答案")


class SubmitOut(BaseModel):
    """提交响应模型"""
    ok: bool
    is_correct: bool
    score: int = Field(..., ge=0, description="得分")
    attempt: int = Field(..., ge=1, description="尝试次数")
    explanation: Optional[str] = Field(default=None, description="答案解析")
    correct_label: Optional[str] = Field(default=None, description="正确答案")


# --------------------
# Python Run / Submit
# --------------------
class PythonRunIn(BaseModel):
    """Python代码运行请求模型"""
    code: str = Field(..., min_length=1, max_length=10000, description="Python代码")


class PythonRunOut(BaseModel):
    """Python代码运行响应模型"""
    ok: bool
    stdout: str = Field(default="", description="标准输出")
    stderr: str = Field(default="", description="错误输出")
    time_ms: Optional[int] = Field(default=None, ge=0, description="运行时间（毫秒）")
    memory_kb: Optional[int] = Field(default=None, ge=0, description="内存使用（KB）")


class PythonSubmitIn(BaseModel):
    """Python题目提交请求模型"""
    code: str = Field(..., min_length=1, max_length=10000, description="Python代码")


class PythonSubmitOut(BaseModel):
    """Python题目提交响应模型"""
    ok: bool
    is_correct: bool
    score: int = Field(..., ge=0, description="得分")
    attempt: int = Field(..., ge=1, description="尝试次数")
    explanation: Optional[str] = Field(default=None, description="答案解析")
    stdout: str = Field(default="", description="标准输出")
    stderr: str = Field(default="", description="错误输出")
    expected_stdout: Optional[str] = Field(default=None, description="预期输出")
    execution_time: Optional[int] = Field(default=None, ge=0, description="执行时间（毫秒）")


# --------------------
# Common Response Models
# --------------------
class ErrorResponse(BaseModel):
    """错误响应模型"""
    ok: bool = False
    error: str = Field(..., description="错误消息")
    detail: Optional[Dict[str, Any]] = Field(default=None, description="错误详情")


class SuccessResponse(BaseModel):
    """成功响应模型"""
    ok: bool = True
    message: str = Field(default="操作成功", description="成功消息")
    data: Optional[Dict[str, Any]] = Field(default=None, description="响应数据")


# --------------------
# Pagination
# --------------------
class PaginationParams(BaseModel):
    """分页参数模型"""
    page: int = Field(default=1, ge=1, description="页码")
    per_page: int = Field(default=20, ge=1, le=100, description="每页数量")


class PaginatedResponse(BaseModel):
    """分页响应模型"""
    total: int = Field(..., ge=0, description="总数")
    page: int = Field(..., ge=1, description="当前页码")
    per_page: int = Field(..., ge=1, le=100, description="每页数量")
    total_pages: int = Field(..., ge=0, description="总页数")
    items: List[Any] = Field(default_factory=list, description="数据列表")


# --------------------
# 向后兼容别名 (必须放在相关类定义之后)
# --------------------
RunIn = PythonRunIn
RunOut = PythonRunOut