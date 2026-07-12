# 手机号、微信号、身份证正则过滤，命中替换为 [已过滤]
import re

PHONE_PATTERN = r'1[3-9]\d{9}'
WECHAT_PATTERN = r'wx[a-zA-Z0-9]{6,20}'
ID_CARD_PATTERN = r'\d{17}[\dXx]'

def filter_pii(text: str) -> str:
    """过滤 PII，替换为 [已过滤]"""
    for pattern in [PHONE_PATTERN, WECHAT_PATTERN, ID_CARD_PATTERN]:
        text = re.sub(pattern, '[已过滤]', text)
    return text
