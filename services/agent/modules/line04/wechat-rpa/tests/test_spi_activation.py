"""回归：_activate_uia 必须用 SPI_SETSCREENREADER 系统标志激活 UIA，
绝不启动 Windows 讲述人 Narrator.exe（满屏框+朗读声根源）。"""
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

WECHAT_RPA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WECHAT_RPA_DIR not in sys.path:
    sys.path.insert(0, WECHAT_RPA_DIR)


def _import_listen_chat():
    for name in ["pywinauto", "pywinauto.application",
                 "pywinauto.controls", "pywinauto.controls.uia_controls",
                 "requests"]:
        if name not in sys.modules:
            mod = types.ModuleType(name)
            mod.Desktop = MagicMock()
            mod.get = MagicMock()
            mod.post = MagicMock()
            sys.modules[name] = mod
    if "listen_chat" in sys.modules:
        del sys.modules["listen_chat"]
    import listen_chat as lc
    return lc


class TestSpiActivation(unittest.TestCase):
    def setUp(self):
        self.lc = _import_listen_chat()

    def test_activate_uia_sets_screenreader_flag(self):
        fake_windll = MagicMock()
        with patch("ctypes.windll", fake_windll, create=True), \
             patch.object(self.lc, "_log"):
            self.lc._activate_uia()
        fake_windll.user32.SystemParametersInfoW.assert_called_once()
        args = fake_windll.user32.SystemParametersInfoW.call_args.args
        self.assertEqual(args[0], 0x0047, "首参必须是 SPI_SETSCREENREADER")
        self.assertIs(args[1], True, "第二参必须 True（开启屏幕阅读器模式）")

    def test_activate_uia_never_launches_narrator(self):
        fake_windll = MagicMock()
        with patch("ctypes.windll", fake_windll, create=True), \
             patch.object(self.lc, "subprocess") as fake_sub, \
             patch.object(self.lc, "_log"):
            self.lc._activate_uia()
        for call in fake_sub.run.call_args_list:
            joined = " ".join(str(a) for a in call.args) + str(call.kwargs)
            self.assertNotIn("Narrator", joined, "绝不允许启动讲述人")


if __name__ == "__main__":
    unittest.main()
