"""
pii_filter.py — PII 过滤纯函数
中台侧和 agent 侧共用同一实现（Invariant I5）
"""
import re

_PII_PATTERNS = [
    (re.compile(r'1[3-9]\d{9}'), '[手机号]'),
    (re.compile(r'wxid_[A-Za-z0-9_]+'), '[微信号]'),
    (re.compile(r'\d{17}[\dXx]'), '[身份证]'),
]


def filter_pii(text: str) -> str:
    """
    PII 过滤纯函数（无副作用）。
    命中任一模式 → 整句替换为降级文案。
    """
    if not isinstance(text, str):
        return text
    for pattern, replacement in _PII_PATTERNS:
        if pattern.search(text):
            return replacement
    return text
