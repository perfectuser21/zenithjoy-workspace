"""
PII 过滤器测试骨架
对应：[BEHAVIOR-INV-2] PII 双硬闸
"""
import pytest
import re


# ---------------------------------------------------------------------------
# 待实现：从实际模块导入
# from services.overlay.pii_filter import filter_pii
# ---------------------------------------------------------------------------

def filter_pii_stub(text: str) -> str:
    """占位实现，实际实现替换此函数"""
    phone_pattern = r'1[3-9]\d{9}'
    id_pattern = r'\d{17}[\dXx]'
    wx_pattern = r'wx[a-zA-Z0-9]{6,20}'

    def replace_sentence(m):
        return '[已过滤]'

    for pattern in [phone_pattern, id_pattern, wx_pattern]:
        text = re.sub(pattern, '[已过滤]', text)
    return text


class TestPiiFilter:
    """PII 过滤器单元测试"""

    def test_phone_number_filtered(self):
        """手机号被过滤"""
        text = "客户手机号是13812345678，请联系"
        result = filter_pii_stub(text)
        assert '13812345678' not in result
        assert '[已过滤]' in result

    def test_wechat_id_filtered(self):
        """微信号被过滤"""
        text = "我的微信是wxabcdef123，加我"
        result = filter_pii_stub(text)
        assert 'wxabcdef123' not in result
        assert '[已过滤]' in result

    def test_id_card_filtered(self):
        """身份证号被过滤"""
        text = "身份证号码：110101199001011234"
        result = filter_pii_stub(text)
        assert '110101199001011234' not in result
        assert '[已过滤]' in result

    def test_no_pii_unchanged(self):
        """无 PII 文本不变"""
        text = "感谢您的咨询，我们会尽快回复"
        result = filter_pii_stub(text)
        assert result == text

    def test_customer_repeat_pii_filtered(self):
        """复述客户原话中含 PII 也被过滤（关键用例）"""
        # 场景：AI reasoning 中引用了客户说的手机号
        text = "客户说：我的电话是13987654321，请回电"
        result = filter_pii_stub(text)
        assert '13987654321' not in result

    def test_multiple_pii_all_filtered(self):
        """同一文本多处 PII 全部过滤"""
        text = "手机13800138000，微信wxtest123，证件110101199001011234"
        result = filter_pii_stub(text)
        assert '13800138000' not in result
        assert 'wxtest123' not in result
        assert '110101199001011234' not in result

    def test_reasoning_length_preserved(self):
        """过滤后推理文案长度应 ≤30 字（若原文合规）"""
        text = "已分析客户需求，建议推荐产品A"
        result = filter_pii_stub(text)
        assert len(result) <= 30


class TestPiiNoLeakInEvents:
    """验证 events.jsonl 写入前已过滤 PII"""

    def test_reply_sent_event_no_raw_pii(self):
        """reply_sent 事件行不含原始 PII"""
        import json
        # 模拟一条 reply_sent 事件（应经过二次过滤）
        raw_reasoning = "客户电话13812345678，已回复"
        filtered = filter_pii_stub(raw_reasoning)

        event = {
            "v": 1,
            "event_id": "1720000000000-run001-1",
            "type": "reply_sent",
            "contact": "张三",
            "reasoning": filtered,
        }
        event_str = json.dumps(event, ensure_ascii=False)
        assert '13812345678' not in event_str
        assert '[已过滤]' in event_str
