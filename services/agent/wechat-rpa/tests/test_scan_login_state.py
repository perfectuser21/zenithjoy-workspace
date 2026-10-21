"""ROG 2026-10-21 实屏：title=微信的 mmui::LoginWindow 也可能是扫码页。"""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
import find_weixin


class Window:
    def __init__(self, controls, title='微信', cls='mmui::LoginWindow'):
        self.element_info = SimpleNamespace(name=title, class_name=cls)
        self.controls = [SimpleNamespace(element_info=SimpleNamespace(name=n, control_type=t)) for n, t in controls]

    def descendants(self):
        return self.controls


@pytest.fixture
def desktop(monkeypatch):
    def install(window):
        monkeypatch.setitem(sys.modules, 'pywinauto', SimpleNamespace(Desktop=lambda **_: SimpleNamespace(windows=lambda: [window])))
    return install


def test_scan_login_page_titled_wechat_is_login_not_privacy_lock(desktop):
    desktop(Window([('仅传输文件', 'Button'), ('二维码', 'Button'), ('扫码登录', 'Text')]))
    assert find_weixin.login_window_present() is True
    assert find_weixin.is_privacy_locked() is False


def test_privacy_lock_without_scan_controls_stays_locked(desktop):
    desktop(Window([('微信已锁定', 'Text'), ('解锁', 'Button')]))
    assert find_weixin.login_window_present() is False
    assert find_weixin.is_privacy_locked() is True


def test_chat_message_about_scan_login_cannot_be_mistaken_for_login(desktop):
    desktop(Window([('扫码登录', 'ListItem'), ('二维码', 'ListItem')], cls='mmui::MainWindow'))
    assert find_weixin.login_window_present() is False
    assert find_weixin.is_privacy_locked() is False


def test_nightly_reports_scan_required_and_never_sends(desktop, monkeypatch, tmp_path):
    desktop(Window([('二维码', 'Button'), ('扫码登录', 'Text')]))
    path=Path(__file__).resolve().parents[2]/'tools/selfcheck_bubbles.py'
    spec=importlib.util.spec_from_file_location('scan_login_bubble_gate', path)
    gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
    monkeypatch.setitem(sys.modules,'listen_chat',SimpleNamespace(_SENT_TEXTS=[],_load_sent_texts=lambda:[]))
    monkeypatch.setattr(find_weixin,'get_main_window',lambda:None)
    monkeypatch.setattr(gate,'FIND_WINDOW_RETRIES',0)
    monkeypatch.setattr(gate,'_weixin_process_running',lambda:True)
    monkeypatch.setattr(gate,'OUT_PATH',str(tmp_path/'result.json'))
    result={'ok':False}
    assert gate._run_gate(result,{}) == 1
    assert 'LOGIN_REQUIRED' in result['err']
    assert 'UIA_DEAD' not in result['err']
