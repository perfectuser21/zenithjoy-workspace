"""
TDD 红绿测试 — WS4: open_customer_page + 「查看画像」按钮（Gate G，L1-5）

对应合同断言：
  L1-5：open_customer_page mock 调用 webbrowser.open 带正确 URL（pytest monkeypatch）
  Inv-15：不内嵌 iframe，不在浮窗内渲染页面

实现前预期状态：RED（OverlayApp 无 open_customer_page 方法）
实现后预期状态：GREEN

运行方式：
  cd /workspace && python -m pytest sprints/07201810-overlay-card-redesign-gp4/tests/test_open_customer_page.py -v
"""

import os
import sys
import unittest.mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../services/agent/wechat-rpa"))

OVERLAY_PATH = os.path.join(
    os.path.dirname(__file__),
    "../../../services/agent/wechat-rpa/overlay/overlay_window.py",
)


class TestOpenCustomerPageStatic:
    """静态断言——overlay_window.py 含必要结构。"""

    def test_open_customer_page_method_exists(self):
        """OverlayApp 必须含 open_customer_page 方法定义（FR-4 F4.2）。"""
        src = open(OVERLAY_PATH, encoding="utf-8").read()
        assert "def open_customer_page" in src, (
            "FAIL: overlay_window.py 缺 open_customer_page 方法。\n"
            "实现 FR-4（F4.2）：OverlayApp 新增该方法，调用 webbrowser.open。"
        )

    def test_webbrowser_open_call_in_overlay(self):
        """overlay_window.py 必须含 webbrowser.open 调用（FR-4 F4.2）。"""
        src = open(OVERLAY_PATH, encoding="utf-8").read()
        assert "webbrowser.open" in src, (
            "FAIL: overlay_window.py 缺 webbrowser.open 调用。\n"
            "Inv-15：open_customer_page 内部必须调用 webbrowser.open(url)，不内嵌 iframe。"
        )

    def test_overlay_html_has_view_profile_button(self):
        """overlay HTML 模板必须含「查看画像」按钮（FR-4 F4.1）。"""
        src = open(OVERLAY_PATH, encoding="utf-8").read()
        has_button = "查看画像" in src or (
            "open_customer_page" in src and "button" in src.lower()
        )
        assert has_button, (
            "FAIL: overlay HTML 模板缺「查看画像」按钮。\n"
            "实现 FR-4（F4.1）：HTML 模板新增按钮，点击调用 window.pywebview.api.open_customer_page。"
        )

    def test_no_iframe_in_open_customer_page(self):
        """open_customer_page 方法体内不含 iframe（Inv-15 合规）。"""
        src = open(OVERLAY_PATH, encoding="utf-8").read()
        if "def open_customer_page" not in src:
            pytest.skip("open_customer_page 方法尚未实现")

        # 提取方法体（取方法定义后 500 字符作为上界）
        start = src.find("def open_customer_page")
        method_body = src[start: start + 500]
        assert "iframe" not in method_body.lower(), (
            "FAIL: open_customer_page 方法体含 iframe（违反 Inv-15）。\n"
            "Inv-15：不内嵌 iframe，不在浮窗内渲染 CustomerProfilePage。"
        )

    def test_button_has_disabled_state_logic(self):
        """「查看画像」按钮含置灰逻辑（无 session 时 disabled，FR-4 F4.3）。"""
        src = open(OVERLAY_PATH, encoding="utf-8").read()
        if "查看画像" not in src and "open_customer_page" not in src:
            pytest.skip("按钮尚未实现")

        # 置灰逻辑：含 disabled 属性或相关 JS 控制
        has_disabled_logic = (
            "disabled" in src
            or "_current_wechat_id" in src
            or "current_customer" in src
        )
        assert has_disabled_logic, (
            "FAIL: 缺按钮置灰逻辑。FR-4（F4.3）：无 session 时按钮置灰。"
        )


class TestOpenCustomerPageRuntime:
    """L1-5：运行时 monkeypatch 断言——open_customer_page 调用 webbrowser.open 带正确 URL。"""

    def _make_overlay_app(self, middleware_url: str = "http://localhost:5174"):
        """创建最小化 OverlayApp 实例（不启动 pywebview）。"""
        from overlay.overlay_window import OverlayApp

        app = OverlayApp.__new__(OverlayApp)
        app._middleware_base_url = middleware_url
        app._current_wechat_id = None
        app.current_customer = ""
        app._current_profile = {}
        app.state_dir = None
        app._event_consumer = None
        app._position_loop = None
        app._window = None
        return app

    def test_open_customer_page_calls_webbrowser_open(self):
        """open_customer_page(wechat_id) 必须调用 webbrowser.open（L1-5 核心断言）。"""
        with unittest.mock.patch("webbrowser.open") as mock_open:
            app = self._make_overlay_app()
            app.open_customer_page("wx_test_001")

            assert mock_open.called, (
                "FAIL: webbrowser.open 未被调用。\n"
                "实现 FR-4（F4.2）：open_customer_page 内部调用 webbrowser.open(url)。"
            )

    def test_open_customer_page_url_contains_wechat_crm_path(self):
        """open_customer_page URL 必须含 /wechat/crm/ 路径。"""
        with unittest.mock.patch("webbrowser.open") as mock_open:
            app = self._make_overlay_app("http://localhost:5174")
            app.open_customer_page("wx_crm_test")

            mock_open.assert_called_once()
            called_url = mock_open.call_args[0][0]
            assert "/wechat/crm/" in called_url, (
                f"FAIL: URL 不含 /wechat/crm/ 路径: {called_url!r}\n"
                "期望格式：http://localhost:5174/wechat/crm/<wechat_id>"
            )

    def test_open_customer_page_url_contains_wechat_id(self):
        """open_customer_page URL 必须含传入的 wechat_id。"""
        target_wechat_id = "wx_unique_id_12345"
        with unittest.mock.patch("webbrowser.open") as mock_open:
            app = self._make_overlay_app("http://localhost:5174")
            app.open_customer_page(target_wechat_id)

            called_url = mock_open.call_args[0][0]
            assert target_wechat_id in called_url, (
                f"FAIL: URL 不含 wechat_id={target_wechat_id!r}: {called_url!r}"
            )

    def test_open_customer_page_uses_middleware_base_url(self):
        """open_customer_page URL 使用 _middleware_base_url 作为前缀。"""
        custom_base = "http://custom-host:9999"
        with unittest.mock.patch("webbrowser.open") as mock_open:
            app = self._make_overlay_app(custom_base)
            app.open_customer_page("wx_base_test")

            called_url = mock_open.call_args[0][0]
            assert called_url.startswith(custom_base), (
                f"FAIL: URL 未使用 _middleware_base_url={custom_base!r}: {called_url!r}"
            )

    def test_open_customer_page_full_url_format(self):
        """open_customer_page 完整 URL 格式验证：{base}/wechat/crm/{wechat_id}。"""
        base = "http://localhost:5174"
        wechat_id = "wx_format_check"
        expected_url = f"{base}/wechat/crm/{wechat_id}"

        with unittest.mock.patch("webbrowser.open") as mock_open:
            app = self._make_overlay_app(base)
            app.open_customer_page(wechat_id)

            called_url = mock_open.call_args[0][0]
            assert called_url == expected_url, (
                f"FAIL: URL 格式不符。期望: {expected_url!r}，实际: {called_url!r}"
            )

    def test_open_customer_page_without_session_does_not_crash(self):
        """无当前 session（_current_wechat_id=None）时 open_customer_page 不崩溃。"""
        with unittest.mock.patch("webbrowser.open"):
            app = self._make_overlay_app()
            app._current_wechat_id = None

            # 直接调用时不应抛异常（置灰逻辑由前端 JS 处理）
            try:
                # 如果方法存在，即使无 session 也不应崩溃
                if hasattr(app, "open_customer_page"):
                    app.open_customer_page("")
            except Exception as e:
                pytest.fail(f"FAIL: open_customer_page 无 session 时崩溃: {e}")
