"""
preflight 隔离测试骨架
对应：[BEHAVIOR-INV-1] 主链零影响
"""
import json
import os
import tempfile
import pytest


class PreflightStub:
    """
    preflight 检测占位实现
    待实现：from services.overlay.preflight import check_preflight
    """

    def __init__(self, pywebview_available: bool = True, webview2_available: bool = True):
        self._pywebview_available = pywebview_available
        self._webview2_available = webview2_available

    def check_pywebview(self) -> bool:
        return self._pywebview_available

    def check_webview2_registry(self) -> bool:
        """模拟 HKLM + HKCU 双查"""
        return self._webview2_available

    def run(self, diag_path: str = None) -> dict:
        pywebview_ok = self.check_pywebview()
        webview2_ok = self.check_webview2_registry()

        result = {
            "pass": pywebview_ok and webview2_ok,
            "pywebview": pywebview_ok,
            "webview2": webview2_ok,
            "reason": None,
        }

        if not pywebview_ok:
            result["reason"] = "pywebview import failed"
        elif not webview2_ok:
            result["reason"] = "webview2 registry not found (HKLM+HKCU)"

        if diag_path:
            with open(diag_path, "w", encoding="utf-8") as f:
                json.dump({"preflight_pass": result["pass"], "preflight_reason": result["reason"]}, f)

        return result


class TestPreflightIsolation:
    """preflight 隔离测试：失败不影响主链"""

    def test_pywebview_missing_returns_false(self):
        """pywebview 缺失时 preflight 返回 False，不抛异常"""
        pf = PreflightStub(pywebview_available=False)
        result = pf.run()
        assert result["pass"] is False
        assert "pywebview" in result["reason"].lower()

    def test_webview2_missing_returns_false(self):
        """WebView2 缺失时 preflight 返回 False"""
        pf = PreflightStub(webview2_available=False)
        result = pf.run()
        assert result["pass"] is False
        assert "webview2" in result["reason"].lower()

    def test_both_present_returns_true(self):
        """pywebview + WebView2 均存在时通过"""
        pf = PreflightStub(pywebview_available=True, webview2_available=True)
        result = pf.run()
        assert result["pass"] is True
        assert result["reason"] is None

    def test_diag_written_on_failure(self, tmp_path):
        """preflight 失败时写 overlay-diag.json"""
        diag_path = str(tmp_path / "overlay-diag.json")
        pf = PreflightStub(pywebview_available=False)
        pf.run(diag_path=diag_path)

        assert os.path.exists(diag_path)
        with open(diag_path) as f:
            diag = json.load(f)
        assert diag["preflight_pass"] is False
        assert diag["preflight_reason"] is not None

    def test_preflight_fail_does_not_raise(self):
        """preflight 失败不抛异常，主链可继续"""
        pf = PreflightStub(pywebview_available=False, webview2_available=False)
        try:
            result = pf.run()
            assert result["pass"] is False
        except Exception as e:
            pytest.fail(f"preflight should not raise exception: {e}")

    def test_preflight_not_in_required_checks(self):
        """preflight 结果不写入 manifest requiredChecks（占位检查）"""
        # 实际实现中需验证 manifest.json 的 requiredChecks 数组不含 overlay preflight
        # 此处为架构约束断言占位
        manifest_required_checks = ["agent_connected", "wechat_session"]  # 示例
        assert "overlay_preflight" not in manifest_required_checks
        assert "pywebview" not in manifest_required_checks
