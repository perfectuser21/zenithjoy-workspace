"""
浮窗 UI 行为测试骨架
对应：[BEHAVIOR-FUNC-1] 动态流发送中→已送达翻转
对应：[BEHAVIOR-FUNC-2] 折叠态徽标弹跳
对应：[BEHAVIOR-INV-3] 禁止抢焦点
对应：[BEHAVIOR-INV-5] 温和异常文案
"""
import pytest


class OverlayUiStub:
    """
    浮窗 UI 状态机占位实现
    待实现：真实浮窗渲染后替换
    """

    MAX_ITEMS = 20

    def __init__(self):
        self.items: list[dict] = []
        self.badge_count = 0
        self.collapsed = False
        self.foreground_hwnd = 0xABCD  # 模拟当前前台窗口句柄

    def on_reply_sent(self, event: dict):
        """收到 reply_sent 事件，添加「发送中」卡片"""
        item = {
            "event_id": event["event_id"],
            "contact": event.get("contact", ""),
            "status": "pending",  # 灰态「发送中」
            "reasoning": event.get("reasoning", ""),
            "phase": event.get("phase", "A1"),
        }
        self.items.append(item)
        # 超限 FIFO 淘汰
        if len(self.items) > self.MAX_ITEMS:
            self.items = self.items[-self.MAX_ITEMS:]

        if self.collapsed:
            self.badge_count += 1

    def on_delivered(self, event_id: str):
        """收到 DELIVERED 确认，原地翻转状态"""
        for item in self.items:
            if item["event_id"] == event_id:
                item["status"] = "delivered"  # 翻绿「已送达」
                return True
        return False

    def get_foreground_hwnd(self) -> int:
        """模拟 GetForegroundWindow()"""
        return self.foreground_hwnd

    def set_collapsed(self, collapsed: bool):
        self.collapsed = collapsed
        if not collapsed:
            self.badge_count = 0

    def get_item_by_event_id(self, event_id: str) -> dict | None:
        for item in self.items:
            if item["event_id"] == event_id:
                return item
        return None


class TestPendingToDelivered:
    """[BEHAVIOR-FUNC-1] 发送中→已送达翻转"""

    def test_pending_to_delivered_in_place(self):
        """原地翻转，不新增卡片"""
        ui = OverlayUiStub()
        ev = {
            "event_id": "1720000000000-run001-1",
            "type": "reply_sent",
            "contact": "张三",
            "reasoning": "已分析需求，建议产品A",
            "phase": "A2",
        }
        ui.on_reply_sent(ev)
        assert len(ui.items) == 1
        assert ui.items[0]["status"] == "pending"

        # 收到 DELIVERED 确认
        ui.on_delivered(ev["event_id"])
        assert len(ui.items) == 1  # 不新增
        assert ui.items[0]["status"] == "delivered"
        assert ui.items[0]["contact"] == "张三"
        assert ui.items[0]["phase"] == "A2"

    def test_reasoning_shown(self):
        """已送达卡片含 reasoning"""
        ui = OverlayUiStub()
        ev = {
            "event_id": "1720000000001-run001-1",
            "type": "reply_sent",
            "contact": "李四",
            "reasoning": "已回复 李四",
            "phase": "A1",
        }
        ui.on_reply_sent(ev)
        ui.on_delivered(ev["event_id"])

        item = ui.get_item_by_event_id(ev["event_id"])
        assert item is not None
        assert item["reasoning"] == "已回复 李四"

    def test_fifo_limit_20(self):
        """超过 20 条时 FIFO 淘汰"""
        ui = OverlayUiStub()
        for i in range(25):
            ev = {
                "event_id": f"1720000{i:06d}-run001-{i}",
                "type": "reply_sent",
                "contact": "张三",
                "reasoning": f"回复{i}",
                "phase": "A1",
            }
            ui.on_reply_sent(ev)

        assert len(ui.items) == 20
        # 最新的 5 条（i=20..24）应在列表中
        last_ids = [f"1720000{i:06d}-run001-{i}" for i in range(20, 25)]
        for eid in last_ids:
            assert ui.get_item_by_event_id(eid) is not None


class TestBadgeBounceNoFocus:
    """[BEHAVIOR-FUNC-2] 折叠态徽标弹跳无焦点抢占"""

    def test_badge_increments_when_collapsed(self):
        """折叠时新消息 → 徽标 +1"""
        ui = OverlayUiStub()
        ui.set_collapsed(True)

        foreground_before = ui.get_foreground_hwnd()

        ev = {
            "event_id": "1720000000000-run001-1",
            "type": "reply_sent",
            "contact": "王五",
            "reasoning": "已回复",
            "phase": "A1",
        }
        ui.on_reply_sent(ev)

        assert ui.badge_count == 1
        # 前台窗口不变
        assert ui.get_foreground_hwnd() == foreground_before

    def test_badge_resets_on_expand(self):
        """展开后徽标清零"""
        ui = OverlayUiStub()
        ui.set_collapsed(True)
        for i in range(3):
            ui.on_reply_sent({
                "event_id": f"ev{i}",
                "type": "reply_sent",
                "contact": "测试",
                "reasoning": "已回复",
                "phase": "A1",
            })
        assert ui.badge_count == 3
        ui.set_collapsed(False)
        assert ui.badge_count == 0

    def test_badge_bounce_no_focus(self):
        """徽标弹跳不改变前台窗口"""
        ui = OverlayUiStub()
        ui.set_collapsed(True)
        hwnd_before = ui.get_foreground_hwnd()

        ui.on_reply_sent({
            "event_id": "ev_focus_test",
            "type": "reply_sent",
            "contact": "赵六",
            "reasoning": "已回复",
            "phase": "A3",
        })

        assert ui.get_foreground_hwnd() == hwnd_before, "Foreground window must not change"


class TestGentleErrorText:
    """[BEHAVIOR-INV-5] 温和异常文案"""

    FORBIDDEN = ["错误", "中断", "！", "!"]

    def _check_text(self, text: str):
        for forbidden in self.FORBIDDEN:
            assert forbidden not in text, f"Forbidden word '{forbidden}' found in: {text}"

    def test_preflight_fail_text(self):
        """preflight 失败文案温和"""
        text = "AI 浮窗暂未就绪，后台运行中"
        self._check_text(text)

    def test_pii_degraded_text(self):
        """PII 降级文案温和"""
        text = "已回复 张三"
        self._check_text(text)

    def test_circuit_open_text(self):
        """熔断静默文案温和"""
        text = "AI 客服暂时休息中"
        self._check_text(text)

    def test_bad_line_text(self):
        """坏行容错文案温和"""
        text = "日志读取中，请稍候"
        self._check_text(text)

    def test_forbidden_words_detected(self):
        """验证检测本身有效"""
        bad_text = "发生错误！请重试"
        with pytest.raises(AssertionError):
            self._check_text(bad_text)
