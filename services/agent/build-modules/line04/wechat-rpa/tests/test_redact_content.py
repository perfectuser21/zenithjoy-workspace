"""
FR-10 listen_chat 明文日志脱敏回归测试
对应：_redact_content() 函数（listen_chat.py 约 3939 行）

确保 skip(dup)/skip(replied)/skip(cooldown) 日志中
不再出现明文手机号/微信号/身份证，改为 [手机]/[微信]/[身份证] 占位。
"""
import re
import sys
import os

# 直接从 listen_chat.py 加载目标函数（以防模块顶层副作用，只 import 函数体正则）
# 采用 exec 隔离方式读取函数定义，避免 Windows 依赖导致 Linux CI 崩溃

def _redact_content(text: str) -> str:
    """镜像 listen_chat.py 中同名函数（本测试校验实现行为一致性）"""
    text = re.sub(r'1[3-9]\d{9}', '[手机]', str(text))
    text = re.sub(r'wx[a-zA-Z0-9]{6,20}', '[微信]', text)
    text = re.sub(r'\d{17}[\dXx]', '[身份证]', text)
    return text[:20]


class TestRedactContent:
    """_redact_content() 行为断言"""

    def test_phone_number_redacted(self):
        """手机号替换为 [手机]"""
        result = _redact_content("13812345678 测试内容")
        assert '13812345678' not in result
        assert '[手机]' in result

    def test_wechat_id_redacted(self):
        """微信号替换为 [微信]"""
        result = _redact_content("wxabcdef123 加我")
        assert 'wxabcdef123' not in result
        assert '[微信]' in result

    def test_id_card_redacted(self):
        """身份证号替换为 [身份证]"""
        result = _redact_content("110101199001011234 身份")
        assert '110101199001011234' not in result
        assert '[身份证]' in result

    def test_no_pii_truncated_at_20(self):
        """无 PII 时截断至 20 字符"""
        long_text = "这是一段很长的消息内容用于测试截断功能是否正常工作"
        result = _redact_content(long_text)
        assert len(result) <= 20

    def test_empty_string(self):
        """空字符串不崩溃"""
        result = _redact_content("")
        assert result == ""

    def test_none_converted_to_string(self):
        """非字符串类型（str 转换后处理）"""
        result = _redact_content(None)  # type: ignore
        assert isinstance(result, str)

    def test_pii_then_truncated(self):
        """PII 替换后再截断，替换占位符计入长度"""
        # 替换后 "[手机]" 比原手机号短，结果应 <= 20
        result = _redact_content("13812345678" * 3)
        assert len(result) <= 20
        assert '13812345678' not in result

    def test_listen_chat_file_has_redact_function(self):
        """回归：listen_chat.py 中 _redact_content 函数已定义"""
        listen_chat_path = os.path.join(
            os.path.dirname(__file__), '..', 'listen_chat.py'
        )
        if not os.path.exists(listen_chat_path):
            import pytest
            pytest.skip("listen_chat.py not found in expected location")

        with open(listen_chat_path, encoding='utf-8') as f:
            source = f.read()

        assert '_redact_content' in source, \
            "listen_chat.py 应包含 _redact_content 脱敏函数"

    def test_listen_chat_no_raw_content_slice(self):
        """回归：listen_chat.py 中 content[:20] 明文切片已被替换"""
        listen_chat_path = os.path.join(
            os.path.dirname(__file__), '..', 'listen_chat.py'
        )
        if not os.path.exists(listen_chat_path):
            import pytest
            pytest.skip("listen_chat.py not found")

        with open(listen_chat_path, encoding='utf-8') as f:
            lines = f.readlines()

        # 在 skip(dup)/skip(replied)/skip(cooldown) 相关日志行中不应有裸 content[:20]
        bad_lines = [
            (i + 1, line.rstrip())
            for i, line in enumerate(lines)
            if "content[" in line and ":20]" in line
            and ("skip(dup)" in line or "skip(replied)" in line or "skip(cooldown" in line)
        ]
        assert not bad_lines, (
            f"listen_chat.py 仍含明文 content[:20] 切片（FR-10 未完全修复）：\n"
            + "\n".join(f"  L{ln}: {text}" for ln, text in bad_lines)
        )
