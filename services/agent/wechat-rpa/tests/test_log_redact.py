"""Exercise real redaction without replacing shared Windows/stdlib modules.

listen_chat keeps GUI imports inside effectors, so its pure functions need no
Windows stubs. Global ctypes.wintypes/winreg stubs used to poison other files
in the complete suite; an inline fallback also hid missing production code.
"""
from pathlib import Path

import pytest
from listen_chat import _redact


@pytest.mark.parametrize(('original', 'expected'), [
    ('你好，这条消息包含手机号 13800138000', '你好，这条消***'),
    ('短文', '短文'),
    ('六个字符', '六个字符'),
    ('1234567', '123456***'),
    (None, None),
    (123, 123),
    ('', ''),
])
def test_actual_redact(original, expected):
    assert _redact(original) == expected


def test_content_20_grep_cleared():
    source = Path(__file__).resolve().parents[1] / 'listen_chat.py'
    assert 'content[:20]' not in source.read_text(encoding='utf-8')
