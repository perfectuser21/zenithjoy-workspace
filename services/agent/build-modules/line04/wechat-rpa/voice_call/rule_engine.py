# services/agent/build-modules/line04/wechat-rpa/voice_call/rule_engine.py
# GP-A 主动语音触达 — 自动规则引擎（BEHAVIOR-5）
#
# 设计要点（BEHAVIOR-5）：
#   N-8   dry_run=True：只发飞书通知，不写 voice_call_records
#   I-12  3 天冷却期：no_answer 终态后该联系人 3 天内被自动跳过
#   I-12  10 分钟技术去重窗口：call_phase 非终态记录存在 → 跳过
#   安全  condition_expr 白名单校验：拒绝危险 SQL（DROP/DELETE/INSERT 等）
#
# 运行环境：xian-rog（后台进程每 15 分钟触发一次），CI 走 mock 单元测试
#
# sprint: 07191407-gpa-dispatch-trigger  task: 2ac0e77b

from __future__ import annotations

import logging
import re
from typing import Any, Callable

logger = logging.getLogger('[gpa-voice]rule_engine')


# ─── 条件表达式安全白名单校验 ─────────────────────────────────────────────────

# 允许的安全关键词（白名单）
_SAFE_PATTERNS = [
    r"^[\w\s'=<>\-.,()]+$",         # 基础字符：字母/数字/下划线/空格/常见符号
]

# 危险关键词黑名单（大写不敏感）
_DANGEROUS_KEYWORDS = [
    'DROP', 'DELETE', 'INSERT', 'UPDATE', 'TRUNCATE', 'EXEC',
    'EXECUTE', 'UNION', 'SELECT', '--', ';',
]


def validate_condition_expr(expr: str) -> bool:
    """
    校验 condition_expr 是否安全（白名单模式）。

    安全条件：
      - 不含危险 SQL 关键词（DROP/DELETE/INSERT 等）
      - 不含注释标记（--）
      - 不含语句分隔符（;）
      - 仅含白名单字符

    返回 True 表示安全，False 表示危险。
    """
    upper_expr = expr.upper()
    for kw in _DANGEROUS_KEYWORDS:
        if kw in upper_expr:
            logger.warning('[gpa-voice] condition_expr 含危险关键词 %r: %s', kw, expr)
            return False

    # 检查基础字符白名单
    if not re.match(r"^[\w\s'=<>\-.,()ANDORNOT\s+\-*/]+$", expr, re.IGNORECASE):
        # 允许包含 AND/OR/NOT 及常见 SQL 比较运算符
        # 如果包含其他特殊字符（如 ;、--）已在上面被捕获
        # 这里再次兜底检查
        allowed_re = re.compile(
            r"^[a-zA-Z0-9_\s'=\"<>!,.()\-+*/一-鿿]+$"
        )
        if not allowed_re.match(expr):
            logger.warning('[gpa-voice] condition_expr 含非法字符: %s', expr)
            return False

    return True


# ─── 自动规则引擎（BEHAVIOR-5）────────────────────────────────────────────────

class OutreachRuleEngine:
    """
    GP-A 自动外呼规则引擎（每 15 分钟扫描 voice_outreach_rules 执行）。

    工作流：
      1. db.get_enabled_rules() → 获取 enabled=True 的规则
      2. 对每条规则：
         a. db.query_customers_by_condition(rule) → 命中的联系人列表
         b. 对每个联系人：
            - db.check_cooldown() → 3天冷却期（I-12）
            - db.check_dedup_window() → 10min 技术去重（I-12）
            - dry_run=True → feishu_alert_fn() 通知，不写 DB（N-8）
            - dry_run=False → db.create_call() 写入 queued 记录
    """

    def __init__(
        self,
        db: Any,
        feishu_alert_fn: Callable | None = None,
    ) -> None:
        self.db = db
        self.feishu_alert_fn = feishu_alert_fn

    def run_once(self) -> None:
        """执行一次规则扫描（每 15 分钟由定时器触发）。"""
        rules = self.db.get_enabled_rules()

        if not rules:
            return

        for rule in rules:
            self._process_rule(rule)

    def _process_rule(self, rule: dict) -> None:
        """处理单条规则。"""
        rule_id = rule.get('id', 'unknown')
        tenant_id = rule.get('tenant_id', '')
        dry_run = rule.get('dry_run', True)
        cooldown_days = rule.get('cooldown_days', 3)
        condition_expr = rule.get('condition_expr', '')

        # 安全校验（防止危险 SQL 注入）
        if not validate_condition_expr(condition_expr):
            logger.error('[gpa-voice] 规则 %s condition_expr 安全校验失败，跳过', rule_id)
            return

        # 查询命中的联系人
        customers = self.db.query_customers_by_condition(rule)
        if not customers:
            return

        for customer in customers:
            self._process_customer(rule, customer, tenant_id, dry_run, cooldown_days)

    def _process_customer(
        self,
        rule: dict,
        customer: dict,
        tenant_id: str,
        dry_run: bool,
        cooldown_days: int,
    ) -> None:
        """对单个联系人执行冷却/去重检查，然后触发或通知。"""
        contact_name = customer.get('contact_name', '')
        wechat_account = customer.get('wechat_account', '')
        rule_id = rule.get('id', 'unknown')

        # I-12: 3天冷却期检查（no_answer 终态后跳过）
        if self.db.check_cooldown(
            tenant_id=tenant_id,
            contact_name=contact_name,
            wechat_account=wechat_account,
            cooldown_days=cooldown_days,
        ):
            logger.info(
                '[gpa-voice] rule=%s contact=%s 在冷却期内，跳过', rule_id, contact_name
            )
            return

        # I-12: 10分钟技术去重窗口
        if self.db.check_dedup_window(
            tenant_id=tenant_id,
            contact_name=contact_name,
            wechat_account=wechat_account,
        ):
            logger.info(
                '[gpa-voice] rule=%s contact=%s 在去重窗口内，跳过', rule_id, contact_name
            )
            return

        if dry_run:
            # N-8: dry_run=True → 发飞书通知，不写 voice_call_records
            logger.info(
                '[gpa-voice] rule=%s dry_run=True → 发飞书通知 contact=%s', rule_id, contact_name
            )
            if self.feishu_alert_fn:
                try:
                    self.feishu_alert_fn({
                        'msg_type': 'text',
                        'content': {
                            'text': (
                                f'[GP-A 规则预览] rule={rule_id}\n'
                                f'联系人={contact_name}（{wechat_account}）命中规则\n'
                                'dry_run=True，未实际触发通话。'
                            )
                        },
                    })
                except Exception as e:
                    logger.warning('[gpa-voice] 飞书通知失败: %s', e)
            return

        # dry_run=False → 写入 queued 记录（调用 db.create_call）
        logger.info(
            '[gpa-voice] rule=%s dry_run=False → 创建呼叫 contact=%s', rule_id, contact_name
        )
        try:
            self.db.create_call(
                tenant_id=tenant_id,
                contact_name=contact_name,
                wechat_account=wechat_account,
                trigger_source='auto_rule',
                triggered_by='system',
                rule_id=rule.get('id'),
            )
        except Exception as e:
            logger.error('[gpa-voice] create_call 失败: rule=%s contact=%s err=%s', rule_id, contact_name, e)
