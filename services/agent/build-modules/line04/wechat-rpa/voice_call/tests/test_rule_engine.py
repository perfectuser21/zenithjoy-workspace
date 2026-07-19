# services/agent/build-modules/line04/wechat-rpa/voice_call/tests/test_rule_engine.py
# TDD Red — GP-A 派发链路 · rule_engine 自动规则引擎单元测试
#
# 运行方式（CI 可达）：
#   cd /workspace/services/agent/build-modules/line04/wechat-rpa
#   python -m pytest voice_call/tests/test_rule_engine.py -v
#
# 覆盖（BEHAVIOR-5）：
#   - dry_run=True：发飞书通知，不写 voice_call_records（N-8）
#   - 3 天冷却期：no_answer 终态后 3 天内被跳过（I-12）
#   - 10min 技术去重窗口：call_phase 非终态记录存在 → 跳过（I-12）
#   - enabled=False 的规则不执行
#   - 条件表达式白名单：非法 SQL 被拒绝
#   - 正常执行：条件命中 → 调用 POST /call

import pytest
from unittest.mock import MagicMock, patch, call
from datetime import datetime, timedelta, timezone


# ──────────────────────────────────────────────────────────────────────────────
# 被测模块导入（Red 阶段：模块尚未存在，导入会失败）
# ──────────────────────────────────────────────────────────────────────────────

try:
    from voice_call.rule_engine import OutreachRuleEngine
    MODULE_AVAILABLE = True
except ImportError:
    MODULE_AVAILABLE = False
    OutreachRuleEngine = None

pytestmark = pytest.mark.skipif(
    not MODULE_AVAILABLE,
    reason="rule_engine.py 尚未实现（Red 状态，预期 import 失败）",
)


# ──────────────────────────────────────────────────────────────────────────────
# 工具函数
# ──────────────────────────────────────────────────────────────────────────────

def _make_rule(dry_run=True, enabled=True, condition_expr="status='A1'", cooldown_days=3):
    return {
        "id": "rule-uuid-1",
        "tenant_id": "t1",
        "name": "测试规则",
        "condition_expr": condition_expr,
        "dry_run": dry_run,
        "enabled": enabled,
        "cooldown_days": cooldown_days,
    }


def _make_customer(contact_name="默忆", status="A1", last_seen_at=None):
    if last_seen_at is None:
        last_seen_at = datetime.now(timezone.utc) - timedelta(days=10)
    return {
        "contact_name": contact_name,
        "wechat_account": "wx-001",
        "tenant_id": "t1",
        "status": status,
        "last_seen_at": last_seen_at,
    }


# ──────────────────────────────────────────────────────────────────────────────
# dry_run 模式（N-8）
# ──────────────────────────────────────────────────────────────────────────────

class TestDryRun:
    def test_dry_run_sends_feishu_no_call_records(self):
        """
        dry_run=True 时：发飞书通知，不写 voice_call_records（N-8）。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [_make_rule(dry_run=True)]
        mock_db.query_customers_by_condition.return_value = [_make_customer()]
        mock_db.check_cooldown.return_value = False   # 无冷却
        mock_db.check_dedup_window.return_value = False  # 无去重
        mock_db.create_call.return_value = None

        mock_feishu = MagicMock()

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=mock_feishu)
        engine.run_once()

        # 飞书通知被调用
        mock_feishu.assert_called_once()
        # create_call（POST /call）未被调用
        mock_db.create_call.assert_not_called()

    def test_dry_run_false_creates_call_record(self):
        """
        dry_run=False 且去重/冷却均未命中 → 调用 create_call（POST /call）。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [_make_rule(dry_run=False)]
        mock_db.query_customers_by_condition.return_value = [_make_customer()]
        mock_db.check_cooldown.return_value = False
        mock_db.check_dedup_window.return_value = False
        mock_db.create_call.return_value = {"call_id": "call-new", "status": "queued"}

        mock_feishu = MagicMock()

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=mock_feishu)
        engine.run_once()

        mock_db.create_call.assert_called_once()
        call_kwargs = mock_db.create_call.call_args[1] if mock_db.create_call.call_args[1] else mock_db.create_call.call_args[0][0]
        assert "auto_rule" in str(call_kwargs)


# ──────────────────────────────────────────────────────────────────────────────
# 3 天冷却期（I-12）
# ──────────────────────────────────────────────────────────────────────────────

class TestCooldownPeriod:
    def test_3day_cooldown_skips_contact(self):
        """
        联系人最近一次 no_answer 的 called_at 在 3 天内 → rule_engine 跳过（I-12）。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [_make_rule(dry_run=False, cooldown_days=3)]
        mock_db.query_customers_by_condition.return_value = [_make_customer()]
        mock_db.check_cooldown.return_value = True  # 冷却期命中
        mock_db.check_dedup_window.return_value = False
        mock_db.create_call = MagicMock()

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=MagicMock())
        engine.run_once()

        mock_db.create_call.assert_not_called()

    def test_cooldown_expired_creates_call(self):
        """
        冷却期已过（>3天）→ 正常触发。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [_make_rule(dry_run=False, cooldown_days=3)]
        mock_db.query_customers_by_condition.return_value = [_make_customer()]
        mock_db.check_cooldown.return_value = False  # 冷却期已过
        mock_db.check_dedup_window.return_value = False
        mock_db.create_call.return_value = {"call_id": "call-ok", "status": "queued"}

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=MagicMock())
        engine.run_once()

        mock_db.create_call.assert_called_once()


# ──────────────────────────────────────────────────────────────────────────────
# 10 分钟技术去重窗口（I-12）
# ──────────────────────────────────────────────────────────────────────────────

class TestDedupWindow:
    def test_10min_dedup_window_skips_contact(self):
        """
        call_phase 非终态记录在 10min 内存在 → 跳过（I-12 技术窗口）。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [_make_rule(dry_run=False)]
        mock_db.query_customers_by_condition.return_value = [_make_customer()]
        mock_db.check_cooldown.return_value = False
        mock_db.check_dedup_window.return_value = True  # 去重命中
        mock_db.create_call = MagicMock()

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=MagicMock())
        engine.run_once()

        mock_db.create_call.assert_not_called()

    def test_dedup_window_checks_non_terminal_phase(self):
        """
        check_dedup_window 被以正确参数调用（tenant_id, contact_name, wechat_account）。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [_make_rule(dry_run=False)]
        customer = _make_customer(contact_name="小胡同学")
        mock_db.query_customers_by_condition.return_value = [customer]
        mock_db.check_cooldown.return_value = False
        mock_db.check_dedup_window.return_value = False
        mock_db.create_call.return_value = {"call_id": "c1", "status": "queued"}

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=MagicMock())
        engine.run_once()

        check_args = mock_db.check_dedup_window.call_args
        assert "小胡同学" in str(check_args)
        assert "t1" in str(check_args)


# ──────────────────────────────────────────────────────────────────────────────
# enabled=False 的规则不执行
# ──────────────────────────────────────────────────────────────────────────────

class TestDisabledRule:
    def test_disabled_rule_not_executed(self):
        """
        voice_outreach_rules.enabled=False 的规则不执行条件查询。
        """
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = []  # DB 层已过滤 enabled=true
        mock_db.query_customers_by_condition = MagicMock()
        mock_db.create_call = MagicMock()

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=MagicMock())
        engine.run_once()

        mock_db.query_customers_by_condition.assert_not_called()
        mock_db.create_call.assert_not_called()

    def test_mixed_enabled_disabled_rules(self):
        """
        有 enabled=True 和 enabled=False 的规则混合时，只执行 enabled=True 的。
        """
        rule_enabled = _make_rule(dry_run=False, enabled=True)
        # enabled=False 的规则由 get_enabled_rules 不返回
        mock_db = MagicMock()
        mock_db.get_enabled_rules.return_value = [rule_enabled]  # 只返回1条
        mock_db.query_customers_by_condition.return_value = [_make_customer()]
        mock_db.check_cooldown.return_value = False
        mock_db.check_dedup_window.return_value = False
        mock_db.create_call.return_value = {"call_id": "c2", "status": "queued"}

        engine = OutreachRuleEngine(db=mock_db, feishu_alert_fn=MagicMock())
        engine.run_once()

        # 只执行1次（enabled=True 的规则）
        assert mock_db.query_customers_by_condition.call_count == 1


# ──────────────────────────────────────────────────────────────────────────────
# 条件表达式白名单安全校验
# ──────────────────────────────────────────────────────────────────────────────

class TestConditionExprSafety:
    def test_valid_condition_expr_accepted(self):
        """
        标准白名单条件 "status='A1' AND last_seen_at < NOW()-interval '3 days'" 被接受。
        """
        try:
            from voice_call.rule_engine import validate_condition_expr
        except ImportError:
            pytest.skip("validate_condition_expr 未实现")

        assert validate_condition_expr("status='A1' AND last_seen_at < NOW()-interval '3 days'") is True

    def test_dangerous_condition_expr_rejected(self):
        """
        危险 SQL（DROP/DELETE/INSERT/; 等）被白名单拒绝。
        """
        try:
            from voice_call.rule_engine import validate_condition_expr
        except ImportError:
            pytest.skip("validate_condition_expr 未实现")

        dangerous_exprs = [
            "1=1; DROP TABLE customers",
            "1=1 UNION SELECT * FROM users",
            "status='A1'--",
        ]
        for expr in dangerous_exprs:
            assert validate_condition_expr(expr) is False, f"危险表达式应被拒绝: {expr}"
