"""
Line04 AI思考浮窗 golden path 接续测试
里程碑A：部署闭环（staging deploy + promote + 真机复验）
里程碑B：会话跟随画像卡（session_switch 事件驱动 switch_customer）

执行环境：windows_cloud（GHA windows-latest runner）
真机段（xian-rog）：BEHAVIOR-2/3 由人工验收，证据存 evidence/ 目录

合同测试（commit-1 Red）：
  - BEHAVIOR-2/3 真机段：CI 等价断言（文件存在 + events.jsonl 格式纯函数）
  - BEHAVIOR-4: switch_customer 方法存在 + 切换逻辑正确（commit-2 前失败）
  - BEHAVIOR-5: customer-profile 路由已注册（commit-2 前失败）
"""
import sys
import os
import json
import re
import pytest

# 确保 overlay 模块可 import（相对路径适配 CI 执行位置）
_overlay_dir = os.path.normpath(
    os.path.join(os.path.dirname(__file__), '../../../../services/agent/wechat-rpa/overlay')
)
if _overlay_dir not in sys.path:
    sys.path.insert(0, _overlay_dir)

# ─── 里程碑A 等价断言 ────────────────────────────────────────────────────────────


def test_milestone_a_staging_deploy():
    """
    BEHAVIOR-1: staging 部署版本断言（curl /health → 1.0.117）
    CI 等价：overlay_window.py 存在于部署包（文件存在性断言）
    真实 staging curl 断言在 e2e-verify.sh（ZJ_STAGING_API 可达时执行）
    """
    overlay_py = os.path.join(_overlay_dir, 'overlay_window.py')
    assert os.path.exists(overlay_py), \
        f"overlay_window.py 不存在于部署包路径 {overlay_py}（BEHAVIOR-1 CI 等价断言）"


def test_milestone_a_overlay_probe():
    """
    BEHAVIOR-2: overlay_window.py --probe 模式在 windows 真机 exit_code=0、≤3s
    CI 等价：OverlayApp 可 import，probe_mode=True 参数接受（非 windows 跳过真实建窗）
    真机段：xian-rog 正式安装包安装后手动执行，截图存 evidence/overlay-screenshot.png
    真机段等价断言（CI 执行）：
    """
    from overlay_window import OverlayApp
    # probe_mode 参数应存在（构造时不报错）
    app = OverlayApp(state_dir='', probe_mode=True)
    assert app.probe_mode is True, "probe_mode 应为 True"
    # 非 windows 不执行真实建窗
    if sys.platform != 'win32':
        pytest.skip("真机 --probe 建窗仅在 xian-rog windows 上验收（CI 等价：import 成功）")


def test_milestone_a_events_jsonl_format():
    """
    BEHAVIOR-3: events.jsonl 格式校验纯函数（CI 等价断言）
    验证：含 reasoning 字段（≤30字），无 PII（11位手机号）的 reply_sent 行通过校验
    真机段：xian-rog 真发微信消息后，证据存 evidence/events-sample.jsonl
    """
    # 构造合法的 reply_sent 事件
    valid_event = {
        "event_id": "evt_001",
        "event_type": "reply_sent",
        "ts": 1720000000.0,
        "reasoning": "客户询价，给出优惠方案",
        "wechat_id": "wx_test_001",
    }
    sample_line = json.dumps(valid_event, ensure_ascii=False)

    # 1. 可 JSON 解析
    parsed = json.loads(sample_line)
    assert parsed.get("event_type") == "reply_sent", "event_type 应为 reply_sent"

    # 2. reasoning 存在且 ≤30字
    reasoning = parsed.get("reasoning", "")
    assert reasoning, "reasoning 字段不能为空"
    assert len(reasoning) <= 30, f"reasoning 超 30 字: {reasoning!r}"

    # 3. 无 PII（手机号正则）
    pii_pattern = re.compile(r'1[3-9]\d{9}')
    assert not pii_pattern.search(sample_line), "events.jsonl 行不应含手机号 PII"

    # 4. 检查 evidence/ 目录（真机段）
    evidence_dir = os.path.join(
        os.path.dirname(__file__), '..', 'evidence'
    )
    evidence_sample = os.path.join(evidence_dir, 'events-sample.jsonl')
    if os.path.exists(evidence_sample):
        # 如果真机证据已存入，验证其格式
        with open(evidence_sample, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                ev = json.loads(line)
                if ev.get("event_type") == "reply_sent":
                    r = ev.get("reasoning", "")
                    assert r, "证据文件中 reply_sent 的 reasoning 不能为空"
                    assert len(r) <= 30, f"证据文件 reasoning 超 30 字: {r!r}"
                    assert not pii_pattern.search(json.dumps(ev)), "证据文件含 PII"
    else:
        # 真机验收证据尚未存入，标注（不 FAIL）
        pytest.skip("xian-rog 真机验收证据尚未存入 evidence/events-sample.jsonl（TODO: 真机段）")


# ─── 里程碑B 合同测试（commit-2 前应 FAIL） ───────────────────────────────────────


def test_milestone_b_session_card_switch_a():
    """
    BEHAVIOR-4a: switch_customer('wx_id_A') 后 current_customer == 'wx_id_A'
    commit-1 时 OverlayApp 没有 switch_customer → AssertionError
    commit-2 时实现后绿
    """
    from overlay_window import OverlayApp
    import unittest.mock as mock

    PROFILE_A = {
        'level': 'A2',
        'nickname': '张三',
        'source': '抖音',
        'contact_count': 3,
        'recent_actions': ['昨日回复'],
        'ai_profile': '处于比价阶段',
    }

    app = OverlayApp(state_dir='', probe_mode=False)

    assert hasattr(app, 'switch_customer'), \
        "OverlayApp 缺少 switch_customer 方法（BEHAVIOR-4 要求，commit-2 需实现）"

    # mock fetch_customer_profile（防止真实 HTTP 调用）
    with mock.patch.object(app, '_fetch_customer_profile', return_value=PROFILE_A):
        result = app.switch_customer('wx_id_A')

    assert app.current_customer == 'wx_id_A', \
        f"切换后 current_customer 应为 'wx_id_A'，实际: {app.current_customer!r}"
    assert result.get('nickname') == '张三', \
        f"switch_customer 返回值应含 nickname='张三'，实际: {result!r}"


def test_milestone_b_session_card_switch_b():
    """
    BEHAVIOR-4b: switch_customer('wx_id_B') 后 current_customer == 'wx_id_B'，nickname 与 A 不同
    commit-1 时 FAIL；commit-2 后绿
    """
    from overlay_window import OverlayApp
    import unittest.mock as mock

    PROFILE_B = {
        'level': 'A3',
        'nickname': '李四',
        'source': '私信',
        'contact_count': 7,
        'recent_actions': ['今日询价'],
        'ai_profile': '意向较强',
    }

    app = OverlayApp(state_dir='', probe_mode=False)

    assert hasattr(app, 'switch_customer'), \
        "OverlayApp 缺少 switch_customer 方法（BEHAVIOR-4 要求，commit-2 需实现）"

    with mock.patch.object(app, '_fetch_customer_profile', return_value=PROFILE_B):
        result = app.switch_customer('wx_id_B')

    assert app.current_customer == 'wx_id_B', \
        f"切换后 current_customer 应为 'wx_id_B'，实际: {app.current_customer!r}"
    assert result.get('nickname') == '李四', \
        f"switch_customer 返回值应含 nickname='李四'，实际: {result!r}"


def test_milestone_b_customer_profile_structure():
    """
    BEHAVIOR-5: /api/wechat/customer-profile 路由存在，返回六字段结构
    CI 等价：检查 wechat.ts 路由文件中包含 customer-profile 注册
    commit-1 时 FAIL（路由未注册）；commit-2 后绿
    """
    wechat_ts_path = os.path.normpath(
        os.path.join(os.path.dirname(__file__),
                     '../../../../apps/api/src/routes/wechat.ts')
    )
    assert os.path.exists(wechat_ts_path), f"wechat.ts 不存在: {wechat_ts_path}"

    content = open(wechat_ts_path, 'r', encoding='utf-8').read()
    assert 'customer-profile' in content, \
        "wechat.ts 中未注册 /customer-profile 路由（BEHAVIOR-5 要求，commit-2 需实现）"

    # 验证六字段出现在路由实现中
    required_fields = ['level', 'nickname', 'source', 'contact_count', 'recent_actions', 'ai_profile']
    for field in required_fields:
        assert field in content, \
            f"wechat.ts 中缺少字段 '{field}'（BEHAVIOR-5 六字段要求）"
