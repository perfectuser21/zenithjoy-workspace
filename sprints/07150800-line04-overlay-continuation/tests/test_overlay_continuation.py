"""
Line04 AI思考浮窗 golden path 接续测试
里程碑A：部署闭环（staging deploy + promote + 真机复验）
里程碑B：会话跟随画像卡（session_switch 事件驱动 switch_customer）

执行环境：windows_cloud（GHA windows-latest runner）
真机段（xian-rog）：BEHAVIOR-2/3 由人工验收，证据存 evidence/ 目录
"""
import pytest


def test_milestone_a_staging_deploy():
    """BEHAVIOR-1: staging 部署版本断言（curl /health → 1.0.117）"""
    pytest.skip("TODO: 由 generator 实现 — 需要 ZJ_STAGING_API 可达")


def test_milestone_a_overlay_probe():
    """BEHAVIOR-2: overlay 真机探测（xian-rog 正式安装包，--probe exit_code=0）
    真机段等价断言：overlay_window.py 文件存在 + --probe 模式逻辑可 import
    TODO: 真机验收后存入 evidence/overlay-screenshot.png
    """
    pytest.skip("TODO: 由 generator 实现 — 真机段需人工验收")


def test_milestone_a_events_jsonl():
    """BEHAVIOR-3: events.jsonl 真机证据（reply_sent+reasoning，无 PII）
    真机段等价断言：events.jsonl 格式校验纯函数
    TODO: 真机验收后存入 evidence/events-sample.jsonl
    """
    pytest.skip("TODO: 由 generator 实现 — 真机段需人工验收")


def test_milestone_b_session_card_switch_a():
    """BEHAVIOR-4a: 会话画像卡切换 — wechat_id_A 切换后画像卡显示 A 数据"""
    pytest.skip("TODO: 由 generator 实现 — switch_customer('wx_id_A') 后 current_customer==wx_id_A")


def test_milestone_b_session_card_switch_b():
    """BEHAVIOR-4b: 会话画像卡切换 — wechat_id_B 切换后画像卡显示 B 数据（nickname 不同）"""
    pytest.skip("TODO: 由 generator 实现 — switch_customer('wx_id_B') 后 current_customer==wx_id_B")


def test_milestone_b_customer_profile_structure():
    """BEHAVIOR-5: /api/wechat/customer-profile 返回六字段结构断言（mock 路径）"""
    pytest.skip("TODO: 由 generator 实现 — mock fetch_customer_profile，断言 level/nickname/source/contact_count/recent_actions/ai_profile")
